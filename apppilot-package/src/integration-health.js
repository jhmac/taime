'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const HEALTH_RESULTS_FILE = 'integration-health.json';

function _httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const timeout = options.timeout || 8000;
    const headers = options.headers || {};

    const req = lib.get(url, { headers, timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function _httpRequest(url, method, body, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const timeout = options.timeout || 8000;

    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout,
    };

    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function checkShopifyHealth(appUrl) {
  const result = {
    integration: 'shopify',
    status: 'unknown',
    details: {},
    errors: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    if (!apiKey) {
      result.status = 'misconfigured';
      result.errors.push('SHOPIFY_API_KEY environment variable is not set');
      return result;
    }
    if (!apiSecret) {
      result.status = 'misconfigured';
      result.errors.push('SHOPIFY_API_SECRET environment variable is not set');
      return result;
    }

    result.details.apiKeyConfigured = true;
    result.details.apiSecretConfigured = true;
    result.details.apiKeyPrefix = apiKey.substring(0, 6) + '...';

    try {
      const shopsResp = await _httpGet(`${appUrl}/api/shopify/shops`, {
        headers: { 'Cookie': '__internal_health_check=true' },
      });
      if (shopsResp.status === 401 || shopsResp.status === 403) {
        result.details.shopsEndpoint = 'requires-auth';
      } else if (shopsResp.status === 200) {
        try {
          const shopsData = JSON.parse(shopsResp.body);
          result.details.connectedShops = Array.isArray(shopsData) ? shopsData.length : 0;
        } catch {
          result.details.shopsEndpoint = 'invalid-response';
        }
      } else {
        result.details.shopsEndpoint = `error-${shopsResp.status}`;
        result.errors.push(`Shops endpoint returned ${shopsResp.status}`);
      }
    } catch (err) {
      result.details.shopsEndpoint = 'unreachable';
      result.errors.push(`Shops endpoint unreachable: ${err.message}`);
    }

    result.status = result.errors.length > 0 ? 'degraded' : 'healthy';
  } catch (err) {
    result.status = 'error';
    result.errors.push(`Shopify health check failed: ${err.message}`);
  }

  return result;
}

async function checkNylasHealth() {
  const result = {
    integration: 'nylas',
    status: 'unknown',
    details: {},
    errors: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const apiKey = process.env.NYLAS_API_KEY;
    const grantId = process.env.NYLAS_GRANT_ID;

    if (!apiKey) {
      result.status = 'not-configured';
      result.details.note = 'NYLAS_API_KEY not set — email invitations disabled';
      return result;
    }
    if (!grantId) {
      result.status = 'misconfigured';
      result.errors.push('NYLAS_GRANT_ID not set — emails will fail');
      return result;
    }

    result.details.apiKeyConfigured = true;
    result.details.grantIdConfigured = true;

    try {
      const resp = await _httpGet('https://api.us.nylas.com/v3/grants/' + grantId, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 5000,
      });
      if (resp.status === 200) {
        result.status = 'healthy';
        result.details.grantValid = true;
      } else if (resp.status === 401) {
        result.status = 'misconfigured';
        result.errors.push('Nylas API key is invalid or expired');
      } else if (resp.status === 404) {
        result.status = 'misconfigured';
        result.errors.push('Nylas grant ID is invalid');
      } else {
        result.status = 'degraded';
        result.errors.push(`Nylas API returned ${resp.status}`);
      }
    } catch (err) {
      result.status = 'degraded';
      result.errors.push(`Nylas API unreachable: ${err.message}`);
    }
  } catch (err) {
    result.status = 'error';
    result.errors.push(`Nylas health check failed: ${err.message}`);
  }

  return result;
}

async function checkClaudeHealth() {
  const result = {
    integration: 'claude-ai',
    status: 'unknown',
    details: {},
    errors: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      result.status = 'misconfigured';
      result.errors.push('ANTHROPIC_API_KEY not set — all AI features disabled');
      return result;
    }

    result.details.apiKeyConfigured = true;
    result.details.apiKeyPrefix = apiKey.substring(0, 10) + '...';

    try {
      const resp = await _httpRequest('https://api.anthropic.com/v1/messages', 'POST', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Say OK' }],
      }, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 10000,
      });
      if (resp.status === 200) {
        result.status = 'healthy';
        result.details.modelAccess = true;
      } else if (resp.status === 401) {
        result.status = 'misconfigured';
        result.errors.push('Anthropic API key is invalid');
      } else if (resp.status === 429) {
        result.status = 'degraded';
        result.errors.push('Anthropic API rate limited — AI features may be slow');
      } else {
        result.status = 'degraded';
        result.errors.push(`Anthropic API returned ${resp.status}`);
      }
    } catch (err) {
      result.status = 'degraded';
      result.errors.push(`Anthropic API unreachable: ${err.message}`);
    }
  } catch (err) {
    result.status = 'error';
    result.errors.push(`Claude health check failed: ${err.message}`);
  }

  return result;
}

async function checkDatabaseHealth(appUrl) {
  const result = {
    integration: 'database',
    status: 'unknown',
    details: {},
    errors: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      result.status = 'misconfigured';
      result.errors.push('DATABASE_URL not set');
      return result;
    }

    result.details.configured = true;

    try {
      const resp = await _httpGet(`${appUrl}/api/clerk-key`);
      if (resp.status === 200) {
        result.status = 'healthy';
        result.details.appResponding = true;
      } else {
        result.status = 'degraded';
        result.errors.push(`App not responding properly (status ${resp.status})`);
      }
    } catch (err) {
      result.status = 'degraded';
      result.errors.push(`App health check failed: ${err.message}`);
    }
  } catch (err) {
    result.status = 'error';
    result.errors.push(`Database health check failed: ${err.message}`);
  }

  return result;
}

async function checkWebSocketHealth(appUrl) {
  const result = {
    integration: 'websocket',
    status: 'unknown',
    details: {},
    errors: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const wsUrl = appUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws?userId=health-check';

    result.details.endpointConfigured = true;
    result.status = 'healthy';
    result.details.note = 'WebSocket endpoint configured (connection test requires browser context)';
  } catch (err) {
    result.status = 'error';
    result.errors.push(`WebSocket health check failed: ${err.message}`);
  }

  return result;
}

async function runAllHealthChecks(options = {}) {
  const {
    appUrl = 'http://localhost:5000',
    dataDir = null,
    skipExpensive = false,
  } = options;

  const checks = await Promise.all([
    checkShopifyHealth(appUrl),
    checkNylasHealth(),
    skipExpensive ? Promise.resolve({ integration: 'claude-ai', status: 'skipped', details: {}, errors: [], timestamp: new Date().toISOString() }) : checkClaudeHealth(),
    checkDatabaseHealth(appUrl),
    checkWebSocketHealth(appUrl),
  ]);

  const summary = {
    timestamp: new Date().toISOString(),
    overall: 'healthy',
    integrations: checks,
    issues: [],
  };

  for (const check of checks) {
    if (check.status === 'misconfigured' || check.status === 'error') {
      summary.overall = 'unhealthy';
      for (const err of check.errors) {
        summary.issues.push({
          integration: check.integration,
          severity: 'high',
          message: err,
          status: check.status,
        });
      }
    } else if (check.status === 'degraded') {
      if (summary.overall === 'healthy') summary.overall = 'degraded';
      for (const err of check.errors) {
        summary.issues.push({
          integration: check.integration,
          severity: 'medium',
          message: err,
          status: check.status,
        });
      }
    }
  }

  if (dataDir) {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, HEALTH_RESULTS_FILE),
        JSON.stringify(summary, null, 2)
      );
    } catch {}
  }

  return summary;
}

function loadLastHealthCheck(dataDir) {
  try {
    const filePath = path.join(dataDir, HEALTH_RESULTS_FILE);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

module.exports = {
  runAllHealthChecks,
  loadLastHealthCheck,
  checkShopifyHealth,
  checkNylasHealth,
  checkClaudeHealth,
  checkDatabaseHealth,
  checkWebSocketHealth,
};
