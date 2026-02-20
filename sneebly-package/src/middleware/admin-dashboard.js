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
    dataDir = path.join(projectRoot, '.sneebly'),
    ownerConfig = {},
    basePath = '/sneebly',
  } = options;

  let specsFixesApplied = 0;

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
        fixesApplied: knownErrors.errors.filter(e => e.status === 'resolved').length + (specsFixesApplied || 0),
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
      apiKey: process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
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

  let frontendAuthLost = false;

  function triggerContinuous(req, res) {
    if (continuousRunning) {
      return res.json({ status: 'already-running', message: 'ELON continuous loop is already running' });
    }
    if (elonRunning) {
      return res.json({ status: 'already-running', message: 'ELON is already running a single cycle — wait for it to finish or stop it first' });
    }

    const { runElonLoop, getActiveConstraintCounts } = require('../elon.js');
    const { isSessionValid } = require('../subagents/site-crawler.js');

    const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ status: 'failed', message: 'No API key configured. Set SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY.' });
    }

    continuousRunning = true;
    continuousStopRequested = false;
    elonRunning = true;
    elonStopRequested = false;
    frontendAuthLost = false;

    try {
      const flagPath = path.join(dataDir, 'elon-stop-requested');
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
    } catch {}

    const maxRounds = parseInt(process.env.ELON_CONTINUOUS_MAX_ROUNDS) || 20;
    const budgetPerRound = parseFloat(process.env.ELON_BUDGET) || 5.0;
    const totalBudgetCap = parseFloat(process.env.ELON_CONTINUOUS_BUDGET) || 25.0;
    const constraintsPerRound = parseInt(process.env.ELON_MAX_CONSTRAINTS) || 3;

    elonProgress.running = true;
    elonProgress.phase = 'starting';
    elonProgress.steps = [];
    elonProgress.currentConstraint = null;
    elonProgress.cycle = 0;
    elonProgress.maxCycles = maxRounds;
    elonProgress.budget = { spent: 0, max: totalBudgetCap };
    elonProgress.startedAt = new Date().toISOString();

    res.json({ status: 'started', message: 'ELON continuous loop started — will keep running until all critical/high/medium issues are resolved' });

    const hadAuthAtStart = isSessionValid(dataDir);
    if (hadAuthAtStart) {
      pushActivity('heartbeat', 'ELON continuous starting with full mode (backend + frontend crawling)...');
    } else {
      pushActivity('heartbeat', 'ELON continuous starting in backend-only mode (sign in for ELON to enable frontend crawling)...');
    }

    let totalSpent = 0;
    let totalSolved = 0;
    let round = 0;

    async function runContinuousElonLoop() {
      for (round = 0; round < maxRounds; round++) {
        if (continuousStopRequested || elonStopRequested) {
          elonStep('stopped', 'ELON continuous: Stopped by user', null, 'warning');
          break;
        }

        if (totalSpent >= totalBudgetCap) {
          elonStep('budget-exhausted', `ELON continuous: Total budget exhausted ($${totalSpent.toFixed(2)}/$${totalBudgetCap.toFixed(2)})`, { budget: totalSpent }, 'warning');
          break;
        }

        const counts = getActiveConstraintCounts(dataDir);
        if (round > 0 && !counts.hasActionable) {
          elonStep('all-resolved', `ELON continuous: No more critical/high/medium constraints! (${counts.low} low-priority remain)`, { budget: totalSpent }, 'success');
          break;
        }

        const hasAuth = isSessionValid(dataDir);
        let crawlMode = hasAuth ? 'full' : 'backend-only';

        if (hadAuthAtStart && !hasAuth && !frontendAuthLost) {
          frontendAuthLost = true;
          elonStep('auth-lost', 'Frontend session expired — switching to backend-only mode. Sign in again to resume full crawling.', { budget: totalSpent }, 'warning');
          pushActivity('warning', 'ELON: Frontend auth expired — continuing with backend-only analysis. Sign in for ELON to restore full crawling.');
        } else if (frontendAuthLost && hasAuth) {
          frontendAuthLost = false;
          elonStep('auth-restored', 'Frontend session restored — resuming full crawling mode!', { budget: totalSpent }, 'success');
          pushActivity('success', 'ELON: Frontend auth restored — full crawling resumed.');
        }

        const modeLabel = crawlMode === 'full' ? 'full (backend + UI)' : 'backend-only';
        const roundBudget = Math.min(budgetPerRound, totalBudgetCap - totalSpent);
        elonStep('round-start', `ELON round ${round + 1}/${maxRounds} [${modeLabel}]: ${counts.total} active constraints (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium)`, { cycle: round + 1, budget: totalSpent, crawlMode }, 'thinking');
        elonProgress.cycle = round + 1;
        elonProgress.phase = crawlMode === 'full' ? 'running-full' : 'running-backend-only';

        try {
          const result = await runElonLoop({
            apiKey,
            appUrl: `http://localhost:${process.env.PORT || 5000}`,
            maxConstraints: constraintsPerRound,
            budgetMax: roundBudget,
            enableCrawl: true,
            crawlMode: crawlMode,
            projectRoot: projectRoot,
            memory: memoryStore,
            onProgress: (phase, message, detail, type) => {
              elonStep(phase, message, detail, type);
              if (detail?.budget) {
                elonProgress.budget.spent = totalSpent + (detail.budget || 0);
              }
              if (detail?.constraint) {
                elonProgress.currentConstraint = detail.constraint;
              }
            },
          });

          totalSpent += result.totalBudget || 0;
          totalSolved += result.constraintsSolved || 0;
          elonProgress.budget.spent = totalSpent;

          elonStep('round-done', `Round ${round + 1} complete: ${result.constraintsSolved} solved, $${(result.totalBudget || 0).toFixed(2)} spent this round`, { budget: totalSpent }, result.constraintsSolved > 0 ? 'success' : 'info');

        } catch (err) {
          elonStep('round-error', `Round ${round + 1} failed: ${err.message}`, { budget: totalSpent }, 'error');
          if (err.message && (err.message.includes('429') || err.message.includes('rate limit'))) {
            elonStep('rate-limited', 'Rate limited — pausing 60s before next round', { budget: totalSpent }, 'warning');
            await new Promise(r => setTimeout(r, 60000));
          }
        }

        if (round < maxRounds - 1 && !continuousStopRequested && !elonStopRequested) {
          elonStep('waiting', 'Waiting 10s before next round...', { budget: totalSpent }, 'info');
          await new Promise(r => setTimeout(r, 10000));
        }
      }

      continuousRunning = false;
      elonRunning = false;
      elonProgress.running = false;
      elonProgress.phase = 'complete';
      frontendAuthLost = false;

      const finalCounts = getActiveConstraintCounts(dataDir);
      elonStep('complete', `ELON continuous complete: ${round} rounds, ${totalSolved} solved, ${finalCounts.total} remaining, $${totalSpent.toFixed(2)} total spent`, { budget: totalSpent }, 'success');
      pushActivity('success', `ELON continuous complete: ${totalSolved} constraints solved across ${round} rounds, $${totalSpent.toFixed(2)} spent`);
      if (memoryStore) {
        memoryStore.logDaily(`ELON continuous completed: ${round} rounds, ${totalSolved} solved, $${totalSpent.toFixed(2)} spent`);
      }
    }

    runContinuousElonLoop().catch(err => {
      continuousRunning = false;
      elonRunning = false;
      elonProgress.running = false;
      elonProgress.phase = 'error';
      frontendAuthLost = false;
      elonStep('error', 'ELON continuous failed: ' + err.message, null, 'error');
      pushActivity('error', 'ELON continuous loop failed: ' + err.message);
      if (memoryStore) {
        memoryStore.logDaily(`ELON continuous loop failed: ${err.message}`);
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

  const crawlerSessionFile = path.join(dataDir, 'crawler-session.json');

  function saveCrawlerSession(sessionData) {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(crawlerSessionFile, JSON.stringify({
        ...sessionData,
        savedAt: new Date().toISOString(),
      }, null, 2));
      return true;
    } catch { return false; }
  }

  function loadCrawlerSession() {
    try {
      if (!fs.existsSync(crawlerSessionFile)) return null;
      const data = JSON.parse(fs.readFileSync(crawlerSessionFile, 'utf-8'));
      if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
        fs.unlinkSync(crawlerSessionFile);
        return null;
      }
      return data;
    } catch { return null; }
  }

  function getCrawlerSessionStatus(req, res) {
    const session = loadCrawlerSession();
    if (!session) {
      return res.json({ authenticated: false });
    }
    const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;
    const hoursRemaining = expiresAt ? Math.max(0, (expiresAt - Date.now()) / 3600000) : null;
    res.json({
      authenticated: true,
      userEmail: session.userEmail || 'unknown',
      userId: session.userId || 'unknown',
      savedAt: session.savedAt,
      expiresAt: session.expiresAt,
      hoursRemaining: hoursRemaining ? Math.round(hoursRemaining * 10) / 10 : null,
    });
  }

  function storeCrawlerSession(req, res) {
    const { sessionToken, userId, userEmail, expiresAt } = req.body || {};
    if (!sessionToken) {
      return res.status(400).json({ error: 'Missing sessionToken' });
    }
    const saved = saveCrawlerSession({ sessionToken, userId, userEmail, expiresAt });
    if (saved) {
      pushActivity('success', `ELON crawler signed in as ${userEmail || userId || 'admin'}`);
      if (memoryStore) {
        memoryStore.logDaily(`Crawler session stored for ${userEmail || userId}`);
      }
      res.json({ status: 'ok', message: 'Crawler session stored' });
    } else {
      res.status(500).json({ error: 'Failed to save session' });
    }
  }

  function clearCrawlerSession(req, res) {
    try {
      if (fs.existsSync(crawlerSessionFile)) fs.unlinkSync(crawlerSessionFile);
      pushActivity('info', 'ELON crawler session cleared');
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  function serveCrawlerLoginPage(req, res) {
    const clerkPubKey = process.env.CLERK_PUBLISHABLE_KEY || '';
    const sneeblyKey = req.query.key || '';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ELON Crawler - Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117; color: #e1e4e8;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card {
      background: #1a1b26; border: 1px solid #2a2b3a; border-radius: 12px;
      padding: 40px; max-width: 420px; width: 100%; text-align: center;
    }
    h2 { font-size: 1.4rem; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; }
    .status { margin: 20px 0; padding: 12px; border-radius: 8px; font-size: 0.85rem; }
    .status-waiting { background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.3); color: #58a6ff; }
    .status-success { background: rgba(63,185,80,0.1); border: 1px solid rgba(63,185,80,0.3); color: #3fb950; }
    .status-error { background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); color: #f85149; }
    .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #333; border-top-color: #7c3aed; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .info { font-size: 0.75rem; color: #636c76; margin-top: 16px; }
    .user-info { margin-top: 12px; font-size: 0.8rem; color: #8b949e; }
    .lock-icon { font-size: 2rem; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="lock-icon">&#128274;</div>
    <h2>Sign In for ELON Crawler</h2>
    <p class="subtitle">Log in with your admin account so ELON can crawl protected pages and find real issues.</p>
    <div id="status" class="status status-waiting">
      <span class="spinner"></span> Waiting for Clerk to load...
    </div>
    <div id="user-info" class="user-info" style="display:none"></div>
    <p class="info">Your session will be stored securely on the server. ELON will use it to crawl as an authenticated user. The session lasts until it expires in Clerk (typically 7+ days).</p>
  </div>

  <script>
    const CLERK_PUB_KEY = '${clerkPubKey}';
    const API_KEY = '${sneeblyKey}';
    const BASE_PATH = '${basePath}';

    function setStatus(text, type) {
      const el = document.getElementById('status');
      el.className = 'status status-' + type;
      el.innerHTML = (type === 'waiting' ? '<span class="spinner"></span> ' : '') + text;
    }

    async function storeSession(token, userId, email, expiresAt) {
      try {
        const resp = await fetch(BASE_PATH + '/api/crawler-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-sneebly-key': API_KEY },
          body: JSON.stringify({ sessionToken: token, userId, userEmail: email, expiresAt }),
        });
        const data = await resp.json();
        if (resp.ok) {
          setStatus('&#10003; Session stored! ELON can now crawl as ' + (email || userId) + '. You can close this window.', 'success');
          document.getElementById('user-info').style.display = 'block';
          document.getElementById('user-info').textContent = 'Signed in as: ' + (email || userId);
          if (window.opener) {
            window.opener.postMessage({ type: 'crawler-auth-success', email, userId }, window.location.origin);
          }
        } else {
          setStatus('Failed to store session: ' + (data.error || 'unknown error'), 'error');
        }
      } catch (err) {
        setStatus('Network error: ' + err.message, 'error');
      }
    }

    function loadClerk() {
      const script = document.createElement('script');
      script.setAttribute('data-clerk-publishable-key', CLERK_PUB_KEY);
      script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onerror = () => setStatus('Failed to load Clerk SDK', 'error');
      document.head.appendChild(script);

      waitForClerk();
    }

    function waitForClerk() {
      let attempts = 0;
      const maxAttempts = 50;
      const interval = setInterval(async () => {
        attempts++;
        if (window.Clerk && window.Clerk.loaded) {
          clearInterval(interval);
          await onClerkReady(window.Clerk);
        } else if (window.Clerk && typeof window.Clerk.load === 'function' && !window.Clerk.loaded) {
          clearInterval(interval);
          try {
            await window.Clerk.load();
            await onClerkReady(window.Clerk);
          } catch (err) {
            setStatus('Clerk load error: ' + err.message, 'error');
          }
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          setStatus('Timed out waiting for Clerk to load. Refresh and try again.', 'error');
        }
      }, 200);
    }

    async function onClerkReady(clerk) {
      try {
        if (clerk.user) {
          setStatus('Already signed in! Capturing session...', 'waiting');
          const token = await clerk.session.getToken();
          const email = clerk.user.primaryEmailAddress?.emailAddress || '';
          const userId = clerk.user.id;
          const exp = clerk.session.expireAt;
          await storeSession(token, userId, email, exp);
        } else {
          setStatus('Please sign in with your admin account...', 'waiting');
          clerk.addListener(async () => {
            if (clerk.user) {
              setStatus('Signed in! Capturing session...', 'waiting');
              const token = await clerk.session.getToken();
              const email = clerk.user.primaryEmailAddress?.emailAddress || '';
              const userId = clerk.user.id;
              const exp = clerk.session.expireAt;
              await storeSession(token, userId, email, exp);
            }
          });
          clerk.openSignIn({
            afterSignInUrl: window.location.href,
            afterSignUpUrl: window.location.href,
          });
        }
      } catch (err) {
        setStatus('Clerk error: ' + err.message, 'error');
      }
    }

    loadClerk();
  </script>
</body>
</html>`;
    res.type('html').send(html);
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

    const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ status: 'failed', message: 'No API key configured. Set SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY.' });
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
    elonStopRequested = true;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'elon-stop-requested'), 'stop');
    } catch {}
    pushActivity('warning', 'ELON continuous loop stop requested by user');
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
      frontendAuthLost: frontendAuthLost,
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

    app.get(`${basePath}/crawler-login`, authMiddleware, serveCrawlerLoginPage);
    app.get(`${basePath}/api/crawler-session`, authMiddleware, getCrawlerSessionStatus);
    app.post(`${basePath}/api/crawler-session`, authMiddleware, storeCrawlerSession);
    app.delete(`${basePath}/api/crawler-session`, authMiddleware, clearCrawlerSession);

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

    let specsExecutionRunning = false;

    function _specProgressHandler(prefix) {
      return (phase, message, detail, type) => {
        const activityType = type === 'thinking' ? 'heartbeat' : type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
        pushActivity(activityType, message);
        if (detail && detail.budget !== undefined) {
          elonProgress.budget.spent = detail.budget;
        }
        if (phase === 'spec-done') { elonProgress.cycle++; specsFixesApplied++; }
        if (phase === 'spec-failed' || phase === 'spec-error') { elonProgress.cycle++; }
        elonProgress.steps.push({
          id: prefix + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          phase, message, detail: detail || null, type: type || 'info',
          timestamp: new Date().toISOString(), duration: null,
        });
        if (elonProgress.steps.length > 200) elonProgress.steps = elonProgress.steps.slice(-150);
      };
    }

    function _handleSpecsComplete(result, label) {
      specsExecutionRunning = false;
      elonProgress.running = false;
      elonProgress.phase = 'complete';
      elonProgress.budget.spent = result.budgetUsed || 0;
      pushActivity('success', `${label}: ${result.succeeded} succeeded, ${result.failed} failed, $${(result.budgetUsed || 0).toFixed(2)} spent`);
      if (memoryStore) memoryStore.logDaily(`ELON ${label}: ${result.succeeded} succeeded, ${result.failed} failed, $${(result.budgetUsed || 0).toFixed(2)} spent`);
    }

    function _handleSpecsError(err, label) {
      specsExecutionRunning = false;
      elonProgress.running = false;
      elonProgress.phase = 'error';
      pushActivity('error', `${label} failed: ${err.message}`);
      if (memoryStore) memoryStore.logDaily(`ELON ${label} failed: ${err.message}`);
    }

    function triggerAutoExecute() {
      if (specsExecutionRunning) return;
      const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return;
      specsExecutionRunning = true;
      const { executeApprovedSpecs } = require('../elon.js');
      const budgetMax = parseFloat(process.env.ELON_BUDGET) || 5.0;

      const approvedDir = path.join(dataDir, 'approved-queue');
      let specCount = 0;
      try { specCount = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json')).length; } catch {}

      elonProgress.running = true;
      elonProgress.phase = 'executing-specs';
      elonProgress.startedAt = new Date().toISOString();
      elonProgress.budget = { spent: 0, max: budgetMax };
      elonProgress.cycle = 0;
      elonProgress.maxCycles = specCount;
      pushActivity('info', `Executing ${specCount} approved specs, $${budgetMax.toFixed(2)} budget`);

      executeApprovedSpecs({
        apiKey, projectRoot, dataDir, budgetMax, memory: memoryStore,
        onProgress: _specProgressHandler('exec-'),
      })
        .then(result => _handleSpecsComplete(result, 'specs auto-execution'))
        .catch(err => _handleSpecsError(err, 'specs auto-execution'));
    }

    app.post(`${basePath}/api/elon/pending/:id/approve`, authMiddleware, (req, res) => {
      try {
        const { approveSpec } = require('../elon.js');
        const result = approveSpec(dataDir, req.params.id);
        if (result.success) {
          owner.logOwnerAction('elon_spec_approve', { id: req.params.id }, dataDir);
          pushActivity('success', 'ELON spec approved: ' + req.params.id);
          triggerAutoExecute();
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
          triggerAutoExecute();
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/elon/execute-approved`, authMiddleware, (req, res) => {
      if (specsExecutionRunning) {
        return res.json({ status: 'already-running', message: 'Specs are already being executed' });
      }

      const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.json({ status: 'failed', message: 'No API key configured.' });
      }

      specsExecutionRunning = true;
      res.json({ status: 'started', message: 'Executing approved specs...' });

      const { executeApprovedSpecs } = require('../elon.js');
      const budgetMax = parseFloat(process.env.ELON_BUDGET) || 5.0;

      executeApprovedSpecs({
        apiKey, projectRoot, dataDir, budgetMax, memory: memoryStore,
        onProgress: _specProgressHandler('exec-'),
      })
        .then(result => _handleSpecsComplete(result, 'specs execution'))
        .catch(err => _handleSpecsError(err, 'specs execution'));
    });

    app.get(`${basePath}/api/elon/execution-status`, authMiddleware, (req, res) => {
      res.json({ running: specsExecutionRunning });
    });

    app.get(`${basePath}/api/build-state`, authMiddleware, (req, res) => {
      try {
        const { loadBuildState, getElonMode, getElonStatus } = require('../elon');
        const { loadContext } = require('../context-loader');
        const context = loadContext(projectRoot);
        const buildState = loadBuildState(dataDir);
        const mode = getElonMode({ context, dataDir });
        const status = getElonStatus(dataDir);
        res.json({
          mode,
          buildState: buildState || { currentPhase: 1, hasUnbuiltMilestones: false },
          currentConstraint: status.currentConstraint || null,
          currentMilestone: status.currentMilestone || null,
        });
      } catch (error) {
        res.json({ mode: 'unknown', buildState: null, error: error.message });
      }
    });

    app.post(`${basePath}/api/elon/mode`, authMiddleware, (req, res) => {
      try {
        const { saveElonLog } = require('../elon');
        const { mode } = req.body;
        if (!['build', 'fix', 'auto'].includes(mode)) {
          return res.status(400).json({ success: false, error: 'Mode must be: build, fix, or auto' });
        }
        saveElonLog(dataDir, { modeOverride: mode === 'auto' ? null : mode });
        owner.logOwnerAction('elon_mode_change', { mode }, dataDir);
        pushActivity('info', 'ELON mode set to: ' + mode.toUpperCase());
        res.json({ success: true, mode });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get(`${basePath}/api/elon/constraint-counts`, authMiddleware, (req, res) => {
      try {
        const { getActiveConstraintCounts } = require('../elon.js');
        res.json(getActiveConstraintCounts(dataDir));
      } catch (err) {
        res.json({ total: 0, critical: 0, high: 0, medium: 0, low: 0, hasActionable: false, error: err.message });
      }
    });

    let fixAllRunning = false;

    app.post(`${basePath}/api/elon/fix-all`, authMiddleware, (req, res) => {
      if (fixAllRunning || elonRunning || continuousRunning) {
        return res.json({ status: 'already-running', message: 'ELON is already running' });
      }
      const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.json({ status: 'failed', message: 'No API key configured.' });
      }

      fixAllRunning = true;
      elonRunning = true;
      elonProgress.running = true;
      elonProgress.phase = 'fix-all';
      elonProgress.startedAt = new Date().toISOString();
      elonProgress.steps = [];

      const budgetMax = parseFloat(req.body.budgetMax) || parseFloat(process.env.ELON_BUDGET) || 25.0;
      const maxRounds = parseInt(req.body.maxRounds) || 30;

      res.json({ status: 'started', message: `ELON Fix-All starting: max ${maxRounds} rounds, $${budgetMax.toFixed(2)} budget` });
      pushActivity('info', `ELON Fix-All mode activated: max ${maxRounds} rounds, $${budgetMax.toFixed(2)} budget`);
      owner.logOwnerAction('elon_fix_all_start', { budgetMax, maxRounds }, dataDir);

      const { runElonFixAll } = require('../elon.js');
      runElonFixAll({
        apiKey,
        appUrl: `http://localhost:${process.env.PORT || 5000}`,
        projectRoot,
        dataDir,
        budgetMax,
        maxRounds,
        enableCrawl: true,
        memory: memoryStore,
        onProgress: (phase, message, detail, type) => {
          pushActivity(type === 'thinking' ? 'heartbeat' : type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', message);
          elonProgress.phase = phase;
          if (detail && detail.round) elonProgress.cycle = detail.round;
          if (detail && detail.totalSpent !== undefined) elonProgress.budget = { spent: detail.totalSpent, max: budgetMax };
          elonProgress.steps.push({
            id: 'fixall-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            phase, message, detail: detail || null, type: type || 'info',
            timestamp: new Date().toISOString(), duration: null,
          });
          if (elonProgress.steps.length > 300) elonProgress.steps = elonProgress.steps.slice(-200);
        },
      }).then(result => {
        fixAllRunning = false;
        elonRunning = false;
        elonProgress.running = false;
        elonProgress.phase = 'complete';
        pushActivity('success', `ELON Fix-All complete: ${result.totalSolved} solved, ${result.remaining.total} remaining, $${result.totalSpent.toFixed(2)} spent`);
        if (memoryStore) memoryStore.logDaily(`ELON Fix-All: ${result.totalSolved} solved, $${result.totalSpent.toFixed(2)} spent`);
      }).catch(err => {
        fixAllRunning = false;
        elonRunning = false;
        elonProgress.running = false;
        elonProgress.phase = 'error';
        pushActivity('error', `ELON Fix-All failed: ${err.message}`);
        if (memoryStore) memoryStore.logDaily(`ELON Fix-All failed: ${err.message}`);
      });
    });

    app.post(`${basePath}/api/elon/reset`, authMiddleware, (req, res) => {
      if (fixAllRunning || elonRunning || continuousRunning) {
        return res.json({ success: false, message: 'Cannot reset while ELON is running. Stop it first.' });
      }
      try {
        const { resetElonState } = require('../elon.js');
        const result = resetElonState(dataDir);
        if (result.success) {
          owner.logOwnerAction('elon_state_reset', {}, dataDir);
          pushActivity('warning', 'ELON state reset — all constraint history cleared');
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    app.post(`${basePath}/api/stop/discovery`, authMiddleware, stopDiscovery);
    app.post(`${basePath}/api/stop/continuous`, authMiddleware, stopContinuous);
    app.post(`${basePath}/api/stop/all`, authMiddleware, stopAll);
    app.get(`${basePath}/api/running`, authMiddleware, getRunningStatus);

    setTimeout(() => {
      const approvedDir = path.join(dataDir, 'approved-queue');
      if (fs.existsSync(approvedDir)) {
        const files = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          pushActivity('info', `Found ${files.length} approved specs on startup, auto-executing...`);
          triggerAutoExecute();
        }
      }
    }, 5000);

    setInterval(() => {
      if (specsExecutionRunning) return;
      const approvedDir = path.join(dataDir, 'approved-queue');
      if (fs.existsSync(approvedDir)) {
        const files = fs.readdirSync(approvedDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) triggerAutoExecute();
      }
    }, 30000);

    app.get(`${basePath}/api/integration-health`, authMiddleware, async (req, res) => {
      try {
        const { runAllHealthChecks, loadLastHealthCheck } = require('../integration-health');
        const fresh = req.query.refresh === 'true';
        if (fresh) {
          const appUrl = `http://localhost:${process.env.PORT || 5000}`;
          const results = await runAllHealthChecks({ appUrl, dataDir, skipExpensive: !!req.query.skipExpensive });
          pushActivity('info', `Integration health check: ${results.overall} (${results.issues.length} issues)`);
          return res.json(results);
        }
        const cached = loadLastHealthCheck(dataDir);
        if (cached) return res.json(cached);
        const appUrl = `http://localhost:${process.env.PORT || 5000}`;
        const results = await runAllHealthChecks({ appUrl, dataDir, skipExpensive: true });
        res.json(results);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get(`${basePath}/api/scenario-results`, authMiddleware, (req, res) => {
      try {
        const { loadLastResults } = require('../scenario-runner');
        const results = loadLastResults(dataDir);
        res.json(results || { totalScenarios: 0, passed: 0, failed: 0, results: [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/run-scenarios`, authMiddleware, async (req, res) => {
      try {
        const { runScenarios } = require('../scenario-runner');
        const appUrl = `http://localhost:${process.env.PORT || 5000}`;
        let sessionData = null;
        try {
          const sessionFile = path.join(dataDir, 'crawler-session.json');
          if (fs.existsSync(sessionFile)) sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
        } catch {}
        res.json({ status: 'started', message: 'Running scenario tests...' });
        pushActivity('info', 'Running scenario tests...');
        runScenarios({ appUrl, dataDir, sessionData, scenarioIds: req.body.scenarioIds || null }).then(results => {
          pushActivity(results.failed > 0 ? 'warning' : 'success', `Scenarios: ${results.passed} passed, ${results.failed} failed`);
        }).catch(err => {
          pushActivity('error', `Scenario tests failed: ${err.message}`);
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get(`${basePath}/api/dev-mode`, authMiddleware, (req, res) => {
      try {
        const { getDevModeStatus } = require('../scenario-runner');
        const status = getDevModeStatus(dataDir);
        res.json(status);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post(`${basePath}/api/dev-mode`, authMiddleware, (req, res) => {
      try {
        const { setDevMode } = require('../scenario-runner');
        const { enabled } = req.body;
        const result = setDevMode(dataDir, enabled, req.body.userId || 'admin');
        owner.logOwnerAction(enabled ? 'dev_mode_enabled' : 'dev_mode_disabled', {}, dataDir);
        pushActivity(enabled ? 'warning' : 'info', enabled ? 'Dev/test mode ENABLED — test data features active. Remember to disable before deploying!' : 'Dev/test mode disabled — test data features deactivated');
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get(`${basePath}/api/regressions`, authMiddleware, (req, res) => {
      try {
        const { getRegressionSummary, getEscalatedIssues } = require('../regression-tracker');
        res.json({
          summary: getRegressionSummary(dataDir),
          escalated: getEscalatedIssues(dataDir, parseInt(req.query.minScore) || 3),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get(`${basePath}/api/dependency-index`, authMiddleware, (req, res) => {
      try {
        const { loadIndex } = require('../dependency-index');
        const index = loadIndex(dataDir);
        if (index) return res.json(index);
        const { buildDependencyIndex, saveIndex } = require('../dependency-index');
        const freshIndex = buildDependencyIndex(projectRoot);
        saveIndex(dataDir, freshIndex);
        res.json(freshIndex);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
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
  return 'Sneebly';
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
