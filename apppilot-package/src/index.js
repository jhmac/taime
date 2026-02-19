'use strict';

const path = require('path');
const { loadContext, buildSystemPrompt, parseHeartbeatConfig } = require('./context-loader');
const { IdentityProtection } = require('./security');
const { MemoryStore } = require('./memory');
const { apppilotMiddleware } = require('./middleware');
const { createAdminDashboard } = require('./middleware/admin-dashboard');
const { Orchestrator, runHeartbeatCycle } = require('./orchestrator');
const { runElonCycle, runElonLoop, evaluateConstraint, getElonStatus } = require('./elon');
const { crawlSite, verifyCrawl } = require('./subagents/site-crawler');

function initAppPilot(app, config = {}) {
  const {
    projectRoot = process.cwd(),
    identityDir,
    dataDir = '.apppilot',
    dashboardPath = '/apppilot/dashboard',
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
    console.warn('[AppPilot] Warning: SOUL.md not found. Run `npx apppilot init` to scaffold identity files.');
  }
  if (!hasAgents) {
    console.warn('[AppPilot] Warning: AGENTS.md not found. Run `npx apppilot init` to scaffold identity files.');
  }

  const middleware = apppilotMiddleware({
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

  console.log(`[AppPilot] Initialized with project root: ${projectRoot}`);
  console.log(`[AppPilot] Dashboard: ${enableDashboard ? dashboardPath : 'disabled'}`);
  console.log(`[AppPilot] Health check: ${enableHealth ? '/health' : 'disabled'}`);
  console.log(`[AppPilot] Metrics: ${enableMetrics ? 'enabled' : 'disabled'}`);
  console.log(`[AppPilot] Error tracking: ${enableErrorTracking ? 'enabled' : 'disabled'}`);

  return {
    context,
    memory,
    identity,
    middleware,
  };
}

async function runHeartbeat(config = {}) {
  const { projectRoot = process.cwd() } = config;

  console.log(`[AppPilot] Running heartbeat for: ${projectRoot}`);

  const result = await runHeartbeatCycle({
    projectRoot,
    ...config,
  });

  return result;
}

module.exports = {
  apppilotMiddleware,
  initAppPilot,
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
