'use strict';

const fs = require('fs');
const path = require('path');

async function _loadStoredSession(dataDir) {
  try {
    const sessionFile = path.join(dataDir || path.join(process.cwd(), '.sneebly'), 'crawler-session.json');
    if (!fs.existsSync(sessionFile)) return null;
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      console.log('[Crawler] Stored session expired — crawling without auth');
      return null;
    }
    if (!data.sessionToken) return null;
    return data;
  } catch { return null; }
}

async function _authenticateWithStoredSession(context, page, appUrl, dataDir) {
  const session = await _loadStoredSession(dataDir);
  if (!session) {
    console.log('[Crawler] No stored session found — use "Sign In for ELON" in the dashboard');
    return false;
  }

  try {
    const parsedUrl = new URL(appUrl);
    await context.addCookies([{
      name: '__session',
      value: session.sessionToken,
      domain: parsedUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);

    await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const isAuth = await page.evaluate(() => {
      try {
        return window.Clerk && window.Clerk.user ? true : false;
      } catch { return false; }
    });

    if (isAuth) {
      console.log(`[Crawler] Authenticated as ${session.userEmail || session.userId} via stored session`);
      return true;
    }

    const testResp = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/users/me');
        return { status: r.status, ok: r.ok };
      } catch (e) { return { error: e.message }; }
    });
    
    if (testResp && testResp.ok) {
      console.log(`[Crawler] Authenticated (API confirmed) as ${session.userEmail || session.userId}`);
      return true;
    }

    console.log(`[Crawler] Stored session did not authenticate (API: ${JSON.stringify(testResp)}) — session may have expired. Use "Sign In for ELON" to re-authenticate.`);
    return false;

  } catch (err) {
    console.log(`[Crawler] Auth with stored session failed: ${err.message}`);
    return false;
  }
}

async function crawlSite(options = {}) {
  const {
    appUrl = 'http://localhost:5000',
    maxPages = 50,
    dataDir = null,
    timeout = 15000,
  } = options;

  let chromium;
  try {
    const pw = require('playwright-core');
    chromium = pw.chromium;
  } catch {
    try {
      const pw = require('playwright');
      chromium = pw.chromium;
    } catch {
      return {
        pagesVisited: 0,
        errors: [{ type: 'setup-error', message: 'Playwright not installed', severity: 'high' }],
      };
    }
  }

  const errors = [];
  const visited = new Set();
  const queue = [appUrl];
  const baseUrl = new URL(appUrl);
  let pagesVisited = 0;
  let authenticated = false;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    return {
      pagesVisited: 0,
      errors: [{ type: 'setup-error', message: 'Failed to launch browser: ' + err.message, severity: 'high' }],
    };
  }

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });

  try {
    const authPage = await context.newPage();
    authenticated = await _authenticateWithStoredSession(context, authPage, appUrl, dataDir);
    await authPage.close().catch(() => {});
    if (authenticated) {
      console.log('[Crawler] Proceeding with authenticated crawl');
    } else {
      console.log('[Crawler] Proceeding with unauthenticated crawl (401s on protected routes expected)');
    }
  } catch (err) {
    console.log('[Crawler] Auth phase failed:', err.message, '— continuing unauthenticated');
  }

  try {
    while (queue.length > 0 && pagesVisited < maxPages) {
      const url = queue.shift();
      const normalizedUrl = normalizeUrl(url);

      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      try {
        const pageErrors = await crawlPage(context, url, baseUrl, timeout);
        pagesVisited++;

        for (const err of pageErrors.errors) {
          errors.push(err);
        }

        for (const link of pageErrors.links) {
          const norm = normalizeUrl(link);
          if (!visited.has(norm) && !queue.includes(link)) {
            queue.push(link);
          }
        }
      } catch (err) {
        errors.push({
          type: 'crawl-error',
          message: `Failed to crawl ${url}: ${err.message}`,
          url: url,
          severity: 'medium',
        });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const result = {
    timestamp: new Date().toISOString(),
    pagesVisited,
    errors,
    authenticated,
  };

  if (dataDir) {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(dataDir, 'crawl-errors.json'),
        JSON.stringify(result, null, 2)
      );
    } catch {}
  }

  return result;
}

async function crawlPage(context, url, baseUrl, timeout) {
  const pageErrors = [];
  const links = [];

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      pageErrors.push({
        type: 'console-error',
        message: msg.text(),
        url: url,
        severity: 'high',
      });
    }
  });

  page.on('pageerror', err => {
    pageErrors.push({
      type: 'uncaught-exception',
      message: err.message,
      url: url,
      stack: err.stack || '',
      severity: 'high',
    });
  });

  page.on('requestfailed', request => {
    const failure = request.failure();
    pageErrors.push({
      type: 'request-failed',
      message: `${request.method()} ${request.url()} failed: ${failure ? failure.errorText : 'unknown'}`,
      url: request.url(),
      severity: 'medium',
    });
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      const reqUrl = response.url();
      if (reqUrl.includes('/api/') || reqUrl.includes('/sneebly/')) {
        const status = response.status();
        if (status === 401 || status === 403) {
          pageErrors.push({
            type: 'auth-expected',
            message: `${response.request().method()} ${reqUrl} returned ${status} (expected — requires authentication)`,
            url: reqUrl,
            statusCode: status,
            severity: 'info',
          });
        } else {
          pageErrors.push({
            type: 'api-error',
            message: `${response.request().method()} ${reqUrl} returned ${status}`,
            url: reqUrl,
            statusCode: status,
            severity: status >= 500 ? 'high' : 'medium',
          });
        }
      }
    }
  });

  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout });
  } catch (err) {
    if (err.message.includes('Timeout')) {
      pageErrors.push({
        type: 'slow-page',
        message: `Page timed out after ${timeout}ms`,
        url: url,
        loadTime: timeout,
        severity: 'high',
      });
    } else {
      pageErrors.push({
        type: 'navigation-error',
        message: `Navigation failed: ${err.message}`,
        url: url,
        severity: 'high',
      });
    }
    await page.close().catch(() => {});
    return { errors: pageErrors, links };
  }

  const loadTime = Date.now() - startTime;
  if (loadTime > 3000) {
    pageErrors.push({
      type: 'slow-page',
      message: `Page took ${loadTime}ms to load`,
      url: url,
      loadTime: loadTime,
      severity: 'medium',
    });
  }

  try {
    const brokenImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter(img => img.complete && img.naturalWidth === 0 && img.src)
        .map(img => img.src);
    });
    for (const src of brokenImages) {
      pageErrors.push({
        type: 'broken-image',
        message: `Broken image: ${src}`,
        url: url,
        severity: 'low',
      });
    }
  } catch {}

  // Interactive UI testing — click buttons, test dropdowns, check for JS errors
  try {
    await _interactiveTest(page, url, pageErrors);
  } catch (err) {
    // Don't let interactive testing crash the whole crawl
    console.log(`[Crawler] Interactive test error on ${url}: ${err.message}`);
  }

  try {
    const hrefs = await page.evaluate((baseOrigin) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map(a => {
          try {
            const resolved = new URL(a.href, window.location.href);
            return resolved.href;
          } catch { return null; }
        })
        .filter(href => href && href.startsWith(baseOrigin) && !href.includes('#'));
    }, baseUrl.origin);

    for (const href of hrefs) {
      const cleaned = href.split('?')[0].split('#')[0];
      if (!cleaned.match(/\.(png|jpg|jpeg|gif|svg|css|js|ico|woff|woff2|ttf|eot|pdf|zip|mp4|mp3)$/i)) {
        links.push(cleaned);
      }
    }
  } catch {}

  await page.close().catch(() => {});
  return { errors: pageErrors, links };
}

async function _interactiveTest(page, url, pageErrors) {
  // Collect errors that happen during interactions
  const interactionErrors = [];
  const failedRequests = [];

  page.on('pageerror', err => {
    interactionErrors.push({
      type: 'interaction-js-error',
      message: err.message,
      url: url,
      stack: (err.stack || '').split('\n').slice(0, 3).join(' | '),
      severity: 'high',
    });
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      failedRequests.push({
        type: 'interaction-api-error',
        message: `${response.request().method()} ${response.url()} returned ${response.status()} after button click`,
        url: response.url(),
        statusCode: response.status(),
        severity: 'high',
      });
    }
  });

  // 1. Find all clickable buttons on the page
  const buttons = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], [data-testid]'));
    return els
      .filter(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        // Skip dangerous buttons (delete, logout, remove, etc.)
        const text = (el.textContent || '').toLowerCase().trim();
        const dangerWords = ['delete', 'remove', 'logout', 'sign out', 'log out', 'destroy', 'reset', 'clear all', 'erase'];
        if (dangerWords.some(w => text.includes(w))) return false;
        // Skip buttons inside dialogs that aren't visible
        const dialog = el.closest('[role="dialog"], dialog');
        if (dialog && !dialog.hasAttribute('open') && dialog.getAttribute('data-state') !== 'open') return false;
        return true;
      })
      .map((el, i) => ({
        index: i,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 60),
        type: el.getAttribute('type') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        className: (el.className || '').toString().substring(0, 100),
        testId: el.getAttribute('data-testid') || '',
      }));
  });

  // Click up to 10 non-dangerous, non-disabled buttons and watch for errors
  const buttonsToTest = buttons.filter(b => !b.disabled).slice(0, 10);
  
  for (const btn of buttonsToTest) {
    try {
      // Get the actual element by re-querying
      const selector = btn.testId 
        ? `[data-testid="${btn.testId}"]` 
        : btn.text 
          ? `button:has-text("${btn.text.replace(/"/g, '\\"').substring(0, 30)}")`
          : null;
      
      if (!selector) continue;

      const element = page.locator(selector).first();
      const isVisible = await element.isVisible().catch(() => false);
      if (!isVisible) continue;

      // Clear any previous errors
      const errorsBefore = interactionErrors.length;
      const reqsBefore = failedRequests.length;

      // Click with a short timeout and catch navigation
      await Promise.race([
        element.click({ timeout: 3000 }).catch(() => {}),
        page.waitForTimeout(2000),
      ]);

      // Wait a moment for any async effects
      await page.waitForTimeout(500);

      // Check if new errors appeared after clicking
      if (interactionErrors.length > errorsBefore) {
        const newErrors = interactionErrors.slice(errorsBefore);
        for (const err of newErrors) {
          err.message = `After clicking "${btn.text}": ${err.message}`;
          pageErrors.push(err);
        }
      }
      if (failedRequests.length > reqsBefore) {
        const newReqs = failedRequests.slice(reqsBefore);
        for (const req of newReqs) {
          req.message = `After clicking "${btn.text}": ${req.message}`;
          pageErrors.push(req);
        }
      }

      // Check for error toasts or error messages that appeared
      const errorMessages = await page.evaluate(() => {
        const errorEls = Array.from(document.querySelectorAll(
          '[role="alert"], .toast-error, .error-message, [data-state="open"][data-type="error"], ' +
          '.Toastify__toast--error, [class*="destructive"], [class*="error"]'
        ));
        return errorEls
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => (el.textContent || '').trim().substring(0, 200))
          .filter(t => t.length > 0);
      }).catch(() => []);

      for (const msg of errorMessages) {
        // Skip non-error messages
        if (msg.toLowerCase().includes('success') || msg.toLowerCase().includes('saved')) continue;
        pageErrors.push({
          type: 'ui-error-message',
          message: `Error toast/message after clicking "${btn.text}": ${msg}`,
          url: url,
          severity: 'medium',
        });
      }

      // If the page URL changed, navigate back
      if (page.url() !== url) {
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
        } catch {
          break; // Can't get back, stop testing this page
        }
      }

      // Close any dialogs/modals that might have opened
      try {
        const escapeNeeded = await page.evaluate(() => {
          return !!document.querySelector('[role="dialog"][data-state="open"], [data-radix-dialog-overlay]');
        });
        if (escapeNeeded) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      } catch {}

    } catch (err) {
      // Individual button test failure is not critical
      continue;
    }
  }

  // 2. Check for empty states that shouldn't be empty (UI completeness)
  try {
    const uiIssues = await page.evaluate(() => {
      const issues = [];
      
      // Check for elements with "undefined" or "null" text
      const allText = document.body.innerText || '';
      if (allText.includes('undefined') || allText.match(/\bnull\b/)) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent || '';
          if (text.includes('undefined') || text.match(/\bnull\b/)) {
            const parent = node.parentElement;
            if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
              issues.push(`Text "${text.trim().substring(0, 60)}" in <${parent.tagName.toLowerCase()}>`);
            }
          }
        }
      }

      // Check for broken layout (elements overflowing)
      const body = document.body;
      if (body.scrollWidth > window.innerWidth + 20) {
        issues.push(`Page has horizontal overflow (${body.scrollWidth}px vs ${window.innerWidth}px viewport)`);
      }

      return issues;
    });

    for (const issue of uiIssues.slice(0, 5)) {
      pageErrors.push({
        type: 'ui-issue',
        message: issue,
        url: url,
        severity: 'medium',
      });
    }
  } catch {}

  // 3. Check for accessibility issues (buttons without text, missing labels)
  try {
    const a11yIssues = await page.evaluate(() => {
      const issues = [];
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const title = btn.getAttribute('title') || '';
        if (!text && !ariaLabel && !title && !btn.querySelector('svg, img')) {
          issues.push(`Button without any label or text at ${btn.className}`);
        }
      }
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
      for (const input of inputs) {
        const id = input.id;
        const ariaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || '';
        const hasLabel = id ? !!document.querySelector(`label[for="${id}"]`) : false;
        const placeholder = input.getAttribute('placeholder') || '';
        if (!ariaLabel && !hasLabel && !placeholder) {
          issues.push(`Input without label: ${input.tagName} type=${input.type || 'text'}`);
        }
      }
      return issues.slice(0, 5);
    });

    for (const issue of a11yIssues) {
      pageErrors.push({
        type: 'accessibility',
        message: issue,
        url: url,
        severity: 'low',
      });
    }
  } catch {}
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

async function verifyCrawl(options = {}) {
  const {
    appUrl = 'http://localhost:5000',
    pagesToCheck = [],
    checks = [],
    timeout = 10000,
  } = options;

  let chromium;
  try {
    const pw = require('playwright-core');
    chromium = pw.chromium;
  } catch {
    try {
      const pw = require('playwright');
      chromium = pw.chromium;
    } catch {
      return { allPassed: false, passed: 0, failed: 1, details: { passed: [], failed: [{ url: appUrl, check: 'setup', reason: 'Playwright not installed' }] } };
    }
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    return { allPassed: false, passed: 0, failed: 1, details: { passed: [], failed: [{ url: appUrl, check: 'browser-launch', reason: err.message }] } };
  }

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 375, height: 812 },
  });

  const page = await context.newPage();
  const results = { passed: [], failed: [] };

  for (const pageUrl of pagesToCheck) {
    const fullUrl = pageUrl.startsWith('http') ? pageUrl : `${appUrl}${pageUrl}`;

    try {
      const startTime = Date.now();
      const response = await page.goto(fullUrl, { timeout, waitUntil: 'networkidle' });
      const loadTime = Date.now() - startTime;

      if (response && response.status() < 400) {
        results.passed.push({ url: fullUrl, check: 'page-loads', loadTime });
      } else {
        results.failed.push({ url: fullUrl, check: 'page-loads', reason: `Status ${response ? response.status() : 'unknown'}` });
      }

      for (const check of checks) {
        try {
          const checkResult = await page.evaluate(check.evaluate);
          if (checkResult) {
            results.passed.push({ url: fullUrl, check: check.name });
          } else {
            results.failed.push({ url: fullUrl, check: check.name, reason: check.failReason || 'Check returned false' });
          }
        } catch (err) {
          results.failed.push({ url: fullUrl, check: check.name, reason: err.message });
        }
      }
    } catch (err) {
      results.failed.push({ url: fullUrl, check: 'navigation', reason: err.message });
    }
  }

  await browser.close().catch(() => {});

  return {
    allPassed: results.failed.length === 0,
    passed: results.passed.length,
    failed: results.failed.length,
    details: results,
  };
}

async function backendHealthCheck(options = {}) {
  const {
    appUrl = 'http://localhost:5000',
    dataDir = null,
    timeout = 10000,
  } = options;

  const errors = [];
  const checks = [];
  const baseUrl = appUrl.replace(/\/+$/, '');

  const publicEndpoints = [
    { path: '/', method: 'GET', label: 'Homepage' },
    { path: '/api/clerk-key', method: 'GET', label: 'Clerk key endpoint' },
  ];

  const protectedEndpoints = [
    { path: '/api/auth/user', method: 'GET', label: 'Auth user API' },
    { path: '/api/users', method: 'GET', label: 'Users API' },
    { path: '/api/time-entries', method: 'GET', label: 'Time entries API' },
    { path: '/api/time-entries/active', method: 'GET', label: 'Active time entry API' },
    { path: '/api/schedules', method: 'GET', label: 'Schedules API' },
    { path: '/api/tasks', method: 'GET', label: 'Tasks API' },
    { path: '/api/messages', method: 'GET', label: 'Messages API' },
    { path: '/api/company-settings', method: 'GET', label: 'Company settings API' },
    { path: '/api/payroll/periods', method: 'GET', label: 'Payroll periods API' },
    { path: '/api/payroll/settings', method: 'GET', label: 'Payroll settings API' },
    { path: '/api/holiday-pay-rules', method: 'GET', label: 'Holiday pay rules API' },
    { path: '/api/work-locations', method: 'GET', label: 'Work locations API' },
  ];

  const http = require('http');
  const https = require('https');
  const lib = baseUrl.startsWith('https') ? https : http;

  async function checkEndpoint(endpoint) {
    return new Promise((resolve) => {
      const url = `${baseUrl}${endpoint.path}`;
      const startTime = Date.now();
      const req = lib.get(url, { timeout }, (res) => {
        const loadTime = Date.now() - startTime;
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            endpoint: endpoint.path,
            label: endpoint.label,
            status: res.statusCode,
            loadTime,
            ok: res.statusCode < 500,
            body: body.substring(0, 500),
          });
        });
      });
      req.on('error', (err) => {
        resolve({
          endpoint: endpoint.path,
          label: endpoint.label,
          status: 0,
          loadTime: Date.now() - startTime,
          ok: false,
          error: err.message,
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({
          endpoint: endpoint.path,
          label: endpoint.label,
          status: 0,
          loadTime: timeout,
          ok: false,
          error: 'timeout',
        });
      });
    });
  }

  for (const ep of publicEndpoints) {
    const result = await checkEndpoint(ep);
    checks.push(result);
    if (!result.ok) {
      errors.push({
        type: 'backend-error',
        message: `${ep.label} (${ep.path}) ${result.error ? 'failed: ' + result.error : 'returned ' + result.status}`,
        url: `${baseUrl}${ep.path}`,
        severity: result.status >= 500 ? 'high' : 'medium',
        statusCode: result.status,
      });
    }
    if (result.loadTime > 3000) {
      errors.push({
        type: 'slow-endpoint',
        message: `${ep.label} (${ep.path}) took ${result.loadTime}ms`,
        url: `${baseUrl}${ep.path}`,
        severity: 'medium',
        loadTime: result.loadTime,
      });
    }
  }

  for (const ep of protectedEndpoints) {
    const result = await checkEndpoint(ep);
    checks.push(result);
    if (result.status === 401 || result.status === 403) {
      // Expected — auth required
    } else if (result.status >= 500) {
      errors.push({
        type: 'backend-error',
        message: `${ep.label} (${ep.path}) returned server error ${result.status}`,
        url: `${baseUrl}${ep.path}`,
        severity: 'high',
        statusCode: result.status,
      });
    } else if (result.status === 0) {
      errors.push({
        type: 'backend-error',
        message: `${ep.label} (${ep.path}) ${result.error || 'unreachable'}`,
        url: `${baseUrl}${ep.path}`,
        severity: 'high',
      });
    }
    if (result.loadTime > 3000 && result.status > 0) {
      errors.push({
        type: 'slow-endpoint',
        message: `${ep.label} (${ep.path}) took ${result.loadTime}ms`,
        url: `${baseUrl}${ep.path}`,
        severity: 'medium',
        loadTime: result.loadTime,
      });
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    type: 'backend-health-check',
    endpointsChecked: checks.length,
    errors,
    checks,
    authenticated: false,
    pagesVisited: checks.length,
  };

  if (dataDir) {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'backend-health.json'),
        JSON.stringify(result, null, 2)
      );
    } catch {}
  }

  return result;
}

function isSessionValid(dataDir) {
  try {
    const sessionFile = path.join(dataDir || path.join(process.cwd(), '.sneebly'), 'crawler-session.json');
    if (!fs.existsSync(sessionFile)) return false;
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    if (!data.sessionToken) return false;
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) return false;
    return true;
  } catch { return false; }
}

module.exports = { crawlSite, verifyCrawl, backendHealthCheck, isSessionValid };
