'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./subagents/dispatcher');
const { loadContext } = require('./context-loader');
const { crawlSite, verifyCrawl } = require('./subagents/site-crawler');
const { executeRalphLoop } = require('./ralph-loop');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const SENSITIVE_KEYWORDS = ['auth', 'security', 'permission', 'role', 'delete', 'drop', 'migration', 'schema', 'payment', 'billing', 'credential', 'secret', 'key'];

function _readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function _writeJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[ELON] Failed to write ${filePath}: ${err.message}`);
  }
}

function _loadElonLog(dataDir) {
  return _readJson(path.join(dataDir, 'elon-log.json'), { current: null, solved: [], history: [], failedAttempts: [] });
}

function _saveElonLog(dataDir, log) {
  _writeJson(path.join(dataDir, 'elon-log.json'), log);
}

function _loadElonReport(dataDir) {
  return _readJson(path.join(dataDir, 'elon-report-data.json'), null);
}

function _createLogger(memory) {
  return (msg) => {
    console.log(msg);
    if (memory) memory.logDaily(msg);
  };
}

function _aggregateCrawlIssues(crawlResults) {
  const allIssues = [
    ...(crawlResults.errors || []),
    ...(crawlResults.warnings || []),
    ...(crawlResults.performance || []),
    ...(crawlResults.consoleErrors || []),
    ...(crawlResults.networkFailures || []),
  ];
  allIssues.sort((a, b) => (SEVERITY_ORDER[a.severity] || 2) - (SEVERITY_ORDER[b.severity] || 2));
  crawlResults.allIssues = allIssues;
  return allIssues;
}

function _buildSubagentOptions(config) {
  return {
    context: config.context,
    budget: config.budget,
    apiKey: config.apiKey,
    identityDir: config.projectRoot,
    templatesDir: TEMPLATES_DIR,
    memory: config.memory,
  };
}

function _isStopRequested(dataDir) {
  const flagPath = path.join(dataDir, 'elon-stop-requested');
  if (fs.existsSync(flagPath)) {
    try { fs.unlinkSync(flagPath); } catch {}
    return true;
  }
  return false;
}

function _readSourceFiles(projectRoot) {
  const keyFiles = [
    'server/routes.ts', 'server/index.ts', 'server/storage.ts',
    'shared/schema.ts', 'client/src/App.tsx',
    'client/src/pages/Dashboard.tsx', 'client/src/pages/Home.tsx',
  ];

  const sections = [];

  for (const rel of keyFiles) {
    const fullPath = path.join(projectRoot, rel);
    try {
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const truncated = content.length > 6000 ? content.substring(0, 6000) + '\n// ... truncated ...' : content;
      sections.push(`// FILE: ${rel}\n${truncated}`);
    } catch {}
  }

  try {
    const serverDir = path.join(projectRoot, 'server', 'routes');
    if (fs.existsSync(serverDir)) {
      const routeFiles = fs.readdirSync(serverDir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
        .slice(0, 5);
      for (const rf of routeFiles) {
        try {
          const content = fs.readFileSync(path.join(serverDir, rf), 'utf-8');
          const truncated = content.length > 4000 ? content.substring(0, 4000) + '\n// ... truncated ...' : content;
          sections.push(`// FILE: server/routes/${rf}\n${truncated}`);
        } catch {}
      }
    }
  } catch {}

  return sections.join('\n\n---\n\n');
}

function _needsOwnerApproval(step) {
  const desc = (step.description || '').toLowerCase();
  return SENSITIVE_KEYWORDS.some(k => desc.includes(k));
}

async function _performCrawl(appUrl, dataDir, maxPages, log) {
  try {
    const crawlResults = await crawlSite({ appUrl, maxPages, dataDir, timeout: 12000 });
    const allIssues = _aggregateCrawlIssues(crawlResults);
    log(`ELON: Crawled ${crawlResults.pagesVisited} pages, found ${allIssues.length} issues`);
    _writeJson(path.join(dataDir, 'last-crawl.json'), crawlResults);
    return crawlResults;
  } catch (err) {
    log(`ELON: Crawl failed: ${err.message} — continuing with code analysis only`);
    return null;
  }
}

function _buildCrawlSummary(crawlResults) {
  if (!crawlResults) return { note: 'Crawl not available — analyze code only' };
  const issues = crawlResults.allIssues || [];
  return {
    pagesVisited: crawlResults.pagesVisited,
    totalIssues: issues.length,
    highSeverity: issues.filter(i => i.severity === 'high'),
    mediumSeverity: issues.filter(i => i.severity === 'medium'),
    topIssues: issues.slice(0, 20).map(i => ({
      type: i.type, message: i.message, url: i.url, severity: i.severity,
    })),
  };
}

async function runElonCycle(config) {
  const {
    apiKey,
    appUrl = 'http://localhost:5000',
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.apppilot'),
    maxSpecs = 10,
    budgetMax = 5.0,
    enableCrawl = true,
    memory = null,
    onProgress = null,
  } = config;

  const context = loadContext(projectRoot);
  const elonLog = _loadElonLog(dataDir);
  const previousReport = _loadElonReport(dataDir);
  const budget = { spent: 0, max: budgetMax };
  const log = _createLogger(memory);
  const progress = (phase, message, detail, type) => {
    log(message);
    if (onProgress) onProgress(phase, message, detail, type || 'info');
  };

  let crawlResults = null;
  if (enableCrawl) {
    progress('crawling', 'Crawling site with Playwright...', null, 'thinking');
    crawlResults = await _performCrawl(appUrl, dataDir, 30, log);
    const issueCount = crawlResults?.allIssues?.length || 0;
    const pageCount = crawlResults?.pagesVisited || 0;
    progress('crawl-done', `Crawl complete: ${pageCount} pages visited, ${issueCount} issues found`, { pages: pageCount, issues: issueCount }, issueCount > 0 ? 'warning' : 'success');
  }

  progress('reading-code', 'Reading source code and project context...', null, 'thinking');
  const sourceCode = _readSourceFiles(projectRoot);

  const task = {
    goals: context.goals ? (context.goals.content || context.raw.goals) : 'No GOALS.md found',
    soul: context.soul ? (context.soul.content || context.raw.soul) : 'No SOUL.md found',
    codebase: sourceCode.substring(0, 20000),
    crawlResults: _buildCrawlSummary(crawlResults),
    previousConstraints: elonLog.solved || [],
    currentConstraint: elonLog.current || null,
    previousReport: previousReport ? {
      constraintsSolved: previousReport.constraintsSolved || 0,
      activeConstraint: previousReport.activeConstraint || null,
      crawlHistory: (previousReport.crawlHistory || []).slice(-3),
      goalsProgress: previousReport.goalsProgress || null,
      qualityTargets: previousReport.qualityTargets || null,
      failedAttempts: previousReport.failedAttempts || [],
    } : null,
  };

  let analysis;
  try {
    progress('thinking', 'Asking Claude to identify the #1 limiting factor...', null, 'thinking');
    analysis = await delegateToSubagent('elon', task, _buildSubagentOptions({ context, budget, apiKey, projectRoot, memory }));
  } catch (err) {
    progress('error', `Analysis failed: ${err.message}`, null, 'error');
    return { status: 'failed', reason: 'ELON analysis failed: ' + err.message };
  }

  if (analysis && analysis.action === 'skip') {
    const reason = analysis.reason === 'invalid-api-key' ? 'Invalid API key — check APPPILOT_ANTHROPIC_KEY or ANTHROPIC_API_KEY'
      : analysis.reason === 'no-credits' ? 'No API credits — add funds to your Anthropic account'
      : analysis.reason || 'API unavailable';
    progress('error', `Stopped — ${reason}`, null, 'error');
    return { status: 'failed', reason };
  }

  if (!analysis || !analysis.limitingFactor) {
    progress('error', 'Could not identify a limiting factor', null, 'error');
    return { status: 'failed', reason: 'ELON could not identify a limiting factor', rawAnalysis: analysis };
  }

  progress('analysis-done', `Found limiting factor: ${analysis.limitingFactor.description}`, { why: analysis.limitingFactor.why, category: analysis.limitingFactor.category }, 'success');

  const constraint = {
    id: 'constraint-' + Date.now(),
    description: analysis.limitingFactor.description,
    why: analysis.limitingFactor.why,
    unblocks: analysis.limitingFactor.unblocks || [],
    score: analysis.limitingFactor.constraintScore || 5,
    category: analysis.limitingFactor.category || 'unknown',
    evidenceFromCrawl: analysis.limitingFactor.evidenceFromCrawl || [],
    goal: analysis.currentGoal || '',
    identifiedAt: new Date().toISOString(),
    status: 'active',
    steps: analysis.plan || [],
    verificationPages: analysis.verificationPages || [],
    completionCriteria: analysis.completionCriteria || '',
  };

  progress('planning', `Creating improvement specs for: ${constraint.description}`, { constraint: { description: constraint.description, score: constraint.score } }, 'thinking');

  const specsCreated = _createSpecs(constraint, dataDir, maxSpecs);

  elonLog.current = constraint;
  if (!elonLog.history) elonLog.history = [];
  elonLog.history.push(constraint);
  _saveElonLog(dataDir, elonLog);

  _writeElonReport(projectRoot, dataDir, { elonLog, crawlResults, constraint, specsCreated, budgetUsed: budget.spent });

  const autoApproved = specsCreated.filter(s => !s.needsApproval).length;
  const pendingApproval = specsCreated.filter(s => s.needsApproval).length;
  progress('specs-created', `Created ${specsCreated.length} improvement specs (${autoApproved} auto-approved, ${pendingApproval} need approval)`, { total: specsCreated.length, autoApproved, pendingApproval }, 'success');

  return {
    status: 'planned',
    constraint: { id: constraint.id, description: constraint.description, score: constraint.score, unblocks: constraint.unblocks, evidenceFromCrawl: constraint.evidenceFromCrawl },
    crawl: crawlResults ? { pagesVisited: crawlResults.pagesVisited, issuesFound: (crawlResults.allIssues || []).length } : null,
    specsCreated: specsCreated.length,
    specsAutoApproved: autoApproved,
    specsPendingApproval: pendingApproval,
    plan: specsCreated,
    budgetUsed: budget.spent,
  };
}

function _createSpecs(constraint, dataDir, maxSpecs) {
  const specsCreated = [];
  const approvedDir = path.join(dataDir, 'approved-queue');
  const pendingDir = path.join(dataDir, 'queue', 'pending');
  fs.mkdirSync(approvedDir, { recursive: true });
  fs.mkdirSync(pendingDir, { recursive: true });

  for (const step of constraint.steps) {
    if (specsCreated.length >= maxSpecs) break;

    const spec = {
      filePath: step.filePath,
      description: '[ELON] ' + step.description,
      successCriteria: step.successCriteria || [],
      testCommand: 'curl -s http://localhost:' + (process.env.PORT || 5000) + '/health',
      elonConstraintId: constraint.id,
      priority: step.priority || 'medium',
      step: step.step,
    };

    const needsApproval = _needsOwnerApproval(step);
    const targetDir = needsApproval ? pendingDir : approvedDir;
    const prefix = needsApproval ? 'pending' : 'approved';
    const filename = `elon-${constraint.id}-step${String(step.step).padStart(2, '0')}.json`;

    _writeJson(path.join(targetDir, filename), spec);
    specsCreated.push({ filename, dir: prefix, description: step.description, needsApproval });
  }

  return specsCreated;
}

async function evaluateConstraint(config) {
  const {
    apiKey,
    appUrl = 'http://localhost:5000',
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.apppilot'),
    enableCrawl = true,
    memory = null,
  } = config;

  const context = loadContext(projectRoot);
  const elonLog = _loadElonLog(dataDir);
  const budget = { spent: 0, max: 2.0 };
  const log = _createLogger(memory);

  if (!elonLog.current) {
    return { status: 'no-active-constraint' };
  }

  const constraint = elonLog.current;
  const { completedSteps, failedSteps } = _countStepProgress(dataDir, constraint.id);
  const remainingSteps = constraint.steps.length - completedSteps - failedSteps;

  if (remainingSteps > 0) {
    return { status: 'in-progress', constraint: constraint.description, completedSteps, failedSteps, remainingSteps, totalSteps: constraint.steps.length };
  }

  let crawlVerification = null;
  if (enableCrawl && constraint.verificationPages && constraint.verificationPages.length > 0) {
    log('ELON: Verifying fix with Playwright...');
    try {
      crawlVerification = await verifyCrawl({ appUrl, pagesToCheck: constraint.verificationPages });
      log(`ELON: Verification: ${crawlVerification.passed} passed, ${crawlVerification.failed} failed`);
    } catch (err) {
      log(`ELON: Verification crawl failed: ${err.message}`);
    }
  }

  let reCrawl = null;
  if (enableCrawl) {
    log('ELON: Re-crawling site to confirm fix...');
    reCrawl = await _performCrawl(appUrl, dataDir, 15, log);
  }

  const sourceCode = _readSourceFiles(projectRoot);
  const reCrawlIssues = reCrawl ? (reCrawl.allIssues || []) : [];
  const verifyTask = {
    constraint,
    completionCriteria: constraint.completionCriteria,
    codebase: sourceCode.substring(0, 15000),
    crawlVerification,
    reCrawlResults: reCrawl ? {
      pagesVisited: reCrawl.pagesVisited,
      totalIssues: reCrawlIssues.length,
      highSeverity: reCrawlIssues.filter(i => i.severity === 'high').length,
      issues: reCrawlIssues.slice(0, 10),
    } : null,
    completedSteps,
    failedSteps,
  };

  let evalResult;
  try {
    log('ELON: Asking Claude to evaluate constraint resolution...');
    evalResult = await delegateToSubagent('elon-evaluator', verifyTask, _buildSubagentOptions({ context, budget, apiKey, projectRoot, memory }));
  } catch (err) {
    log(`ELON: Evaluation failed: ${err.message}`);
    evalResult = { status: 'evaluation-failed', reason: err.message };
  }

  const resolved = evalResult && (evalResult.status === 'constraint-resolved' || evalResult.resolved === true);

  if (resolved) {
    constraint.status = 'solved';
    constraint.resolvedAt = new Date().toISOString();
    elonLog.solved.push({ id: constraint.id, description: constraint.description, score: constraint.score, resolvedAt: constraint.resolvedAt });
    elonLog.current = null;
    log(`ELON: Constraint SOLVED: ${constraint.description}`);
  } else {
    if (!elonLog.failedAttempts) elonLog.failedAttempts = [];
    elonLog.failedAttempts.push({
      constraint: constraint.description,
      reason: evalResult ? (evalResult.reason || 'verification-failed') : 'evaluation-failed',
      timestamp: new Date().toISOString(),
    });
    log(`ELON: Constraint NOT yet resolved: ${evalResult ? evalResult.reason || 'needs more work' : 'evaluation failed'}`);
  }

  _saveElonLog(dataDir, elonLog);
  _writeElonReport(projectRoot, dataDir, { elonLog, crawlResults: reCrawl, constraint, specsCreated: [], budgetUsed: budget.spent, verification: { crawlVerification, evalResult, resolved } });

  return {
    status: resolved ? 'constraint-resolved' : 'constraint-active',
    constraint: constraint.description,
    score: constraint.score,
    crawlVerification: crawlVerification ? { passed: crawlVerification.passed, failed: crawlVerification.failed, allPassed: crawlVerification.allPassed } : null,
    reCrawl: reCrawl ? { pagesVisited: reCrawl.pagesVisited, issuesFound: reCrawlIssues.length } : null,
    resolved,
    budgetUsed: budget.spent,
  };
}

function _countStepProgress(dataDir, constraintId) {
  let completedSteps = 0;
  let failedSteps = 0;
  try {
    const completedDir = path.join(dataDir, 'completed');
    if (fs.existsSync(completedDir)) {
      completedSteps = fs.readdirSync(completedDir).filter(f => f.includes(constraintId)).length;
    }
    const failedDir = path.join(dataDir, 'failed');
    if (fs.existsSync(failedDir)) {
      failedSteps = fs.readdirSync(failedDir).filter(f => f.includes(constraintId)).length;
    }
  } catch (err) {
    console.warn(`[ELON] Failed to count step progress: ${err.message}`);
  }
  return { completedSteps, failedSteps };
}

async function runElonLoop(config) {
  const {
    apiKey,
    appUrl = 'http://localhost:5000',
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.apppilot'),
    maxConstraints = 5,
    budgetMax = 10.0,
    enableCrawl = true,
    memory = null,
    onProgress = null,
  } = config;

  const log = _createLogger(memory);
  const progress = (phase, message, detail, type) => {
    log(message);
    if (onProgress) onProgress(phase, message, detail, type || 'info');
  };

  let totalBudget = 0;
  let constraintsSolved = 0;
  let constraintsAttempted = 0;

  progress('init', `ELON starting: ${maxConstraints} max cycles, $${budgetMax.toFixed(2)} budget`, { maxCycles: maxConstraints, budget: totalBudget }, 'thinking');

  for (let cycle = 0; cycle < maxConstraints; cycle++) {
    if (_isStopRequested(dataDir)) {
      progress('stopped', 'ELON: Stop requested — halting loop', null, 'warning');
      break;
    }
    if (totalBudget >= budgetMax) {
      progress('budget-exhausted', `ELON: Budget exhausted ($${totalBudget.toFixed(2)}/$${budgetMax.toFixed(2)})`, { budget: totalBudget }, 'warning');
      break;
    }

    progress('cycle-start', `Cycle ${cycle + 1}/${maxConstraints}: Starting analysis...`, { cycle: cycle + 1, budget: totalBudget }, 'thinking');

    const remainingBudget = budgetMax - totalBudget;

    const cycleResult = await runElonCycle({
      apiKey, appUrl, projectRoot, dataDir,
      budgetMax: Math.min(remainingBudget * 0.4, 3.0),
      enableCrawl, memory, onProgress,
    });

    totalBudget += cycleResult.budgetUsed || 0;

    if (cycleResult.status !== 'planned') {
      progress('cycle-failed', `Cycle ${cycle + 1} failed: ${cycleResult.reason || cycleResult.status}`, { budget: totalBudget }, 'error');
      break;
    }

    constraintsAttempted++;
    progress('constraint-found', `Constraint identified (score ${cycleResult.constraint.score}/10): ${cycleResult.constraint.description}`, { budget: totalBudget, constraint: { description: cycleResult.constraint.description, score: cycleResult.constraint.score, id: cycleResult.constraint.id } }, 'success');

    if (cycleResult.specsAutoApproved > 0 && totalBudget < budgetMax) {
      if (_isStopRequested(dataDir)) { progress('stopped', 'ELON: Stop requested — halting before spec execution', null, 'warning'); break; }

      progress('executing-specs', `Executing ${cycleResult.specsAutoApproved} auto-approved specs...`, { budget: totalBudget }, 'thinking');

      const specBudgetUsed = await _executeApprovedSpecs({
        dataDir, constraintId: cycleResult.constraint.id, projectRoot,
        budgetMax: Math.min(remainingBudget * 0.4, 3.0), apiKey, memory, log,
      });
      totalBudget += specBudgetUsed;
      progress('specs-done', `Specs executed. Budget: $${totalBudget.toFixed(2)}`, { budget: totalBudget }, 'info');
    }

    if (_isStopRequested(dataDir)) { progress('stopped', 'ELON: Stop requested — halting before evaluation', null, 'warning'); break; }

    if (totalBudget < budgetMax) {
      progress('evaluating', 'Evaluating whether constraint is resolved...', { budget: totalBudget }, 'thinking');
      const evalResult = await evaluateConstraint({ apiKey, appUrl, projectRoot, dataDir, enableCrawl, memory });
      totalBudget += evalResult.budgetUsed || 0;

      if (evalResult.resolved) {
        constraintsSolved++;
        progress('constraint-resolved', 'Constraint resolved! Moving to next...', { budget: totalBudget }, 'success');
      } else {
        progress('constraint-unresolved', `Constraint not yet resolved. Status: ${evalResult.status}`, { budget: totalBudget }, 'warning');
      }
    }

    if (cycle < maxConstraints - 1 && totalBudget < budgetMax) {
      progress('waiting', 'Waiting before next cycle...', { budget: totalBudget }, 'info');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  progress('complete', `ELON complete. Attempted: ${constraintsAttempted}, Solved: ${constraintsSolved}, Budget: $${totalBudget.toFixed(2)}`, { budget: totalBudget }, 'success');
  return { status: 'completed', constraintsAttempted, constraintsSolved, totalBudget };
}

async function _executeApprovedSpecs({ dataDir, constraintId, projectRoot, budgetMax, apiKey, memory, log }) {
  const context = loadContext(projectRoot);
  const specBudget = { spent: 0, max: budgetMax };
  const approvedDir = path.join(dataDir, 'approved-queue');

  try {
    const specFiles = fs.readdirSync(approvedDir)
      .filter(f => f.includes(constraintId))
      .sort();

    for (const specFile of specFiles) {
      if (specBudget.spent >= specBudget.max) break;
      if (_isStopRequested(dataDir)) { log('ELON: Stop requested — halting spec execution'); break; }

      const specPath = path.join(approvedDir, specFile);
      try {
        log(`ELON: Executing spec: ${specFile}`);
        const loopResult = await executeRalphLoop(specPath, context, specBudget, {
          projectRoot, dataDir, memory, apiKey,
          identityDir: projectRoot, templatesDir: TEMPLATES_DIR,
        });
        log(`ELON: Spec ${specFile}: ${loopResult.status}`);
      } catch (err) {
        log(`ELON: Spec ${specFile} failed: ${err.message}`);
      }
    }
  } catch (err) {
    log(`ELON: Failed to read approved specs: ${err.message}`);
  }

  return specBudget.spent;
}

function _writeElonReport(projectRoot, dataDir, data) {
  const { elonLog, crawlResults, constraint, specsCreated, budgetUsed, verification } = data;

  const reportData = _loadElonReport(dataDir) || {
    totalCycles: 0, constraintsSolved: 0, constraintsActive: 0,
    totalBudgetSpent: 0, pagesCrawled: 0, issuesFound: 0, issuesResolved: 0,
    constraintLeaderboard: [], crawlHistory: [], goalsProgress: [],
    qualityTargets: [], cycleHistory: [], failedAttempts: [],
  };

  reportData.totalCycles++;
  reportData.totalBudgetSpent += budgetUsed || 0;
  reportData.activeConstraint = constraint && constraint.status === 'active' ? constraint : null;

  if (crawlResults) {
    const issueCount = (crawlResults.allIssues || crawlResults.errors || []).length;
    reportData.pagesCrawled += crawlResults.pagesVisited;
    reportData.issuesFound += issueCount;
    reportData.crawlHistory.push({ timestamp: new Date().toISOString(), pagesVisited: crawlResults.pagesVisited, issuesFound: issueCount });
    if (reportData.crawlHistory.length > 10) reportData.crawlHistory = reportData.crawlHistory.slice(-10);
  }

  if (constraint) {
    const existing = reportData.constraintLeaderboard.find(c => c.id === constraint.id);
    if (existing) {
      existing.status = constraint.status;
      if (constraint.resolvedAt) existing.resolvedAt = constraint.resolvedAt;
    } else {
      reportData.constraintLeaderboard.push({
        id: constraint.id, description: constraint.description, score: constraint.score,
        status: constraint.status, category: constraint.category, goal: constraint.goal,
        identifiedAt: constraint.identifiedAt, evidenceFromCrawl: constraint.evidenceFromCrawl,
        unblocks: constraint.unblocks,
      });
    }
    reportData.constraintLeaderboard.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  if (verification && verification.resolved) {
    reportData.constraintsSolved++;
    reportData.issuesResolved++;
  }

  reportData.constraintsActive = reportData.constraintLeaderboard.filter(c => c.status === 'active').length;

  reportData.cycleHistory.push({
    cycle: reportData.totalCycles, timestamp: new Date().toISOString(),
    constraint: constraint ? constraint.description : 'N/A',
    score: constraint ? constraint.score : 0,
    specsCreated: specsCreated ? specsCreated.length : 0,
    budgetUsed: budgetUsed || 0,
    result: verification ? (verification.resolved ? 'solved' : 'active') : 'planned',
    crawlPages: crawlResults ? crawlResults.pagesVisited : 0,
    crawlIssues: crawlResults ? (crawlResults.allIssues || crawlResults.errors || []).length : 0,
  });
  if (reportData.cycleHistory.length > 20) reportData.cycleHistory = reportData.cycleHistory.slice(-20);

  if (elonLog.failedAttempts && elonLog.failedAttempts.length > 0) {
    reportData.failedAttempts = elonLog.failedAttempts.slice(-10);
  }

  _writeJson(path.join(dataDir, 'elon-report-data.json'), reportData);

  try {
    fs.writeFileSync(path.join(projectRoot, 'ELON-REPORT.md'), _generateReportMarkdown(reportData));
  } catch (err) {
    console.warn(`[ELON] Failed to write ELON-REPORT.md: ${err.message}`);
  }
}

function _generateReportMarkdown(data) {
  const lines = [
    '# ELON Strategic Report',
    '<!-- Auto-updated by AppPilot ELON engine after every cycle -->',
    `<!-- Last updated: ${new Date().toISOString()} -->`,
    '',
    '## Executive Summary',
    `- Total cycles run: ${data.totalCycles}`,
    `- Constraints solved: ${data.constraintsSolved}`,
    `- Constraints active: ${data.constraintsActive}`,
    `- Total budget spent: $${(data.totalBudgetSpent || 0).toFixed(2)}`,
    `- Pages crawled: ${data.pagesCrawled}`,
    `- Issues found: ${data.issuesFound}`,
    `- Issues resolved: ${data.issuesResolved}`,
    '',
    '## Constraint Leaderboard',
    '',
    '| Rank | Constraint | Score | Status | Category | Goal |',
    '|------|-----------|-------|--------|----------|------|',
  ];

  data.constraintLeaderboard.forEach((c, i) => {
    const icon = c.status === 'solved' ? '✅' : c.status === 'active' ? '🔴' : '⏳';
    lines.push(`| ${i + 1} | ${c.description.substring(0, 60)} | ${c.score}/10 | ${icon} ${c.status} | ${c.category || '-'} | ${(c.goal || '-').substring(0, 40)} |`);
  });
  lines.push('');

  if (data.crawlHistory.length > 0) {
    const latest = data.crawlHistory[data.crawlHistory.length - 1];
    lines.push('## Latest Crawl', `- Timestamp: ${latest.timestamp}`, `- Pages visited: ${latest.pagesVisited}`, `- Issues found: ${latest.issuesFound}`, '');
  }

  if (data.cycleHistory.length > 0) {
    lines.push('## Cycle History', '');
    for (const cycle of data.cycleHistory.slice(-10)) {
      lines.push(
        `### Cycle ${cycle.cycle} — ${cycle.timestamp}`,
        `- **Constraint:** ${cycle.constraint} (score: ${cycle.score}/10)`,
        `- **Crawl:** ${cycle.crawlPages} pages, ${cycle.crawlIssues} issues`,
        `- **Specs created:** ${cycle.specsCreated}`,
        `- **Result:** ${cycle.result}`,
        `- **Budget:** $${(cycle.budgetUsed || 0).toFixed(3)}`,
        '',
      );
    }
  }

  if (data.failedAttempts && data.failedAttempts.length > 0) {
    lines.push('## Failed Attempts', '');
    for (const fa of data.failedAttempts.slice(-5)) {
      lines.push(`- **${fa.constraint}** — ${fa.reason} (${fa.timestamp})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getElonStatus(dataDir) {
  const elonLog = _loadElonLog(dataDir);
  const reportData = _loadElonReport(dataDir);

  return {
    hasActiveConstraint: !!elonLog.current,
    currentConstraint: elonLog.current ? {
      id: elonLog.current.id,
      description: elonLog.current.description,
      score: elonLog.current.score,
      category: elonLog.current.category,
      status: elonLog.current.status,
      steps: (elonLog.current.steps || []).length,
      evidenceFromCrawl: elonLog.current.evidenceFromCrawl || [],
    } : null,
    solved: (elonLog.solved || []).length,
    history: (elonLog.history || []).length,
    report: reportData || null,
  };
}

module.exports = {
  runElonCycle,
  runElonLoop,
  evaluateConstraint,
  getElonStatus,
};
