'use strict';

const fs = require('fs');
const path = require('path');

async function _loadStoredSession(dataDir) {
  try {
    const sessionFile = path.join(dataDir || path.join(process.cwd(), '.apppilot'), 'crawler-session.json');
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
      if (reqUrl.includes('/api/') || reqUrl.includes('/apppilot/')) {
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
    { path: '/api/health', method: 'GET', label: 'Health endpoint' },
  ];

  const protectedEndpoints = [
    { path: '/api/users', method: 'GET', label: 'Users API' },
    { path: '/api/clock-events', method: 'GET', label: 'Clock events API' },
    { path: '/api/schedules', method: 'GET', label: 'Schedules API' },
    { path: '/api/tasks', method: 'GET', label: 'Tasks API' },
    { path: '/api/messages', method: 'GET', label: 'Messages API' },
    { path: '/api/settings', method: 'GET', label: 'Settings API' },
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
    const sessionFile = path.join(dataDir || path.join(process.cwd(), '.apppilot'), 'crawler-session.json');
    if (!fs.existsSync(sessionFile)) return false;
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    if (!data.sessionToken) return false;
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) return false;
    return true;
  } catch { return false; }
}

module.exports = { crawlSite, verifyCrawl, backendHealthCheck, isSessionValid };
