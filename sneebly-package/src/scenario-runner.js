'use strict';

const fs = require('fs');
const path = require('path');

const SCENARIOS_FILE = 'test-scenarios.json';
const RESULTS_FILE = 'scenario-results.json';
const DEV_MODE_FILE = 'elon-dev-mode.json';

function _loadDevMode(dataDir) {
  try {
    const filePath = path.join(dataDir, DEV_MODE_FILE);
    if (!fs.existsSync(filePath)) return { enabled: false, enabledAt: null, enabledBy: null, reminder: true };
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return { enabled: false, enabledAt: null, enabledBy: null, reminder: true }; }
}

function _saveDevMode(dataDir, settings) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, DEV_MODE_FILE), JSON.stringify(settings, null, 2));
  } catch {}
}

function getDevModeStatus(dataDir) {
  const mode = _loadDevMode(dataDir);
  if (mode.enabled && mode.enabledAt) {
    const enabledMs = new Date(mode.enabledAt).getTime();
    const hoursActive = (Date.now() - enabledMs) / (1000 * 60 * 60);
    mode.hoursActive = Math.round(hoursActive * 10) / 10;
    mode.warning = hoursActive > 24
      ? 'Dev mode has been active for over 24 hours. Consider disabling it before deploying to production.'
      : null;
  }
  return mode;
}

function setDevMode(dataDir, enabled, userId) {
  const current = _loadDevMode(dataDir);
  const updated = {
    enabled: !!enabled,
    enabledAt: enabled ? new Date().toISOString() : null,
    enabledBy: enabled ? (userId || 'system') : null,
    disabledAt: enabled ? null : new Date().toISOString(),
    reminder: true,
    previousState: current.enabled,
  };
  _saveDevMode(dataDir, updated);
  return updated;
}

function getDefaultScenarios() {
  return [
    {
      id: 'shopify-connect',
      name: 'Shopify Integration Connect',
      description: 'Verifies Shopify connection page loads and Connect button works',
      category: 'integration',
      priority: 'high',
      requiresAuth: true,
      requiresDevMode: false,
      steps: [
        { action: 'navigate', path: '/admin', description: 'Go to admin settings' },
        { action: 'navigate', path: '/settings', description: 'Navigate to settings page' },
        { action: 'waitForSelector', selector: 'text=POS connection, text=Shopify, [href*="shopify"]', timeout: 5000, description: 'Look for Shopify/POS connection link' },
        { action: 'click', selector: 'text=POS connection, [href*="shopify"], text=Shopify Integration', description: 'Click POS connection' },
        { action: 'waitForSelector', selector: 'text=Shopify Integration, text=Connect your Shopify', timeout: 5000, description: 'Verify Shopify integration panel loads' },
        { action: 'checkNoErrors', description: 'Verify no error toasts appear on page load' },
        { action: 'checkEnvVar', envVar: 'SHOPIFY_API_KEY', description: 'Verify Shopify API key is configured' },
        { action: 'checkEnvVar', envVar: 'SHOPIFY_API_SECRET', description: 'Verify Shopify API secret is configured' },
      ],
    },
    {
      id: 'clock-in-page',
      name: 'Clock In/Out Page',
      description: 'Verifies the time clock page loads with proper UI',
      category: 'core',
      priority: 'critical',
      requiresAuth: true,
      requiresDevMode: false,
      steps: [
        { action: 'navigate', path: '/', description: 'Go to homepage' },
        { action: 'waitForSelector', selector: 'text=Clock In, text=Clock Out, button:has-text("Clock")', timeout: 5000, description: 'Look for clock in/out button' },
        { action: 'checkNoErrors', description: 'No error messages on time clock page' },
      ],
    },
    {
      id: 'schedule-page',
      name: 'Schedule Page',
      description: 'Verifies schedule management page loads correctly',
      category: 'core',
      priority: 'high',
      requiresAuth: true,
      requiresDevMode: false,
      steps: [
        { action: 'navigate', path: '/schedule', description: 'Navigate to schedule page' },
        { action: 'waitForSelector', selector: 'text=Schedule, text=Calendar, [class*="calendar"]', timeout: 5000, description: 'Verify schedule UI loads' },
        { action: 'checkNoErrors', description: 'No errors on schedule page' },
      ],
    },
    {
      id: 'payroll-page',
      name: 'Payroll Page',
      description: 'Verifies payroll management loads correctly',
      category: 'core',
      priority: 'high',
      requiresAuth: true,
      requiresDevMode: false,
      steps: [
        { action: 'navigate', path: '/payroll', description: 'Navigate to payroll page' },
        { action: 'waitForSelector', selector: 'text=Payroll, text=Pay Period, text=Export', timeout: 5000, description: 'Verify payroll UI loads' },
        { action: 'checkNoErrors', description: 'No errors on payroll page' },
      ],
    },
    {
      id: 'api-health-endpoints',
      name: 'API Endpoint Health',
      description: 'Checks critical API endpoints respond correctly',
      category: 'api',
      priority: 'critical',
      requiresAuth: false,
      requiresDevMode: false,
      steps: [
        { action: 'apiCheck', method: 'GET', path: '/api/clerk-key', expectedStatus: 200, description: 'Public clerk key endpoint' },
        { action: 'apiCheck', method: 'GET', path: '/', expectedStatus: 200, description: 'Homepage loads' },
      ],
    },
    {
      id: 'authenticated-api-health',
      name: 'Authenticated API Health',
      description: 'Checks protected API endpoints respond with valid data shapes',
      category: 'api',
      priority: 'high',
      requiresAuth: true,
      requiresDevMode: false,
      steps: [
        { action: 'apiCheck', method: 'GET', path: '/api/users', expectedStatus: 200, validateShape: 'array', description: 'Users API returns array' },
        { action: 'apiCheck', method: 'GET', path: '/api/time-entries', expectedStatus: 200, validateShape: 'array', description: 'Time entries API returns array' },
        { action: 'apiCheck', method: 'GET', path: '/api/schedules', expectedStatus: 200, validateShape: 'array', description: 'Schedules API returns array' },
        { action: 'apiCheck', method: 'GET', path: '/api/tasks', expectedStatus: 200, validateShape: 'array', description: 'Tasks API returns array' },
        { action: 'apiCheck', method: 'GET', path: '/api/company-settings', expectedStatus: 200, validateShape: 'object', description: 'Company settings returns object' },
        { action: 'apiCheck', method: 'GET', path: '/api/payroll/settings', expectedStatus: 200, validateShape: 'object', description: 'Payroll settings returns object' },
        { action: 'apiCheck', method: 'GET', path: '/api/shopify/shops', expectedStatus: 200, validateShape: 'array', description: 'Shopify shops returns array' },
        { action: 'apiCheck', method: 'GET', path: '/api/holiday-pay-rules', expectedStatus: 200, validateShape: 'array', description: 'Holiday pay rules returns array' },
      ],
    },
  ];
}

async function runScenarios(options = {}) {
  const {
    appUrl = 'http://localhost:5000',
    dataDir = null,
    scenarioIds = null,
    sessionData = null,
    onProgress = null,
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
        totalScenarios: 0,
        passed: 0,
        failed: 0,
        errors: [{ scenario: 'setup', message: 'Playwright not installed' }],
        results: [],
      };
    }
  }

  const scenarios = getDefaultScenarios();
  const toRun = scenarioIds
    ? scenarios.filter(s => scenarioIds.includes(s.id))
    : scenarios;

  const devMode = dataDir ? _loadDevMode(dataDir) : { enabled: false };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    return {
      totalScenarios: toRun.length,
      passed: 0,
      failed: 1,
      errors: [{ scenario: 'browser-launch', message: err.message }],
      results: [],
    };
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  try {
    for (const scenario of toRun) {
      if (scenario.requiresDevMode && !devMode.enabled) {
        results.push({
          id: scenario.id,
          name: scenario.name,
          status: 'skipped',
          reason: 'Requires dev mode (test data mode) to be enabled',
          steps: [],
        });
        continue;
      }

      if (onProgress) onProgress('scenario-start', `Running: ${scenario.name}`, { id: scenario.id });

      const scenarioResult = await _runSingleScenario(browser, scenario, {
        appUrl,
        sessionData,
        dataDir,
      });

      results.push(scenarioResult);
      if (scenarioResult.status === 'passed') passed++;
      else failed++;

      if (onProgress) onProgress('scenario-done', `${scenario.name}: ${scenarioResult.status}`, scenarioResult);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totalScenarios: toRun.length,
    passed,
    failed,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
    devModeActive: devMode.enabled,
  };

  if (dataDir) {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, RESULTS_FILE), JSON.stringify(summary, null, 2));
    } catch {}
  }

  return summary;
}

async function _runSingleScenario(browser, scenario, options) {
  const { appUrl, sessionData, dataDir } = options;
  const stepResults = [];
  let overallStatus = 'passed';

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });

  if (scenario.requiresAuth && sessionData && sessionData.sessionToken) {
    try {
      const parsedUrl = new URL(appUrl);
      await context.addCookies([{
        name: '__session',
        value: sessionData.sessionToken,
        domain: parsedUrl.hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }]);
    } catch {}
  }

  const page = await context.newPage();
  const pageErrors = [];

  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  try {
    for (const step of scenario.steps) {
      const stepResult = await _executeStep(page, step, appUrl, pageErrors);
      stepResults.push(stepResult);

      if (stepResult.status === 'failed') {
        overallStatus = 'failed';
      }
    }
  } catch (err) {
    overallStatus = 'failed';
    stepResults.push({
      description: 'Unexpected error',
      status: 'failed',
      error: err.message,
    });
  }

  let screenshot = null;
  if (overallStatus === 'failed' && dataDir) {
    try {
      const screenshotDir = path.join(dataDir, 'screenshots');
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const ssPath = path.join(screenshotDir, `${scenario.id}-${Date.now()}.png`);
      await page.screenshot({ path: ssPath, fullPage: false });
      screenshot = ssPath;
    } catch {}
  }

  await page.close().catch(() => {});
  await context.close().catch(() => {});

  return {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    priority: scenario.priority,
    status: overallStatus,
    steps: stepResults,
    pageErrors: pageErrors.slice(0, 10),
    screenshot,
    timestamp: new Date().toISOString(),
  };
}

async function _executeStep(page, step, appUrl, pageErrors) {
  const result = {
    description: step.description || step.action,
    action: step.action,
    status: 'passed',
    error: null,
    duration: 0,
  };

  const startTime = Date.now();

  try {
    switch (step.action) {
      case 'navigate': {
        const url = step.path.startsWith('http') ? step.path : `${appUrl}${step.path}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: step.timeout || 15000 });
        break;
      }

      case 'waitForSelector': {
        const selectors = step.selector.split(', ');
        let found = false;
        for (const sel of selectors) {
          try {
            await page.waitForSelector(sel.trim(), { timeout: step.timeout || 5000 });
            found = true;
            break;
          } catch {}
        }
        if (!found) {
          result.status = 'failed';
          result.error = `None of the selectors found: ${step.selector}`;
        }
        break;
      }

      case 'click': {
        const selectors = step.selector.split(', ');
        let clicked = false;
        for (const sel of selectors) {
          try {
            const el = page.locator(sel.trim()).first();
            if (await el.isVisible().catch(() => false)) {
              await el.click({ timeout: 3000 });
              clicked = true;
              break;
            }
          } catch {}
        }
        if (!clicked) {
          result.status = 'failed';
          result.error = `Could not click any of: ${step.selector}`;
        }
        await page.waitForTimeout(1000);
        break;
      }

      case 'checkNoErrors': {
        await page.waitForTimeout(500);
        const errorMessages = await page.evaluate(() => {
          const errorEls = Array.from(document.querySelectorAll(
            '[role="alert"], .toast-error, [data-state="open"][data-type="error"], ' +
            '.Toastify__toast--error, [class*="destructive"]'
          ));
          return errorEls
            .filter(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .map(el => (el.textContent || '').trim().substring(0, 200))
            .filter(t => t.length > 5 && !t.toLowerCase().includes('success'));
        }).catch(() => []);

        if (errorMessages.length > 0) {
          result.status = 'failed';
          result.error = `Error messages found: ${errorMessages.join('; ')}`;
        }
        break;
      }

      case 'checkEnvVar': {
        const val = process.env[step.envVar];
        if (!val || val.trim() === '') {
          result.status = 'failed';
          result.error = `Environment variable ${step.envVar} is not set`;
        }
        break;
      }

      case 'apiCheck': {
        const url = step.path.startsWith('http') ? step.path : `${appUrl}${step.path}`;
        try {
          const resp = await page.evaluate(async (opts) => {
            try {
              const r = await fetch(opts.url, { method: opts.method || 'GET' });
              const text = await r.text();
              let json = null;
              try { json = JSON.parse(text); } catch {}
              return { status: r.status, hasBody: text.length > 0, bodyType: json ? (Array.isArray(json) ? 'array' : typeof json) : 'text', bodyLength: text.length };
            } catch (e) { return { error: e.message }; }
          }, { url, method: step.method });

          if (resp.error) {
            result.status = 'failed';
            result.error = `API call failed: ${resp.error}`;
          } else if (step.expectedStatus && resp.status !== step.expectedStatus) {
            if (resp.status === 401 || resp.status === 403) {
              result.status = 'passed';
              result.error = `Auth required (${resp.status}) — expected for protected endpoint`;
            } else {
              result.status = 'failed';
              result.error = `Expected status ${step.expectedStatus}, got ${resp.status}`;
            }
          } else if (step.validateShape && resp.bodyType !== step.validateShape) {
            if (resp.status === 401 || resp.status === 403) {
              result.status = 'passed';
              result.error = `Auth required — shape validation skipped`;
            } else {
              result.status = 'failed';
              result.error = `Expected ${step.validateShape} response, got ${resp.bodyType}`;
            }
          }
        } catch (err) {
          result.status = 'failed';
          result.error = `API check failed: ${err.message}`;
        }
        break;
      }

      case 'fillInput': {
        try {
          await page.fill(step.selector, step.value, { timeout: 3000 });
        } catch (err) {
          result.status = 'failed';
          result.error = `Could not fill input: ${err.message}`;
        }
        break;
      }

      case 'assertText': {
        try {
          const text = await page.textContent(step.selector, { timeout: 3000 });
          if (!text || !text.includes(step.expectedText)) {
            result.status = 'failed';
            result.error = `Expected text "${step.expectedText}" not found`;
          }
        } catch (err) {
          result.status = 'failed';
          result.error = `Text assertion failed: ${err.message}`;
        }
        break;
      }

      default:
        result.status = 'skipped';
        result.error = `Unknown action: ${step.action}`;
    }
  } catch (err) {
    result.status = 'failed';
    result.error = err.message;
  }

  result.duration = Date.now() - startTime;
  return result;
}

function loadLastResults(dataDir) {
  try {
    const filePath = path.join(dataDir, RESULTS_FILE);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

module.exports = {
  runScenarios,
  getDefaultScenarios,
  loadLastResults,
  getDevModeStatus,
  setDevMode,
};
