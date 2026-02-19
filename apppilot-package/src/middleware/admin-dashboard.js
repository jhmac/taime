'use strict';

const fs = require('fs');
const path = require('path');
const { OwnerVerification, IdentityProtection, AuthRateLimiter } = require('../security');

function createAdminDashboard(options = {}) {
  const {
    memoryStore,
    metricsCollector,
    identityProtection,
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.apppilot'),
    ownerConfig = {},
    basePath = '/apppilot',
  } = options;

  const owner = new OwnerVerification(ownerConfig);
  const rateLimiter = new AuthRateLimiter(
    ownerConfig.maxAuthAttempts || 10,
    ownerConfig.authWindowMs || 15 * 60 * 1000
  );

  const liveActivity = [];
  const MAX_LIVE_ENTRIES = 100;

  function pushActivity(type, message) {
    if (typeof message === 'string' && (message.includes('429') || message.toLowerCase().includes('rate limit'))) {
      message = 'Claude API Rate Limit (429) - retrying shortly...';
      type = 'warning';
    }
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message,
    };
    liveActivity.unshift(entry);
    if (liveActivity.length > MAX_LIVE_ENTRIES) liveActivity.length = MAX_LIVE_ENTRIES;
  }

  if (memoryStore && memoryStore.logDaily) {
    const originalLogDaily = memoryStore.logDaily.bind(memoryStore);
    memoryStore.logDaily = function(msg) {
      originalLogDaily(msg);
      const type = msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed') ? 'error'
        : msg.toLowerCase().includes('complete') || msg.toLowerCase().includes('resolved') || msg.toLowerCase().includes('solved') ? 'success'
        : msg.toLowerCase().includes('elon') ? 'heartbeat'
        : 'info';
      pushActivity(type, msg);
    };
  }

  function authMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!rateLimiter.check(ip)) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }

    if (!owner.verifyRequest(req)) {
      rateLimiter.recordFailure(ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  }

  function getStatus(req, res) {
    const stats = metricsCollector ? metricsCollector.getStats() : {};
    const knownErrors = memoryStore ? memoryStore.loadKnownErrors() : { errors: [] };
    const newErrors = knownErrors.errors.filter(e => e.status === 'new');

    let lastHeartbeat = null;
    if (memoryStore) {
      const decisions = memoryStore.getRecentDecisions(1);
      const hb = decisions.find(d => d && d.action === 'heartbeat_complete');
      if (hb) lastHeartbeat = hb;
    }

    let securityAlerts = 0;
    if (memoryStore) {
      const audit = memoryStore.auditMemory();
      securityAlerts = audit.findings ? audit.findings.length : 0;
    }

    const status = {
      agentName: _getAgentName(projectRoot),
      status: _computeStatus(knownErrors, identityProtection),
      lastHeartbeat: lastHeartbeat ? lastHeartbeat.timestamp || lastHeartbeat.details?.timestamp : null,
      stats: {
        fixesApplied: knownErrors.errors.filter(e => e.status === 'resolved').length,
        errorsToday: _countErrorsToday(knownErrors),
        p95: stats.p95 || 0,
        heartbeatsCompleted: _countHeartbeats(memoryStore),
        securityAlerts,
      },
      uptime: stats.uptimeMs || 0,
    };

    res.json(status);
  }

  function getFeed(req, res) {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const entries = memoryStore ? memoryStore.getDashboardLog(limit) : [];

    const feed = entries.map(entry => {
      const match = entry.match(/^- \[([^\]]+)\]\s*(.*)$/);
      if (match) {
        return {
          timestamp: match[1],
          message: match[2],
          type: _classifyEntry(match[2]),
        };
      }
      return { timestamp: null, message: entry, type: 'info' };
    });

    res.json({ feed });
  }

  function getErrors(req, res) {
    const knownErrors = memoryStore ? memoryStore.loadKnownErrors() : { errors: [] };
    const errors = knownErrors.errors
      .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0))
      .slice(0, 20);

    res.json({ errors });
  }

  function getMetrics(req, res) {
    const snapshots = memoryStore ? memoryStore.getMetricsSnapshots(20) : [];
    const stats = metricsCollector ? metricsCollector.getStats() : {};

    res.json({ current: stats, history: snapshots });
  }

  function getQueue(req, res) {
    const pendingDir = path.join(dataDir, 'pending-queue');
    const approvedDir = path.join(dataDir, 'approved-queue');

    const pending = _readQueueDir(pendingDir);
    const approved = _readQueueDir(approvedDir);

    res.json({ pending, approved });
  }

  function approveQueueItem(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing queue item ID' });

    const pendingDir = path.join(dataDir, 'pending-queue');
    const approvedDir = path.join(dataDir, 'approved-queue');

    const sourcePath = path.join(pendingDir, `${id}.json`);
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    try {
      if (!fs.existsSync(approvedDir)) {
        fs.mkdirSync(approvedDir, { recursive: true });
      }
      const destPath = path.join(approvedDir, `${id}.json`);
      fs.renameSync(sourcePath, destPath);

      owner.logOwnerAction('queue_approve', { id }, dataDir);

      res.json({ success: true, id, action: 'approved' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve item' });
    }
  }

  function rejectQueueItem(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing queue item ID' });

    const pendingDir = path.join(dataDir, 'pending-queue');
    const rejectedDir = path.join(dataDir, 'rejected-queue');

    const sourcePath = path.join(pendingDir, `${id}.json`);
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    try {
      if (!fs.existsSync(rejectedDir)) {
        fs.mkdirSync(rejectedDir, { recursive: true });
      }
      const destPath = path.join(rejectedDir, `${id}.json`);
      fs.renameSync(sourcePath, destPath);

      owner.logOwnerAction('queue_reject', { id }, dataDir);

      res.json({ success: true, id, action: 'rejected' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject item' });
    }
  }

  function getSecurity(req, res) {
    const checksums = {};
    const changes = [];

    if (identityProtection) {
      const verification = identityProtection.verify();
      for (const [file, hash] of identityProtection.checksums.entries()) {
        checksums[file] = hash;
      }
      if (!verification.valid) {
        changes.push(...verification.changes);
      }
    }

    let alerts = [];
    let blockedActions = [];

    if (memoryStore) {
      const audit = memoryStore.auditMemory();
      if (audit.findings && audit.findings.length > 0) {
        alerts = audit.findings.map(f => ({
          file: f.file,
          type: f.type,
          patternCount: f.patterns ? f.patterns.length : 0,
        }));
      }

      const decisions = memoryStore.getRecentDecisions(50);
      blockedActions = decisions
        .filter(d => d && (d.action === 'action_blocked' || d.status === 'blocked'))
        .slice(0, 10)
        .map(d => ({
          timestamp: d.timestamp,
          action: d.action,
          reasons: d.reasons || [],
        }));
    }

    res.json({
      checksums,
      integrityValid: changes.length === 0,
      changes,
      alerts,
      blockedActions,
    });
  }

  function acknowledgeSecurity(req, res) {
    if (!identityProtection) {
      return res.status(400).json({ error: 'Identity protection not configured' });
    }

    identityProtection.acknowledgeChanges();
    owner.logOwnerAction('security_acknowledge', { action: 'checksums_reset' }, dataDir);

    res.json({ success: true, message: 'Identity checksums updated' });
  }

  function serveDashboardHtml(req, res) {
    const htmlPath = path.join(__dirname, '..', 'dashboard', 'index.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.type('html').send(html);
    } catch {
      res.status(500).send('Dashboard HTML not found');
    }
  }

  function triggerDiscovery(req, res) {
    if (discoveryRunning) {
      return res.json({ status: 'already-running', message: 'Discovery is already running' });
    }
    const { runHeartbeatCycle } = require('../orchestrator.js');

    discoveryRunning = true;
    discoveryStopRequested = false;
    res.json({ status: 'started', message: 'Discovery cycle started...' });

    pushActivity('heartbeat', 'Discovery cycle starting...');

    runHeartbeatCycle({
      apiKey: process.env.APPPILOT_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
      appUrl: `http://localhost:${process.env.PORT || 5000}`,
      forceDiscovery: true,
      projectRoot: projectRoot,
    }).then(result => {
      discoveryRunning = false;
      pushActivity('success', 'Discovery complete: ' + (result.status || 'completed'));
      if (memoryStore) {
        memoryStore.logDaily(`Manual discovery triggered from dashboard: ${result.status || 'completed'}`);
      }
    }).catch(err => {
      discoveryRunning = false;
      pushActivity('error', 'Discovery failed: ' + err.message);
      if (memoryStore) {
        memoryStore.logDaily(`Manual discovery failed: ${err.message}`);
      }
    });
  }

  function triggerContinuous(req, res) {
    if (continuousRunning) {
      return res.json({ status: 'already-running', message: 'Continuous loop is already running' });
    }
    const { runHeartbeatCycle } = require('../orchestrator.js');

    continuousRunning = true;
    continuousStopRequested = false;
    res.json({ status: 'started', message: 'Continuous improvement loop started...' });

    const maxCycles = 5;
    let totalCycles = 0;
    let totalChangesApplied = 0;

    pushActivity('heartbeat', 'Continuous improvement loop starting...');

    async function runLoop() {
      for (let i = 0; i < maxCycles; i++) {
        if (continuousStopRequested) {
          pushActivity('warning', 'Continuous loop stopped by user');
          break;
        }
        if (i > 0) {
          const pause = 5000 + Math.random() * 5000;
          await new Promise(r => setTimeout(r, pause));
        }
        if (continuousStopRequested) break;
        try {
          const result = await runHeartbeatCycle({
            apiKey: process.env.APPPILOT_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
            appUrl: `http://localhost:${process.env.PORT || 5000}`,
            forceDiscovery: i === 0,
            projectRoot: projectRoot,
          });
          totalCycles++;
          if (result.steps) {
            totalChangesApplied += result.steps.filter(s => s.status === 'completed').length;
          }
          pushActivity('info', 'Continuous cycle ' + (i+1) + '/' + maxCycles + ' completed');
          if (memoryStore) {
            memoryStore.logDaily(`Continuous loop cycle ${i + 1}/${maxCycles} completed`);
          }
        } catch (err) {
          pushActivity('error', 'Continuous cycle ' + (i+1) + ' failed: ' + err.message);
          if (memoryStore) {
            memoryStore.logDaily(`Continuous loop cycle ${i + 1} failed: ${err.message}`);
          }
          if (err.message && (err.message.includes('429') || err.message.includes('rate limit'))) {
            if (memoryStore) memoryStore.logDaily('Rate limited — pausing 60s before next cycle');
            await new Promise(r => setTimeout(r, 60000));
          } else {
            break;
          }
        }
      }
      continuousRunning = false;
      pushActivity('success', 'Continuous loop completed: ' + totalCycles + ' cycles, ' + totalChangesApplied + ' changes');
      if (memoryStore) {
        memoryStore.logDaily(`Continuous loop completed: ${totalCycles} cycles, ${totalChangesApplied} changes`);
      }
    }

    runLoop().catch(err => {
      continuousRunning = false;
      pushActivity('error', 'Continuous loop failed: ' + err.message);
      if (memoryStore) {
        memoryStore.logDaily(`Continuous loop failed: ${err.message}`);
      }
    });
  }

  function triggerCrawl(req, res) {
    if (crawlRunning) {
      return res.json({ status: 'already-running', message: 'Crawl is already running' });
    }
    const { crawlSite } = require('../subagents/site-crawler.js');

    crawlRunning = true;
    res.json({ status: 'started', message: 'Site crawl started...' });

    pushActivity('info', 'Site crawl starting...');

    crawlSite({
      appUrl: `http://localhost:${process.env.PORT || 5000}`,
      maxPages: 50,
      dataDir: dataDir,
    }).then(result => {
      if (memoryStore) {
        memoryStore.logDaily(`Site crawl completed: ${result.pagesVisited} pages, ${result.errors.length} errors found`);

        if (result.errors.length > 0) {
          const knownErrors = memoryStore.loadKnownErrors();
          for (const crawlErr of result.errors.slice(0, 10)) {
            const sig = `crawl:${crawlErr.type}:${(crawlErr.message || '').slice(0, 80)}`;
            const existing = knownErrors.errors.find(e => e.signature === sig);
            if (!existing) {
              knownErrors.errors.push({
                signature: sig,
                message: crawlErr.message,
                status: 'new',
                occurrences: 1,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                source: 'site-crawler',
                severity: crawlErr.severity || 'medium',
                url: crawlErr.url,
              });
            } else {
              existing.occurrences = (existing.occurrences || 0) + 1;
              existing.lastSeen = new Date().toISOString();
            }
          }
          memoryStore.saveKnownErrors(knownErrors);
        }
      }
      crawlRunning = false;
      pushActivity('success', 'Crawl complete: ' + result.pagesVisited + ' pages, ' + result.errors.length + ' errors');
    }).catch(err => {
      crawlRunning = false;
      pushActivity('error', 'Crawl failed: ' + err.message);
      if (memoryStore) {
        memoryStore.logDaily(`Site crawl failed: ${err.message}`);
      }
    });
  }

  let discoveryRunning = false;
  let discoveryStopRequested = false;
  let continuousRunning = false;
  let continuousStopRequested = false;
  let crawlRunning = false;
  let elonRunning = false;
  let elonStopRequested = false;

  const elonProgress = {
    running: false,
    phase: 'idle',
    steps: [],
    currentConstraint: null,
    cycle: 0,
    maxCycles: 0,
    budget: { spent: 0, max: 0 },
    startedAt: null,
  };

  function elonStep(phase, message, detail, type) {
    elonProgress.phase = phase;
    const step = {
      id: 'step-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      phase,
      message,
      detail: detail || null,
      type: type || 'info',
      timestamp: new Date().toISOString(),
      duration: null,
    };
    elonProgress.steps.push(step);
    if (elonProgress.steps.length > 200) elonProgress.steps = elonProgress.steps.slice(-150);
    pushActivity(type === 'thinking' ? 'heartbeat' : type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', message);
    return step;
  }

  function triggerElon(req, res) {
    if (elonRunning) {
      return res.json({ status: 'already-running', message: 'ELON is already running' });
    }

    const apiKey = process.env.APPPILOT_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ status: 'failed', message: 'No API key configured. Set APPPILOT_ANTHROPIC_KEY or ANTHROPIC_API_KEY.' });
    }

    const { runElonLoop } = require('../elon.js');

    try {
      const flagPath = path.join(dataDir, 'elon-stop-requested');
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
    } catch {}

    elonRunning = true;
    elonStopRequested = false;

    const maxConstraints = parseInt(process.env.ELON_MAX_CONSTRAINTS) || 3;
    const budgetMax = parseFloat(process.env.ELON_BUDGET) || 5.0;

    elonProgress.running = true;
    elonProgress.phase = 'starting';
    elonProgress.steps = [];
    elonProgress.currentConstraint = null;
    elonProgress.cycle = 0;
    elonProgress.maxCycles = maxConstraints;
    elonProgress.budget = { spent: 0, max: budgetMax };
    elonProgress.startedAt = new Date().toISOString();

    elonStep('starting', 'ELON strategic loop starting...', null, 'thinking');

    res.json({ status: 'started', message: 'ELON strategic loop started...' });

    runElonLoop({
      apiKey,
      appUrl: `http://localhost:${process.env.PORT || 5000}`,
      maxConstraints,
      budgetMax,
      enableCrawl: true,
      projectRoot: projectRoot,
      memory: memoryStore,
      onProgress: (phase, message, detail, type) => {
        elonStep(phase, message, detail, type);
        if (phase === 'cycle-start') {
          elonProgress.cycle = parseInt(detail?.cycle) || elonProgress.cycle + 1;
        }
        if (detail?.budget) {
          elonProgress.budget.spent = detail.budget;
        }
        if (detail?.constraint) {
          elonProgress.currentConstraint = detail.constraint;
        }
      },
    }).then(result => {
      elonRunning = false;
      elonProgress.running = false;
      elonProgress.phase = 'complete';
      elonProgress.budget.spent = result.totalBudget || 0;
      elonStep('complete', `ELON complete: ${result.constraintsSolved} constraints solved, $${(result.totalBudget || 0).toFixed(2)} spent`, null, 'success');
      if (memoryStore) {
        memoryStore.logDaily(`ELON loop completed: ${result.constraintsSolved} constraints solved, $${(result.totalBudget || 0).toFixed(2)} spent`);
      }
    }).catch(err => {
      elonRunning = false;
      elonProgress.running = false;
      elonProgress.phase = 'error';
      elonStep('error', 'ELON failed: ' + err.message, null, 'error');
      if (memoryStore) {
        memoryStore.logDaily(`ELON loop failed: ${err.message}`);
      }
    });
  }

  function getElonStatus(req, res) {
    try {
      const { getElonStatus: _getElonStatus } = require('../elon.js');
      const status = _getElonStatus(dataDir);
      status.running = elonRunning;
      res.json(status);
    } catch (err) {
      res.json({ hasActiveConstraint: false, running: elonRunning, error: err.message });
    }
  }

  function stopElon(req, res) {
    elonStopRequested = true;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'elon-stop-requested'), 'stop');
    } catch (err) {
      console.warn('[ELON] Failed to write stop flag:', err.message);
    }
    pushActivity('warning', 'ELON stop requested by user');
    res.json({ status: 'stop-requested' });
  }

  function stopDiscovery(req, res) {
    discoveryStopRequested = true;
    pushActivity('warning', 'Discovery stop requested by user');
    res.json({ status: 'stop-requested' });
  }

  function stopContinuous(req, res) {
    continuousStopRequested = true;
    pushActivity('warning', 'Continuous loop stop requested by user');
    res.json({ status: 'stop-requested' });
  }

  function stopAll(req, res) {
    discoveryStopRequested = true;
    continuousStopRequested = true;
    elonStopRequested = true;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'elon-stop-requested'), 'stop');
    } catch {}
    pushActivity('warning', 'All operations stop requested by user');
    res.json({ status: 'stop-all-requested', discovery: discoveryRunning, continuous: continuousRunning, crawl: crawlRunning, elon: elonRunning });
  }

  function getRunningStatus(req, res) {
    res.json({
      discovery: discoveryRunning,
      continuous: continuousRunning,
      crawl: crawlRunning,
      elon: elonRunning,
    });
  }

  function getElonReport(req, res) {
    const reportPath = path.join(dataDir, 'elon-report-data.json');
    if (fs.existsSync(reportPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        res.json(data);
      } catch {
        res.json({ error: 'Failed to parse report' });
      }
    } else {
      res.json({ totalCycles: 0, constraintsSolved: 0, constraintsActive: 0, constraintLeaderboard: [], cycleHistory: [], crawlHistory: [] });
    }
  }

  function getCrawlResults(req, res) {
    const crawlFile = path.join(dataDir, 'crawl-errors.json');
    if (fs.existsSync(crawlFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(crawlFile, 'utf-8'));
        res.json(data);
      } catch {
        res.json({ errors: [], pagesVisited: 0 });
      }
    } else {
      res.json({ errors: [], pagesVisited: 0 });
    }
  }

  function getLiveActivity(req, res) {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    res.json({ activity: liveActivity.slice(0, limit) });
  }

  function mount(app) {
    app.get(`${basePath}/dashboard`, authMiddleware, serveDashboardHtml);

    app.get(`${basePath}/api/status`, authMiddleware, getStatus);
    app.get(`${basePath}/api/feed`, authMiddleware, getFeed);
    app.get(`${basePath}/api/errors`, authMiddleware, getErrors);
    app.get(`${basePath}/api/metrics`, authMiddleware, getMetrics);
    app.get(`${basePath}/api/queue`, authMiddleware, getQueue);
    app.post(`${basePath}/api/queue/:id/approve`, authMiddleware, approveQueueItem);
    app.post(`${basePath}/api/queue/:id/reject`, authMiddleware, rejectQueueItem);
    app.get(`${basePath}/api/security`, authMiddleware, getSecurity);
    app.post(`${basePath}/api/security/acknowledge`, authMiddleware, acknowledgeSecurity);
    app.post(`${basePath}/api/discover`, authMiddleware, triggerDiscovery);
    app.post(`${basePath}/api/continuous`, authMiddleware, triggerContinuous);
    app.post(`${basePath}/api/crawl`, authMiddleware, triggerCrawl);
    app.get(`${basePath}/api/crawl/results`, authMiddleware, getCrawlResults);

    app.get(`${basePath}/api/live-activity`, authMiddleware, getLiveActivity);

    app.post(`${basePath}/api/elon/start`, authMiddleware, triggerElon);
    app.get(`${basePath}/api/elon/status`, authMiddleware, getElonStatus);
    app.post(`${basePath}/api/elon/stop`, authMiddleware, stopElon);
    app.get(`${basePath}/api/elon/report`, authMiddleware, getElonReport);
    app.get(`${basePath}/api/elon/progress`, authMiddleware, (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      res.json({
        running: elonProgress.running,
        phase: elonProgress.phase,
        cycle: elonProgress.cycle,
        maxCycles: elonProgress.maxCycles,
        budget: elonProgress.budget,
        currentConstraint: elonProgress.currentConstraint,
        startedAt: elonProgress.startedAt,
        steps: elonProgress.steps.slice(-limit),
      });
    });

    app.get(`${basePath}/api/elon/settings`, authMiddleware, (req, res) => {
      try {
        const { getElonSettings } = require('../elon.js');
        res.json(getElonSettings(dataDir));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/elon/settings`, authMiddleware, (req, res) => {
      try {
        const { updateElonSettings } = require('../elon.js');
        const result = updateElonSettings(dataDir, req.body);
        owner.logOwnerAction('elon_settings_update', req.body, dataDir);
        pushActivity('info', 'ELON auto-approve settings updated');
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get(`${basePath}/api/elon/pending`, authMiddleware, (req, res) => {
      try {
        const { listPendingSpecs } = require('../elon.js');
        res.json({ specs: listPendingSpecs(dataDir) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/elon/pending/:id/approve`, authMiddleware, (req, res) => {
      try {
        const { approveSpec } = require('../elon.js');
        const result = approveSpec(dataDir, req.params.id);
        if (result.success) {
          owner.logOwnerAction('elon_spec_approve', { id: req.params.id }, dataDir);
          pushActivity('success', 'ELON spec approved: ' + req.params.id);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/elon/pending/:id/reject`, authMiddleware, (req, res) => {
      try {
        const { rejectSpec } = require('../elon.js');
        const result = rejectSpec(dataDir, req.params.id);
        if (result.success) {
          owner.logOwnerAction('elon_spec_reject', { id: req.params.id }, dataDir);
          pushActivity('warning', 'ELON spec rejected: ' + req.params.id);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/elon/pending/approve-all`, authMiddleware, (req, res) => {
      try {
        const { approveAllSpecs } = require('../elon.js');
        const result = approveAllSpecs(dataDir);
        if (result.success) {
          owner.logOwnerAction('elon_spec_approve_all', result, dataDir);
          pushActivity('success', `All ${result.approved} ELON specs approved`);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    let specsExecutionRunning = false;

    app.post(`${basePath}/api/elon/execute-approved`, authMiddleware, (req, res) => {
      if (specsExecutionRunning) {
        return res.json({ status: 'already-running', message: 'Specs are already being executed' });
      }

      const apiKey = process.env.APPPILOT_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.json({ status: 'failed', message: 'No API key configured.' });
      }

      specsExecutionRunning = true;
      res.json({ status: 'started', message: 'Executing approved specs...' });

      const { executeApprovedSpecs } = require('../elon.js');
      const budgetMax = parseFloat(process.env.ELON_BUDGET) || 5.0;

      executeApprovedSpecs({
        apiKey,
        projectRoot,
        dataDir,
        budgetMax,
        memory: memoryStore,
        onProgress: (phase, message, detail, type) => {
          pushActivity(type === 'thinking' ? 'heartbeat' : type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', message);
          if (elonProgress.steps) {
            elonProgress.steps.push({
              id: 'exec-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
              phase, message, detail: detail || null, type: type || 'info',
              timestamp: new Date().toISOString(), duration: null,
            });
            if (elonProgress.steps.length > 200) elonProgress.steps = elonProgress.steps.slice(-150);
          }
        },
      }).then(result => {
        specsExecutionRunning = false;
        pushActivity('success', `Specs execution complete: ${result.succeeded} succeeded, ${result.failed} failed`);
        if (memoryStore) {
          memoryStore.logDaily(`ELON specs execution: ${result.succeeded} succeeded, ${result.failed} failed, $${(result.budgetUsed || 0).toFixed(2)} spent`);
        }
      }).catch(err => {
        specsExecutionRunning = false;
        pushActivity('error', `Specs execution failed: ${err.message}`);
        if (memoryStore) {
          memoryStore.logDaily(`ELON specs execution failed: ${err.message}`);
        }
      });
    });

    app.get(`${basePath}/api/elon/execution-status`, authMiddleware, (req, res) => {
      res.json({ running: specsExecutionRunning });
    });

    app.post(`${basePath}/api/stop/discovery`, authMiddleware, stopDiscovery);
    app.post(`${basePath}/api/stop/continuous`, authMiddleware, stopContinuous);
    app.post(`${basePath}/api/stop/all`, authMiddleware, stopAll);
    app.get(`${basePath}/api/running`, authMiddleware, getRunningStatus);
  }

  return {
    mount,
    authMiddleware,
    getStatus,
    getFeed,
    getErrors,
    getMetrics,
    getQueue,
    approveQueueItem,
    rejectQueueItem,
    getSecurity,
    acknowledgeSecurity,
    serveDashboardHtml,
    getLiveActivity,
    _owner: owner,
    _rateLimiter: rateLimiter,
  };
}

function _getAgentName(projectRoot) {
  try {
    const soulPath = path.join(projectRoot, 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      const content = fs.readFileSync(soulPath, 'utf-8');
      const nameMatch = content.match(/^#\s+(.+)$/m);
      if (nameMatch) return nameMatch[1].trim();
      const fmMatch = content.match(/name:\s*(.+)/);
      if (fmMatch) return fmMatch[1].trim();
    }
  } catch {}
  return 'AppPilot';
}

function _computeStatus(knownErrors, identityProtection) {
  if (identityProtection) {
    const check = identityProtection.verify();
    if (!check.valid) return 'alert';
  }

  const critical = knownErrors.errors.filter(e => e.status === 'new');
  if (critical.length > 5) return 'degraded';

  return 'healthy';
}

function _countErrorsToday(knownErrors) {
  const today = new Date().toISOString().split('T')[0];
  return knownErrors.errors.filter(e => {
    const lastSeen = e.lastSeen || e.firstSeen || '';
    return lastSeen.startsWith(today);
  }).length;
}

function _countHeartbeats(memoryStore) {
  if (!memoryStore) return 0;
  try {
    const decisions = memoryStore.getRecentDecisions(100);
    return decisions.filter(d => d && d.action === 'heartbeat_complete').length;
  } catch {
    return 0;
  }
}

function _classifyEntry(message) {
  if (!message) return 'info';
  const lower = message.toLowerCase();
  if (lower.includes('critical') || lower.includes('halting') || lower.includes('tampering')) return 'critical';
  if (lower.includes('error') || lower.includes('failed') || lower.includes('down')) return 'error';
  if (lower.includes('warning') || lower.includes('warn')) return 'warning';
  if (lower.includes('heartbeat complete') || lower.includes('budget')) return 'heartbeat';
  if (lower.includes('fix') || lower.includes('resolved') || lower.includes('applied')) return 'success';
  if (lower.includes('security') || lower.includes('checksum') || lower.includes('identity')) return 'security';
  return 'info';
}

function _readQueueDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dirPath, f), 'utf-8'));
          return { id: f.replace('.json', ''), ...content };
        } catch {
          return { id: f.replace('.json', ''), error: 'parse_failed' };
        }
      });
  } catch {
    return [];
  }
}

module.exports = { createAdminDashboard };
