'use strict';

class MetricsCollector {
  constructor() {
    this.requests = [];
    this.maxEntries = 1000;
    this.errorLog = [];
    this.maxErrors = 200;
    this.startTime = Date.now();
  }

  recordRequest(entry) {
    this.requests.push({
      timestamp: Date.now(),
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      duration: entry.duration,
    });
    if (this.requests.length > this.maxEntries) {
      this.requests = this.requests.slice(-this.maxEntries);
    }
  }

  recordError(error) {
    this.errorLog.push({
      timestamp: Date.now(),
      message: error.message || String(error),
      stack: error.stack || null,
      path: error.path || null,
      method: error.method || null,
    });
    if (this.errorLog.length > this.maxErrors) {
      this.errorLog = this.errorLog.slice(-this.maxErrors);
    }
  }

  getStats() {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const recent = this.requests.filter(r => r.timestamp > fiveMinAgo);
    const durations = recent.map(r => r.duration).filter(d => typeof d === 'number').sort((a, b) => a - b);

    return {
      totalRequests: this.requests.length,
      recentRequests: recent.length,
      recentErrors: this.errorLog.filter(e => e.timestamp > fiveMinAgo).length,
      p50: this._percentile(durations, 0.5),
      p95: this._percentile(durations, 0.95),
      p99: this._percentile(durations, 0.99),
      uptimeMs: now - this.startTime,
      errorRate: recent.length > 0
        ? (recent.filter(r => r.statusCode >= 500).length / recent.length * 100).toFixed(1)
        : '0.0',
    };
  }

  getRecentErrors(limit = 20) {
    return this.errorLog.slice(-limit);
  }

  _percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.ceil(sortedArr.length * p) - 1;
    return sortedArr[Math.max(0, idx)];
  }
}

function createHealthHandler() {
  return function healthCheck(req, res) {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  };
}

function createMetricsMiddleware(collector) {
  return function metricsMiddleware(req, res, next) {
    const start = Date.now();
    const originalEnd = res.end;

    res.end = function (...args) {
      const duration = Date.now() - start;
      collector.recordRequest({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
      });
      originalEnd.apply(res, args);
    };

    next();
  };
}

function createErrorTracker(collector, memoryStore) {
  return function errorTracker(err, req, res, next) {
    collector.recordError({
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });

    if (memoryStore && typeof memoryStore.appendErrorLog === 'function') {
      try {
        memoryStore.appendErrorLog({
          message: err.message,
          stack: err.stack,
          path: req.path,
          method: req.method,
        });
      } catch {}
    }

    next(err);
  };
}

function createDashboardHandler(collector, context) {
  return function dashboardHandler(req, res) {
    const stats = collector.getStats();
    const errors = collector.getRecentErrors(10);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sneebly Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 16px; color: #58a6ff; }
    h2 { font-size: 1.1rem; margin: 16px 0 8px; color: #8b949e; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; }
    .card .label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; }
    .card .value { font-size: 1.5rem; font-weight: 600; margin-top: 4px; }
    .error-list { list-style: none; }
    .error-list li { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 8px; font-size: 0.85rem; }
    .error-list .time { color: #8b949e; font-size: 0.75rem; }
    .error-list .msg { color: #f85149; margin-top: 4px; }
    .ok { color: #3fb950; }
    .warn { color: #d29922; }
  </style>
</head>
<body>
  <h1>Sneebly Dashboard</h1>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value ok">Active</div></div>
    <div class="card"><div class="label">Uptime</div><div class="value">${(stats.uptimeMs / 1000 / 60).toFixed(1)}m</div></div>
    <div class="card"><div class="label">Requests (5m)</div><div class="value">${stats.recentRequests}</div></div>
    <div class="card"><div class="label">Errors (5m)</div><div class="value ${stats.recentErrors > 0 ? 'warn' : 'ok'}">${stats.recentErrors}</div></div>
    <div class="card"><div class="label">p50 Latency</div><div class="value">${stats.p50}ms</div></div>
    <div class="card"><div class="label">p95 Latency</div><div class="value">${stats.p95}ms</div></div>
    <div class="card"><div class="label">p99 Latency</div><div class="value">${stats.p99}ms</div></div>
    <div class="card"><div class="label">Error Rate</div><div class="value">${stats.errorRate}%</div></div>
  </div>
  <h2>Recent Errors</h2>
  ${errors.length === 0
    ? '<p style="color:#8b949e;">No recent errors</p>'
    : `<ul class="error-list">${errors.map(e =>
        `<li><span class="time">${new Date(e.timestamp).toISOString()}</span> <span class="msg">${escapeHtml(e.message || '')}</span>${e.path ? ` <span style="color:#8b949e">${e.method} ${e.path}</span>` : ''}</li>`
      ).join('')}</ul>`
  }
</body>
</html>`;

    res.type('html').send(html);
  };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sneeblyMiddleware(options = {}) {
  const {
    dashboardPath = '/sneebly/dashboard',
    healthPath = '/health',
    enableMetrics = true,
    enableErrorTracking = true,
    enableHealth = true,
    enableDashboard = true,
    internalKey = process.env.SNEEBLY_INTERNAL_KEY,
    context = null,
    memoryStore = null,
  } = options;

  const collector = new MetricsCollector();
  const healthHandler = createHealthHandler();
  const dashboardHandler = createDashboardHandler(collector, context);

  const metricsMiddleware = enableMetrics ? createMetricsMiddleware(collector) : null;
  const errorTracker = enableErrorTracking ? createErrorTracker(collector, memoryStore) : null;

  function mainMiddleware(req, res, next) {
    if (enableHealth && req.method === 'GET' && req.path === healthPath) {
      return healthHandler(req, res);
    }

    if (enableDashboard && req.method === 'GET' && req.path === dashboardPath) {
      if (internalKey) {
        const providedKey = req.headers['x-sneebly-key'] || req.query.key;
        if (providedKey !== internalKey) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
      return dashboardHandler(req, res);
    }

    if (metricsMiddleware) {
      return metricsMiddleware(req, res, next);
    }

    next();
  }

  mainMiddleware._collector = collector;
  mainMiddleware._errorTracker = errorTracker;

  return mainMiddleware;
}

module.exports = {
  sneeblyMiddleware,
  MetricsCollector,
  createHealthHandler,
  createMetricsMiddleware,
  createErrorTracker,
  createDashboardHandler,
  escapeHtml,
};
