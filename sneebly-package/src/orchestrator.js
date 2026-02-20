'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { loadContext, buildSystemPrompt, parseHeartbeatConfig } = require('./context-loader');
const { IdentityProtection, InputSanitizer, OutputValidator, CommandValidator } = require('./security');
const { MemoryStore } = require('./memory');
const { delegateToSubagent } = require('./subagents/dispatcher');
const { resolveError } = require('./subagents/error-resolver');
const { optimizePerformance } = require('./subagents/perf-optimizer');
const { analyzeCodebase } = require('./subagents/codebase-intel');
const { executeSpec } = require('./subagents/spec-executor');
const { selfImprove } = require('./subagents/self-improver');
const { crawlSite } = require('./subagents/site-crawler');
const { executeRalphLoop } = require('./ralph-loop');

const SUBAGENT_ORDER = [
  'error-resolver',
  'perf-optimizer',
  'codebase-intel',
  'spec-executor',
  'self-improver',
];

class Orchestrator {
  constructor(config = {}) {
    this.projectRoot = config.projectRoot || process.cwd();
    this.dataDir = config.dataDir || path.join(this.projectRoot, '.sneebly');
    this.identityDir = config.identityDir || this.projectRoot;
    this.apiKey = config.apiKey || process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    this.appUrl = config.appUrl || process.env.APP_URL || 'http://localhost:3000';
    this.dryRun = config.dryRun || false;
    this.forceDiscovery = config.forceDiscovery || false;
    this.enableCrawl = config.enableCrawl || false;

    this.templatesDir = config.templatesDir || path.join(__dirname, '..', 'templates');
    this.memory = new MemoryStore(this.dataDir);
    this.identity = new IdentityProtection(this.identityDir, this.dataDir);
    this.context = null;
    this.heartbeatConfig = null;
    this.dashboardStatus = null;
  }

  _subagentOptions(budget) {
    return {
      context: this.context,
      budget,
      memory: this.memory,
      apiKey: this.apiKey,
      identityDir: this.identityDir,
      templatesDir: this.templatesDir,
      dryRun: this.dryRun,
      dataDir: this.dataDir,
      projectRoot: this.projectRoot,
    };
  }

  initialize() {
    this.memory.initialize();
    this.identity.initialize();
    this.context = loadContext(this.identityDir);
    this.heartbeatConfig = parseHeartbeatConfig(this.context);
  }

  async runHeartbeatCycle() {
    const startTime = Date.now();
    const budget = { spent: 0, max: 0 };

    const result = {
      timestamp: new Date().toISOString(),
      status: 'completed',
      steps: [],
      actions: [],
      budgetUsed: 0,
      errors: [],
    };

    try {
      this.initialize();

      const integrityCheck = this.identity.verify();
      if (!integrityCheck.valid) {
        result.status = 'halted';
        result.errors.push({
          type: 'identity_tampering',
          details: integrityCheck.changes,
        });
        this.memory.logDaily(`CRITICAL: Identity file tampering detected: ${integrityCheck.changes.map(c => c.file).join(', ')}. HALTING.`);
        this._updateDashboardStatus('security-alert', integrityCheck.changes);
        return result;
      }
      result.steps.push({ step: 'identity_check', status: 'passed' });

      const processResult = this.memory.processErrorLog();
      result.steps.push({ step: 'process_error_log', status: 'completed', result: processResult });

      const systemPrompt = buildSystemPrompt(this.context);
      const config = this.heartbeatConfig;
      budget.max = config.maxBudget || 2.00;
      const recentMemory = this.memory.getRecentMemory(7, this.projectRoot);

      const opts = this._subagentOptions(budget);
      const healthOk = await this._checkAppHealth(config.healthTimeout || 10000);
      if (!healthOk) {
        result.steps.push({ step: 'health_check', status: 'app_down' });
        if (budget.spent < budget.max) {
          const diagResult = await resolveError(
            { message: `App unreachable at ${this.appUrl}`, signature: 'app-down' },
            opts
          );
          result.steps.push({ step: 'app_down_diagnosis', status: 'completed', result: diagResult });
          if (diagResult && diagResult.actions) {
            this._collectValidActions(diagResult.actions, result);
          }
        }
        this.memory.logDaily(`Health check failed for ${this.appUrl}. Focused on diagnosis.`);
        result.status = 'app_down';
        return result;
      }
      result.steps.push({ step: 'health_check', status: 'passed' });

      if (this.enableCrawl) {
        try {
          this.memory.logDaily('Site crawl started...');
          const crawlResult = await crawlSite({
            appUrl: this.appUrl,
            maxPages: 50,
            dataDir: this.dataDir,
          });
          result.steps.push({
            step: 'site_crawl',
            status: 'completed',
            result: { pagesVisited: crawlResult.pagesVisited, errorsFound: crawlResult.errors.length },
          });
          this.memory.logDaily(`Site crawl completed: ${crawlResult.pagesVisited} pages, ${crawlResult.errors.length} errors`);

          if (crawlResult.errors.length > 0) {
            const knownErrors = this.memory.loadKnownErrors();
            for (const crawlErr of crawlResult.errors.slice(0, 10)) {
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
            this.memory.saveKnownErrors(knownErrors);
          }
        } catch (crawlErr) {
          result.steps.push({ step: 'site_crawl', status: 'error', error: crawlErr.message });
          this.memory.logDaily(`Site crawl failed: ${crawlErr.message}`);
        }
      }

      if (budget.spent < budget.max) {
        const knownErrors = this.memory.loadKnownErrors();
        const newErrors = knownErrors.errors.filter(e => e.status === 'new').slice(0, 5);
        for (let i = 0; i < newErrors.length; i++) {
          if (budget.spent >= budget.max) break;
          if (i > 0) await this._rateLimitPause();
          const errResult = await resolveError(newErrors[i], opts);
          result.steps.push({ step: 'error_triage', status: 'completed', result: errResult });
          if (errResult && errResult.actions) {
            this._collectValidActions(errResult.actions, result);
          }
        }
      }

      if (budget.spent < budget.max) {
        await this._rateLimitPause();
        const perfResult = await optimizePerformance(
          this.memory.getMetricsSnapshots(10),
          { ...opts, threshold: config.perfThreshold }
        );
        result.steps.push({ step: 'perf_check', status: 'completed', result: perfResult });
      }

      if (budget.spent < budget.max) {
        const shouldDiscover = this._shouldRunDiscovery(config);
        if (shouldDiscover) {
          await this._rateLimitPause();
          const intelResult = await analyzeCodebase(opts);
          result.steps.push({ step: 'codebase_discovery', status: 'completed', result: intelResult });
          this._recordDiscoveryRun();
        }
      }

      if (budget.spent < budget.max) {
        const queueResult = await this._processApprovedQueue(budget);
        result.steps.push({ step: 'approved_queue', status: 'completed', result: queueResult });
      }

      const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

      if (budget.spent < budget.max && !this._discoveryRanThisCycle && dayOfWeek === (config.weeklySchedule.codebaseIntel || 'monday')) {
        const intelResult = await analyzeCodebase(opts);
        result.steps.push({ step: 'codebase_intel_weekly', status: 'completed', result: intelResult });
        this._recordDiscoveryRun();
      }

      if (budget.spent < budget.max && dayOfWeek === (config.weeklySchedule.selfImprovement || 'friday')) {
        const selfResult = await selfImprove(opts);
        result.steps.push({ step: 'self_improvement', status: 'completed', result: selfResult });
      }

    } catch (err) {
      result.status = 'error';
      result.errors.push({
        type: 'orchestrator_error',
        message: err.message,
        stack: err.stack,
      });
      this.memory.logDaily(`Orchestrator error: ${err.message}`);
    } finally {
      result.budgetUsed = budget.spent;
      const duration = Date.now() - startTime;
      const summary = InputSanitizer.sanitizeText(
        `Heartbeat complete. Budget: $${budget.spent.toFixed(3)}/${budget.max}. Duration: ${duration}ms.`
      );
      this.memory.logDaily(summary);
      this._updateDashboardStatus('complete', { budget, duration });
      this.memory.cleanupOldBackups(50);
      if (!this._discoveryRanThisCycle) {
        this._incrementDiscoveryCounter();
      }

      this.memory.logDecision({
        action: 'heartbeat_complete',
        status: result.status,
        stepsCount: result.steps.length,
        actionsCount: result.actions.length,
        errorsCount: result.errors.length,
        budgetUsed: budget.spent,
      });
    }

    return result;
  }

  _collectValidActions(actions, result) {
    for (const action of actions) {
      const validation = OutputValidator.validateAction(action);
      if (validation.valid) {
        result.actions.push(action);
      } else {
        result.errors.push({
          type: 'action_blocked',
          action,
          reasons: validation.reasons,
        });
      }
    }
  }

  async _checkAppHealth(timeout = 10000) {
    if (this.dryRun) return true;

    return new Promise((resolve) => {
      const protocol = this.appUrl.startsWith('https') ? https : http;
      const timer = setTimeout(() => resolve(false), timeout);

      try {
        const req = protocol.get(this.appUrl, (res) => {
          clearTimeout(timer);
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  async _processApprovedQueue(budget) {
    const approvedDir = path.join(this.dataDir, 'approved-queue');
    const fs = require('fs');

    if (!fs.existsSync(approvedDir)) {
      return { processed: 0, skipped: 0 };
    }

    const files = fs.readdirSync(approvedDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    let processed = 0;
    let skipped = 0;

    for (const file of files) {
      if (budget.spent >= budget.max) {
        skipped++;
        continue;
      }

      const specPath = path.join(approvedDir, file);

      try {
        const loopResult = await executeRalphLoop(specPath, this.context, budget, {
          projectRoot: this.projectRoot,
          dataDir: this.dataDir,
          memory: this.memory,
          apiKey: this.apiKey,
          identityDir: this.identityDir,
          templatesDir: this.templatesDir,
          dryRun: this.dryRun,
        });

        if (loopResult.status === 'completed' || loopResult.status === 'dry-run') {
          processed++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }

    return { processed, skipped };
  }

  async _runSubagent(name, budget, inputData) {
    return delegateToSubagent(name, inputData, this._subagentOptions(budget));
  }

  async _executeRalphLoop(spec, budget) {
    const result = {
      spec,
      status: 'pending',
      iterations: 0,
      maxIterations: 3,
    };

    const validation = OutputValidator.validateAction({
      type: 'file_edit',
      filePath: spec.filePath,
      newCode: spec.newCode,
    });

    if (!validation.valid) {
      result.status = 'blocked';
      result.reasons = validation.reasons;
      return result;
    }

    if (spec.testCommand) {
      const cmdCheck = CommandValidator.isAllowed(spec.testCommand);
      if (!cmdCheck.allowed) {
        result.status = 'blocked';
        result.reasons = [cmdCheck.reason];
        return result;
      }
    }

    if (this.dryRun) {
      result.status = 'dry_run';
      return result;
    }

    const opts = budget ? this._subagentOptions(budget) : this._subagentOptions({ spent: 0, max: 2 });

    for (let i = 0; i < result.maxIterations; i++) {
      result.iterations++;

      const execResult = await executeSpec(spec, opts);

      if (execResult.status === 'SPEC_COMPLETE') {
        result.status = 'SPEC_COMPLETE';
        break;
      }

      if (execResult.status === 'stuck') {
        result.status = 'stuck';
        result.reasons = [execResult.reason];
        break;
      }

      if (execResult.status === 'dry-run') {
        result.status = 'dry_run';
        break;
      }

      if (execResult.status === 'change') {
        const changeValidation = OutputValidator.validateAction({
          type: 'file_edit',
          filePath: execResult.filePath,
          newCode: execResult.newCode,
        });

        if (!changeValidation.valid) {
          result.status = 'blocked';
          result.reasons = changeValidation.reasons;
          break;
        }

        result.status = 'ready';
      }
    }

    this.memory.logDecision({
      action: 'ralph_loop_' + result.status,
      spec,
      iterations: result.iterations,
    });

    return result;
  }

  _shouldRunDiscovery(config) {
    if (this.forceDiscovery) return true;

    const interval = config.discoveryInterval;
    if (!interval || interval <= 0) return false;

    const counterFile = path.join(this.dataDir, 'discovery-counter.json');
    let counter = 0;
    try {
      const data = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
      counter = data.count || 0;
    } catch {}

    return (counter + 1) >= interval;
  }

  _recordDiscoveryRun() {
    this._discoveryRanThisCycle = true;
    const counterFile = path.join(this.dataDir, 'discovery-counter.json');
    try {
      fs.writeFileSync(counterFile, JSON.stringify({ count: 0, lastRun: new Date().toISOString() }));
    } catch {}
  }

  _incrementDiscoveryCounter() {
    const counterFile = path.join(this.dataDir, 'discovery-counter.json');
    let count = 0;
    try {
      const data = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
      count = data.count || 0;
    } catch {}
    try {
      fs.writeFileSync(counterFile, JSON.stringify({ count: count + 1, lastRun: null }));
    } catch {}
  }

  async _rateLimitPause() {
    const delay = 3000 + Math.random() * 2000;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  _updateDashboardStatus(status, data) {
    this.dashboardStatus = {
      status,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}

async function runHeartbeatCycle(config = {}) {
  const orchestrator = new Orchestrator(config);
  return orchestrator.runHeartbeatCycle();
}

module.exports = {
  Orchestrator,
  runHeartbeatCycle,
  SUBAGENT_ORDER,
};
