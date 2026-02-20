'use strict';

const path = require('path');
const { loadContext, buildSystemPrompt, parseHeartbeatConfig } = require('./context-loader');
const { IdentityProtection } = require('./security');
const { MemoryStore } = require('./memory');
const { sneeblyMiddleware } = require('./middleware');
const { createAdminDashboard } = require('./middleware/admin-dashboard');
const { Orchestrator, runHeartbeatCycle } = require('./orchestrator');
const { runElonCycle, runElonLoop, evaluateConstraint, getElonStatus } = require('./elon');
const { crawlSite, verifyCrawl } = require('./subagents/site-crawler');

function initSneebly(app, config = {}) {
  const {
    projectRoot = process.cwd(),
    identityDir,
    dataDir = '.sneebly',
    dashboardPath = '/sneebly/dashboard',
    enableMetrics = true,
    enableErrorTracking = true,
    enableHealth = true,
    enableDashboard = true,
  } = config;

  const resolvedIdentityDir = identityDir || projectRoot;
  const resolvedDataDir = path.isAbsolute(dataDir) ? dataDir : path.join(projectRoot, dataDir);

  const context = loadContext(resolvedIdentityDir);
  const memory = new MemoryStore(resolvedDataDir);
  memory.initialize();

  const identity = new IdentityProtection(resolvedIdentityDir, resolvedDataDir);
  identity.initialize();

  const hasSoul = context.soul !== null;
  const hasAgents = context.agents !== null;

  if (!hasSoul) {
    console.warn('[Sneebly] Warning: SOUL.md not found. Run `npx sneebly init` to scaffold identity files.');
  }
  if (!hasAgents) {
    console.warn('[Sneebly] Warning: AGENTS.md not found. Run `npx sneebly init` to scaffold identity files.');
  }

  const middleware = sneeblyMiddleware({
    dashboardPath: null,
    enableMetrics,
    enableErrorTracking,
    enableHealth,
    enableDashboard: false,
    context,
    memoryStore: memory,
  });

  app.use(middleware);

  if (enableDashboard) {
    const adminDashboard = createAdminDashboard({
      memoryStore: memory,
      metricsCollector: middleware._collector,
      identityProtection: identity,
      projectRoot,
      dataDir: resolvedDataDir,
      basePath: dashboardPath.replace(/\/dashboard\/?$/, ''),
    });
    adminDashboard.mount(app);
  }

  if (middleware._errorTracker) {
    app.use(middleware._errorTracker);
  }

  console.log(`[Sneebly] Initialized with project root: ${projectRoot}`);
  console.log(`[Sneebly] Dashboard: ${enableDashboard ? dashboardPath : 'disabled'}`);
  console.log(`[Sneebly] Health check: ${enableHealth ? '/health' : 'disabled'}`);
  console.log(`[Sneebly] Metrics: ${enableMetrics ? 'enabled' : 'disabled'}`);
  console.log(`[Sneebly] Error tracking: ${enableErrorTracking ? 'enabled' : 'disabled'}`);

  return {
    context,
    memory,
    identity,
    middleware,
  };
}

async function runHeartbeat(config = {}) {
  const { projectRoot = process.cwd() } = config;

  console.log(`[Sneebly] Running heartbeat for: ${projectRoot}`);

  const result = await runHeartbeatCycle({
    projectRoot,
    ...config,
  });

  return result;
}

module.exports = {
  sneeblyMiddleware,
  initSneebly,
  runHeartbeat,
  Orchestrator,
  MemoryStore,
  IdentityProtection,
  loadContext,
  buildSystemPrompt,
  parseHeartbeatConfig,
  runElonCycle,
  runElonLoop,
  evaluateConstraint,
  getElonStatus,
  crawlSite,
  verifyCrawl,
};
