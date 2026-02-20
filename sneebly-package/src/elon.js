'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./subagents/dispatcher');
const { loadContext } = require('./context-loader');
const { crawlSite, verifyCrawl, backendHealthCheck, isSessionValid } = require('./subagents/site-crawler');
const { executeRalphLoop } = require('./ralph-loop');
const { runAllHealthChecks, loadLastHealthCheck } = require('./integration-health');
const { runScenarios, loadLastResults: loadLastScenarioResults, getDevModeStatus } = require('./scenario-runner');
const { recordResult, getEscalatedIssues, getRegressionSummary } = require('./regression-tracker');
const { buildDependencyIndex, getFilesForEndpoint, getFilesForIntegration, saveIndex, loadIndex } = require('./dependency-index');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const AUTH_STATUS_CODES = new Set([401, 403]);
const AUTH_KEYWORDS = /\b(unauthorized|forbidden|auth|clerk|session|token)\b/i;
const CONSTRAINT_SIMILARITY_THRESHOLD = 0.6;
const SENSITIVE_CATEGORIES = {
  auth: ['auth', 'login', 'logout', 'session', 'token', 'oauth', 'sso'],
  security: ['security', 'vulnerability', 'exploit', 'injection', 'xss', 'csrf'],
  permissions: ['permission', 'role', 'access', 'admin', 'privilege'],
  database: ['migration', 'schema', 'drop', 'alter', 'table', 'column', 'index'],
  payments: ['payment', 'billing', 'stripe', 'charge', 'subscription', 'invoice'],
  deletions: ['delete', 'remove', 'purge', 'destroy', 'truncate'],
  credentials: ['credential', 'secret', 'key', 'password', 'api.?key', 'env'],
};

const SETTINGS_FILE = 'elon-settings.json';

// ============================================
// SHARED UTILITIES
// ============================================

const ELON_LOG_DEFAULTS = { current: null, solved: [], history: [], failedAttempts: [] };
const CODE_FILE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx']);
const SCAN_IGNORE_DIRS = new Set(['node_modules', '.sneebly', 'sneebly', 'dist', 'build', '.next', '.git']);
const SCAN_ROOT_DIRS = ['server', 'client/src', 'shared', 'src', 'routes', 'lib', 'pages', 'components', 'app'];

function _filePriority(relativePath) {
  if (/schema|model/i.test(relativePath)) return 0;
  if (/route/i.test(relativePath)) return 1;
  if (/service/i.test(relativePath)) return 2;
  if (/page|component/i.test(relativePath)) return 3;
  return 4;
}

function _safeReadFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function _makeProgressLogger(memory, onProgress) {
  const log = (msg) => {
    console.log(msg);
    if (memory) memory.logDaily(msg);
  };
  const progress = (phase, message, detail, type) => {
    log(message);
    if (onProgress) onProgress(phase, message, detail, type || 'info');
  };
  return { log, progress };
}

function _walkDir(dir, rootDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SCAN_IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(..._walkDir(fullPath, rootDir));
      } else if (CODE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        results.push({ relativePath: path.relative(rootDir, fullPath), fullPath });
      }
    }
  } catch {}
  return results;
}

// ============================================
// ELON LOG & STATE MANAGEMENT
// ============================================

function loadElonLog(dataDir) {
  return _readJson(path.join(dataDir, 'elon-log.json'), { ...ELON_LOG_DEFAULTS });
}

function saveElonLog(dataDir, updates) {
  const existing = loadElonLog(dataDir);
  const updated = { ...existing, ...updates, lastUpdated: new Date().toISOString() };
  _writeJson(path.join(dataDir, 'elon-log.json'), updated);
  return updated;
}

function loadBuildState(dataDir) {
  return _readJson(path.join(dataDir, 'build-state.json'), null);
}

function saveBuildState(dataDir, state) {
  _writeJson(path.join(dataDir, 'build-state.json'), state);
}

function loadLastCrawl(dataDir) {
  return _readJson(path.join(dataDir, 'last-crawl.json'), null);
}

// ============================================
// BUILD MODE HELPERS
// ============================================

function getElonMode(config) {
  const goalsContent = config.context?.goals?.content || '';
  const modeMatch = goalsContent.match(/\*\*mode:\s*(build|fix|auto)\*\*/i);
  const explicitMode = modeMatch ? modeMatch[1].toLowerCase() : 'auto';

  if (explicitMode === 'build') return 'build';
  if (explicitMode === 'fix') return 'fix';

  const elonLog = loadElonLog(config.dataDir);
  if (elonLog.modeOverride && elonLog.modeOverride !== 'auto') {
    return elonLog.modeOverride;
  }

  if (elonLog.lastMode === 'build' && elonLog.lastModeResult === 'specs-generated') {
    return 'fix';
  }

  if (elonLog.lastMode === 'fix' && elonLog.lastModeResult === 'no-constraints') {
    return 'build';
  }

  if (elonLog.lastMode === 'fix' && (elonLog.consecutiveFixCycles || 0) >= 3) {
    return 'build';
  }

  const buildState = loadBuildState(config.dataDir);
  if (buildState && buildState.hasUnbuiltMilestones) {
    const lastCrawl = loadLastCrawl(config.dataDir);
    const highErrors = lastCrawl?.errors?.filter(e => e.severity === 'high') || [];
    if (highErrors.length > 0) return 'fix';
    return 'build';
  }

  return 'fix';
}

function parseAppSpec(goalsContext) {
  const content = goalsContext?.content || '';

  const extract = (header) => {
    const regex = new RegExp(`## ${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n## (?!###)|$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  };

  const phaseMatch = content.match(/\*\*phase:\s*(\d+)\*\*/i);

  return {
    mission: extract('Mission'),
    architecture: extract('Architecture Context'),
    spec: extract('App Specification'),
    roadmap: extract('Roadmap'),
    alreadyBuilt: extract("What's Already Built"),
    qualityTargets: extract('Quality Targets'),
    technicalStandards: extract('Technical Standards'),
    currentPhase: phaseMatch ? parseInt(phaseMatch[1]) : 1
  };
}

function parseRoadmapMilestones(roadmapContent, phaseNumber) {
  const lines = roadmapContent.split('\n');
  const milestones = [];
  let currentPhase = 0;
  let inTargetPhase = false;

  for (const line of lines) {
    const phaseHeader = line.match(/###\s*Phase\s*(\d+)/i);
    if (phaseHeader) {
      currentPhase = parseInt(phaseHeader[1]);
      inTargetPhase = (currentPhase === phaseNumber);
      continue;
    }

    if (inTargetPhase && /^###\s/.test(line) && !line.match(/Phase/i)) {
      break;
    }

    if (!inTargetPhase) continue;

    const checkbox = line.match(/^-\s*\[([ xX])\]\s*(.+)/);
    if (checkbox) {
      milestones.push({
        completed: checkbox[1].toLowerCase() === 'x',
        description: checkbox[2].trim()
      });
    }
  }

  return milestones;
}

// ============================================
// CODEBASE SCANNING
// ============================================

function scanProjectFiles(projectRoot) {
  const seen = new Set();
  const files = [];

  for (const dir of SCAN_ROOT_DIRS) {
    const fullDir = path.join(projectRoot, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of _walkDir(fullDir, projectRoot)) {
      if (!seen.has(file.relativePath)) {
        seen.add(file.relativePath);
        files.push(file);
      }
    }
  }

  try {
    const rootEntries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && CODE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        if (!seen.has(entry.name)) {
          seen.add(entry.name);
          files.push({ relativePath: entry.name, fullPath: path.join(projectRoot, entry.name) });
        }
      }
    }
  } catch {}

  return files;
}

function _scanFileContents(files, filterFn, extractFn) {
  const results = [];
  for (const file of files) {
    if (filterFn && !filterFn(file)) continue;
    const content = _safeReadFile(file.fullPath);
    if (!content) continue;
    const extracted = extractFn(content, file);
    if (extracted) results.push(...extracted);
  }
  return results;
}

function findExistingRoutes(files) {
  return _scanFileContents(files, null, (content, file) => {
    const routes = [];
    const pattern = /(?:app|router|route)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      routes.push({ method: match[1].toUpperCase(), path: match[2], file: file.relativePath });
    }
    return routes.length > 0 ? routes : null;
  });
}

function findExistingSchema(files) {
  return _scanFileContents(
    files,
    (file) => /schema|model|migration|drizzle|prisma/i.test(file.relativePath),
    (content, file) => {
      const schemas = [];
      for (const m of content.matchAll(/(?:export\s+const|const)\s+(\w+)\s*=\s*pgTable\s*\(\s*['"`](\w+)['"`]/g)) {
        schemas.push({ variable: m[1], tableName: m[2], file: file.relativePath, orm: 'drizzle' });
      }
      for (const m of content.matchAll(/model\s+(\w+)\s*\{/g)) {
        schemas.push({ tableName: m[1], file: file.relativePath, orm: 'prisma' });
      }
      return schemas.length > 0 ? schemas : null;
    }
  );
}

function getRelevantCodeSnippets(files) {
  const snippets = {};
  let totalSize = 0;
  const maxSize = 15000;

  const sorted = [...files].sort((a, b) => _filePriority(a.relativePath) - _filePriority(b.relativePath));

  for (const file of sorted) {
    if (totalSize >= maxSize) break;
    const content = _safeReadFile(file.fullPath);
    if (!content) continue;
    const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n// ... (truncated)' : content;
    if (totalSize + truncated.length <= maxSize) {
      snippets[file.relativePath] = truncated;
      totalSize += truncated.length;
    }
  }
  return snippets;
}

// ============================================
// SHARED SPEC CREATION PIPELINE
// ============================================

function _createSpecsFromPlan({ plan, constraintId, constraintDesc, source, dataDir, maxSpecs, extraFields }) {
  const specsCreated = [];
  const approvedDir = path.join(dataDir, 'approved-queue');
  const pendingDir = path.join(dataDir, 'queue', 'pending');
  fs.mkdirSync(approvedDir, { recursive: true });
  fs.mkdirSync(pendingDir, { recursive: true });

  for (const step of plan) {
    if (maxSpecs && specsCreated.length >= maxSpecs) break;

    const isBuild = source === 'elon-build';
    const specId = isBuild
      ? `build-${Date.now()}-step${step.step}`
      : `elon-${constraintId}-step${String(step.step).padStart(2, '0')}`;

    const spec = {
      filePath: step.filePath,
      description: isBuild ? step.description : '[ELON] ' + step.description,
      successCriteria: step.successCriteria || [],
      testCommand: step.testCommand || 'curl -s http://localhost:' + (process.env.PORT || 5000) + '/health',
      source,
      createdAt: new Date().toISOString(),
    };

    if (isBuild) {
      spec.id = specId;
      spec.action = step.action || 'create';
      spec.relatedFiles = step.relatedFiles || [];
      spec.constraint = constraintDesc;
    } else {
      spec.elonConstraintId = constraintId;
      spec.priority = step.priority || 'medium';
      spec.step = step.step;
    }

    Object.assign(spec, extraFields);

    const approval = _needsOwnerApproval(step, dataDir);
    const targetDir = approval.needsApproval ? pendingDir : approvedDir;
    const filename = `${specId}.json`;

    if (approval.category) spec.blockedCategory = approval.category;
    _writeJson(path.join(targetDir, filename), spec);

    specsCreated.push({
      ...spec,
      filename,
      dir: approval.needsApproval ? 'pending' : 'approved',
      autoApproved: !approval.needsApproval,
      needsApproval: approval.needsApproval,
      blockedCategory: approval.category,
      path: path.join(targetDir, filename),
    });
  }

  return specsCreated;
}

async function runElonBuildCycle(config) {
  const { context, dataDir, projectRoot } = config;
  const { log } = _makeProgressLogger(config.memory);

  log('ELON BUILD: Starting build cycle...');

  const appSpec = parseAppSpec(context.goals);
  if (!appSpec.spec) {
    log('ELON BUILD: No App Specification found in GOALS.md');
    saveElonLog(dataDir, { lastMode: 'build', lastModeResult: 'no-spec' });
    return { status: 'no-spec', mode: 'build', message: 'No App Specification section in GOALS.md', budgetUsed: 0 };
  }

  const milestones = parseRoadmapMilestones(appSpec.roadmap, appSpec.currentPhase);
  const unbuilt = milestones.filter(m => !m.completed);

  if (unbuilt.length === 0) {
    log(`ELON BUILD: Phase ${appSpec.currentPhase} is complete!`);
    saveElonLog(dataDir, { lastMode: 'build', lastModeResult: 'cycle-complete', consecutiveFixCycles: 0 });
    saveBuildState(dataDir, {
      currentPhase: appSpec.currentPhase,
      phaseComplete: true,
      hasUnbuiltMilestones: false,
      lastUpdated: new Date().toISOString()
    });
    return { status: 'phase-complete', mode: 'build', phase: appSpec.currentPhase, budgetUsed: 0 };
  }

  const existingFiles = scanProjectFiles(projectRoot);
  const existingEndpoints = findExistingRoutes(existingFiles);
  const existingSchema = findExistingSchema(existingFiles);
  const codeSnippets = getRelevantCodeSnippets(existingFiles);

  const buildState = loadBuildState(dataDir) || { completed: [], failed: [] };
  const elonLog = loadElonLog(dataDir);

  log('ELON BUILD: Analyzing spec and codebase...');

  let analysis;
  try {
    analysis = await delegateToSubagent('elon-builder', {
      spec: appSpec.spec,
      mission: appSpec.mission,
      architecture: appSpec.architecture,
      technicalStandards: appSpec.technicalStandards,
      currentPhase: `Phase ${appSpec.currentPhase}`,
      roadmap: appSpec.roadmap,
      milestones,
      existingFiles: existingFiles.map(f => f.relativePath),
      existingEndpoints,
      existingSchema,
      alreadyBuilt: buildState.completed || [],
      failedHistory: elonLog.failedHistory || [],
      codebaseSnippets: codeSnippets
    }, _buildSubagentOptions(config));
  } catch (err) {
    log(`ELON BUILD: Analysis failed: ${err.message}`);
    saveElonLog(dataDir, { lastMode: 'build', lastModeResult: 'analysis-failed' });
    return { status: 'failed', mode: 'build', reason: err.message, budgetUsed: 0 };
  }

  if (!analysis || analysis.action === 'queue' || analysis.reason === 'parse-failed') {
    log('ELON BUILD: Could not identify build constraint');
    saveElonLog(dataDir, { lastMode: 'build', lastModeResult: 'no-constraint' });
    return { status: 'no-constraint', mode: 'build', budgetUsed: 0 };
  }

  if (analysis.action === 'skip') {
    const reason = analysis.reason || 'skipped';
    log(`ELON BUILD: Skipped — ${reason}`);
    return { status: 'failed', mode: 'build', reason, budgetUsed: 0 };
  }

  if (analysis.constraint === 'PHASE_COMPLETE') {
    saveElonLog(dataDir, { lastMode: 'build', lastModeResult: 'cycle-complete' });
    return { status: 'phase-complete', mode: 'build', phase: appSpec.currentPhase, budgetUsed: 0 };
  }

  if (analysis.constraint === 'BLOCKED') {
    log(`ELON BUILD: BLOCKED — ${analysis.reason}`);
    saveElonLog(dataDir, { lastMode: 'build', lastModeResult: 'blocked' });
    return { status: 'blocked', mode: 'build', reason: analysis.reason, budgetUsed: 0 };
  }

  log(`ELON BUILD: Constraint — ${analysis.constraint}`);

  const specs = _createSpecsFromPlan({
    plan: analysis.plan || [],
    constraintId: null,
    constraintDesc: analysis.constraint,
    source: 'elon-build',
    dataDir,
    extraFields: {
      phase: analysis.phase,
      milestone: analysis.milestone,
      buildNotes: analysis.buildNotes || '',
    },
  });

  for (const spec of specs) {
    log(
      `ELON BUILD: Spec ${spec.filename} — ${spec.action || 'create'} ${spec.filePath} ` +
      `[${spec.needsApproval ? 'pending approval' : 'auto-approved'}]`
    );
  }

  saveBuildState(dataDir, {
    currentPhase: appSpec.currentPhase,
    currentConstraint: analysis.constraint,
    currentMilestone: analysis.milestone,
    hasUnbuiltMilestones: true,
    specsGenerated: specs.length,
    lastBuildCycle: new Date().toISOString()
  });

  saveElonLog(dataDir, {
    lastMode: 'build',
    lastModeResult: 'specs-generated',
    currentConstraint: analysis.constraint,
    consecutiveFixCycles: 0,
  });

  return {
    status: 'specs-generated',
    mode: 'build',
    constraint: analysis.constraint,
    specs,
    phase: analysis.phase,
    milestone: analysis.milestone,
    budgetUsed: 0,
    specsAutoApproved: specs.filter(s => s.autoApproved).length,
    specsPendingApproval: specs.filter(s => s.needsApproval).length,
  };
}

function _loadElonSettings(dataDir) {
  const defaults = {};
  for (const cat of Object.keys(SENSITIVE_CATEGORIES)) {
    defaults[cat] = false;
  }
  const settingsPath = path.join(dataDir, SETTINGS_FILE);
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

function _saveElonSettings(dataDir, settings) {
  _writeJson(path.join(dataDir, SETTINGS_FILE), settings);
}

function getElonSettings(dataDir) {
  const settings = _loadElonSettings(dataDir);
  const categories = Object.keys(SENSITIVE_CATEGORIES).map(cat => ({
    id: cat,
    label: cat.charAt(0).toUpperCase() + cat.slice(1),
    keywords: SENSITIVE_CATEGORIES[cat],
    autoApprove: !!settings[cat],
  }));
  return { categories, raw: settings };
}

function updateElonSettings(dataDir, updates) {
  const settings = _loadElonSettings(dataDir);
  for (const [key, val] of Object.entries(updates)) {
    if (key in SENSITIVE_CATEGORIES) {
      settings[key] = !!val;
    }
  }
  _saveElonSettings(dataDir, settings);
  return getElonSettings(dataDir);
}

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

function _loadElonReport(dataDir) {
  return _readJson(path.join(dataDir, 'elon-report-data.json'), null);
}

function _tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
}

function _constraintSimilarity(descA, descB) {
  const tokensA = new Set(_tokenize(descA));
  const tokensB = new Set(_tokenize(descB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
  return intersection / Math.min(tokensA.size, tokensB.size);
}

function _isDuplicateConstraint(newDesc, existingConstraints) {
  for (const existing of existingConstraints) {
    const desc = existing.description || existing;
    if (_constraintSimilarity(newDesc, desc) >= CONSTRAINT_SIMILARITY_THRESHOLD) {
      return { isDuplicate: true, matchedDescription: desc };
    }
  }
  return { isDuplicate: false };
}

function _isAuthRelatedConstraint(constraint) {
  const desc = (constraint.description || '').toLowerCase();
  const evidence = constraint.evidenceFromCrawl || [];
  const authKeywords = ['401', '403', 'unauthorized', 'authentication', 'auth system', 'auth fail', 'clerk auth', 'auth integration', 'auth middleware', 'rbac'];
  const authHits = authKeywords.filter(kw => desc.includes(kw)).length;
  if (authHits >= 2) return true;
  const authEvidence = evidence.filter(e => AUTH_KEYWORDS.test(e) || /\b(401|403)\b/.test(e));
  if (authEvidence.length > 0 && authEvidence.length >= evidence.length * 0.5) return true;
  return false;
}

function _deepFilterAuthIssues(crawlResults) {
  if (!crawlResults) return;
  const filterAuth = (issues) => {
    if (!Array.isArray(issues)) return [];
    return issues.filter(i => {
      if (AUTH_STATUS_CODES.has(i.statusCode)) return false;
      const msg = (i.message || '').toLowerCase();
      if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) return false;
      if (i.type === 'api-error' && AUTH_STATUS_CODES.has(i.statusCode)) return false;
      return true;
    });
  };
  crawlResults.errors = filterAuth(crawlResults.errors);
  crawlResults.warnings = filterAuth(crawlResults.warnings);
  crawlResults.networkFailures = filterAuth(crawlResults.networkFailures);
  crawlResults.consoleErrors = filterAuth(crawlResults.consoleErrors);
  if (crawlResults.allIssues) {
    crawlResults.allIssues = filterAuth(crawlResults.allIssues);
  }
}

function _getBlockedConstraints(dataDir) {
  const elonLog = loadElonLog(dataDir);
  const reportData = _loadElonReport(dataDir);
  const blocked = [];
  for (const c of (elonLog.history || [])) {
    blocked.push(c.description);
  }
  if (reportData && reportData.constraintLeaderboard) {
    for (const c of reportData.constraintLeaderboard) {
      if (c.status === 'dismissed' || c.status === 'active') {
        blocked.push(c.description);
      }
    }
  }
  return [...new Set(blocked)];
}

function _aggregateCrawlIssues(crawlResults) {
  const rawIssues = [
    ...(crawlResults.errors || []),
    ...(crawlResults.warnings || []),
    ...(crawlResults.performance || []),
    ...(crawlResults.consoleErrors || []),
    ...(crawlResults.networkFailures || []),
  ];
  const allIssues = rawIssues.filter(i => {
    if (i.type === 'auth-expected') return false;
    if (i.severity === 'info') return false;
    if (i.type === 'api-error' && (i.statusCode === 401 || i.statusCode === 403)) return false;
    return true;
  });
  allIssues.sort((a, b) => (SEVERITY_ORDER[a.severity] || 2) - (SEVERITY_ORDER[b.severity] || 2));
  crawlResults.allIssues = allIssues;
  crawlResults.authExpected = rawIssues.filter(i => i.type === 'auth-expected' || (i.type === 'api-error' && (i.statusCode === 401 || i.statusCode === 403)));
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

function _readSourceFiles(projectRoot, constraint) {
  const sections = [];
  const seen = new Set();
  let totalChars = 0;
  const MAX_TOTAL = 25000;

  function addFile(rel, maxLen = 5000) {
    if (seen.has(rel) || totalChars >= MAX_TOTAL) return;
    seen.add(rel);
    const content = _safeReadFile(path.join(projectRoot, rel));
    if (!content) return;
    const truncated = content.length > maxLen ? content.substring(0, maxLen) + '\n// ... truncated ...' : content;
    sections.push(`// FILE: ${rel}\n${truncated}`);
    totalChars += truncated.length;
  }

  const coreFiles = [
    'server/index.ts', 'server/routes.ts', 'server/storage.ts',
    'shared/schema.ts', 'client/src/App.tsx',
  ];
  for (const f of coreFiles) addFile(f, 4000);

  const routeDirs = ['server/routes', 'server/middleware'];
  for (const dir of routeDirs) {
    try {
      const fullDir = path.join(projectRoot, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
        .sort();
      for (const rf of files) {
        addFile(`${dir}/${rf}`, 3000);
      }
    } catch {}
  }

  if (constraint && constraint.steps) {
    for (const step of constraint.steps) {
      if (step.filePath) addFile(step.filePath, 4000);
    }
  }

  if (constraint && constraint.evidenceFromCrawl) {
    const routePattern = /\/(api\/[a-z0-9\-_/]+)/gi;
    const mentionedRoutes = new Set();
    for (const evidence of constraint.evidenceFromCrawl) {
      let m;
      while ((m = routePattern.exec(evidence)) !== null) {
        mentionedRoutes.add(m[1].split('/')[1]);
      }
    }
    for (const routeName of mentionedRoutes) {
      for (const ext of ['.ts', '.js']) {
        addFile(`server/routes/${routeName}${ext}`, 4000);
      }
    }
  }

  try {
    const pagesDir = path.join(projectRoot, 'client', 'src', 'pages');
    if (fs.existsSync(pagesDir)) {
      const pages = fs.readdirSync(pagesDir)
        .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
        .slice(0, 8);
      for (const p of pages) {
        addFile(`client/src/pages/${p}`, 2000);
      }
    }
  } catch {}

  return sections.join('\n\n---\n\n');
}

function _needsOwnerApproval(step, dataDir) {
  const desc = (step.description || '').toLowerCase();
  const settings = dataDir ? _loadElonSettings(dataDir) : {};

  for (const [category, keywords] of Object.entries(SENSITIVE_CATEGORIES)) {
    if (settings[category]) continue;
    for (const kw of keywords) {
      if (kw.includes('?') || kw.includes('*')) {
        if (new RegExp(kw, 'i').test(desc)) return { needsApproval: true, category };
      } else if (desc.includes(kw)) {
        return { needsApproval: true, category };
      }
    }
  }
  return { needsApproval: false, category: null };
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

async function _performBackendCheck(appUrl, dataDir, log) {
  try {
    const results = await backendHealthCheck({ appUrl, dataDir });
    log(`ELON: Backend health check: ${results.endpointsChecked} endpoints, ${results.errors.length} issues`);
    results.allIssues = results.errors;
    return results;
  } catch (err) {
    log(`ELON: Backend health check failed: ${err.message}`);
    return null;
  }
}

async function _performIntegrationHealthCheck(appUrl, dataDir, log) {
  try {
    const healthResults = await runAllHealthChecks({ appUrl, dataDir, skipExpensive: true });
    log(`ELON: Integration health: ${healthResults.overall} (${healthResults.issues.length} issues across ${healthResults.integrations.length} integrations)`);

    for (const integration of healthResults.integrations) {
      recordResult(dataDir, {
        id: `integration:${integration.integration}`,
        type: 'integration-health',
        status: integration.status,
        message: integration.errors.length > 0 ? integration.errors[0] : `${integration.integration}: ${integration.status}`,
        details: integration.details,
      });
    }

    return healthResults;
  } catch (err) {
    log(`ELON: Integration health check failed: ${err.message}`);
    return null;
  }
}

async function _performScenarioTests(appUrl, dataDir, log) {
  try {
    const sessionFile = path.join(dataDir, 'crawler-session.json');
    let sessionData = null;
    try {
      if (fs.existsSync(sessionFile)) {
        sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      }
    } catch {}

    const scenarioResults = await runScenarios({
      appUrl,
      dataDir,
      sessionData,
      onProgress: (phase, message) => log(`ELON scenario: ${message}`),
    });

    log(`ELON: Scenarios: ${scenarioResults.passed} passed, ${scenarioResults.failed} failed out of ${scenarioResults.totalScenarios}`);

    for (const result of scenarioResults.results) {
      recordResult(dataDir, {
        id: `scenario:${result.id}`,
        type: 'scenario-test',
        status: result.status,
        message: result.status === 'failed'
          ? (result.steps.find(s => s.status === 'failed')?.error || 'Scenario failed')
          : `${result.name}: passed`,
        details: { steps: result.steps.length, pageErrors: result.pageErrors?.length || 0 },
      });
    }

    return scenarioResults;
  } catch (err) {
    log(`ELON: Scenario tests failed: ${err.message}`);
    return null;
  }
}

function _buildIntegrationSummary(healthResults, scenarioResults, dataDir) {
  const summary = { integrationIssues: [], scenarioFailures: [], regressions: [] };

  if (healthResults && healthResults.issues) {
    for (const issue of healthResults.issues) {
      summary.integrationIssues.push({
        integration: issue.integration,
        severity: issue.severity,
        message: issue.message,
        status: issue.status,
      });
    }
  }

  if (scenarioResults && scenarioResults.results) {
    for (const result of scenarioResults.results) {
      if (result.status === 'failed') {
        const failedStep = result.steps.find(s => s.status === 'failed');
        summary.scenarioFailures.push({
          scenario: result.name,
          category: result.category,
          priority: result.priority,
          failedStep: failedStep ? failedStep.description : 'unknown',
          error: failedStep ? failedStep.error : 'unknown',
          pageErrors: (result.pageErrors || []).slice(0, 3),
        });
      }
    }
  }

  if (dataDir) {
    summary.regressions = getEscalatedIssues(dataDir, 3);
  }

  return summary;
}

function _buildCrawlSummary(crawlResults) {
  if (!crawlResults) return { note: 'Crawl not available — analyze code only' };
  const issues = (crawlResults.allIssues || []).filter(i => !AUTH_STATUS_CODES.has(i.statusCode));
  const isAuthenticated = crawlResults.authenticated === true;
  const summary = {
    pagesVisited: crawlResults.pagesVisited,
    totalIssues: issues.length,
    authenticated: isAuthenticated,
    highSeverity: issues.filter(i => i.severity === 'high'),
    mediumSeverity: issues.filter(i => i.severity === 'medium'),
    topIssues: issues.slice(0, 20).map(i => ({
      type: i.type, message: i.message, url: i.url, severity: i.severity, statusCode: i.statusCode,
    })),
  };
  if (isAuthenticated) {
    summary.note = 'Crawler was authenticated. All errors are real issues visible to logged-in users.';
  } else {
    summary.note = 'Crawler was NOT authenticated. All 401/403 responses have been PRE-FILTERED and removed. The issues listed below are REAL bugs (404s, 500s, broken UI, etc). Do NOT report auth as a constraint.';
  }
  return summary;
}

async function runElonCycle(config) {
  const {
    apiKey,
    appUrl = 'http://localhost:5000',
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.sneebly'),
    maxSpecs = 10,
    budgetMax = 5.0,
    enableCrawl = true,
    memory = null,
    onProgress = null,
  } = config;

  const context = loadContext(projectRoot);

  const mode = getElonMode({ context, dataDir });
  if (memory) memory.logDaily(`ELON mode: ${mode}`);

  if (mode === 'build') {
    return await runElonBuildCycle({
      apiKey, appUrl, projectRoot, dataDir, budgetMax, memory, onProgress, context,
      budget: { spent: 0, max: budgetMax },
    });
  }

  const elonLog = loadElonLog(dataDir);
  const previousReport = _loadElonReport(dataDir);
  const budget = { spent: 0, max: budgetMax };
  const { log, progress } = _makeProgressLogger(memory, onProgress);

  let crawlResults = null;
  const crawlMode = config.crawlMode || (enableCrawl ? 'full' : false);
  if (crawlMode === 'full') {
    progress('crawling', 'Crawling site with Playwright (full UI + backend)...', null, 'thinking');
    crawlResults = await _performCrawl(appUrl, dataDir, 30, log);
    const issueCount = crawlResults?.allIssues?.length || 0;
    const pageCount = crawlResults?.pagesVisited || 0;
    progress('crawl-done', `Crawl complete: ${pageCount} pages visited, ${issueCount} issues found`, { pages: pageCount, issues: issueCount }, issueCount > 0 ? 'warning' : 'success');
  } else if (crawlMode === 'backend-only') {
    progress('backend-check', 'Running backend health check (no auth required)...', null, 'thinking');
    crawlResults = await _performBackendCheck(appUrl, dataDir, log);
    const issueCount = crawlResults?.errors?.length || 0;
    const epCount = crawlResults?.endpointsChecked || 0;
    progress('backend-check-done', `Backend check: ${epCount} endpoints, ${issueCount} issues`, { endpoints: epCount, issues: issueCount }, issueCount > 0 ? 'warning' : 'success');
  }

  if (crawlResults) {
    _deepFilterAuthIssues(crawlResults);
    _aggregateCrawlIssues(crawlResults);
  }

  progress('health-check', 'Running integration health checks...', null, 'thinking');
  let healthResults = null;
  let scenarioResults = null;
  try {
    healthResults = await _performIntegrationHealthCheck(appUrl, dataDir, log);
    if (healthResults && healthResults.issues.length > 0) {
      progress('health-issues', `Integration issues found: ${healthResults.issues.map(i => `${i.integration}: ${i.message}`).join(', ')}`, { issues: healthResults.issues.length }, 'warning');
    }
  } catch (err) { log(`ELON: Health check error: ${err.message}`); }

  progress('scenarios', 'Running scenario tests...', null, 'thinking');
  try {
    scenarioResults = await _performScenarioTests(appUrl, dataDir, log);
    if (scenarioResults && scenarioResults.failed > 0) {
      progress('scenario-failures', `${scenarioResults.failed} scenario(s) failed`, { failed: scenarioResults.failed }, 'warning');
    }
  } catch (err) { log(`ELON: Scenario test error: ${err.message}`); }

  const integrationSummary = _buildIntegrationSummary(healthResults, scenarioResults, dataDir);

  progress('building-index', 'Building dependency index...', null, 'thinking');
  let depIndex = null;
  try {
    depIndex = buildDependencyIndex(projectRoot);
    saveIndex(dataDir, depIndex);
  } catch (err) { log(`ELON: Dependency index error: ${err.message}`); }

  progress('reading-code', 'Reading source code and project context...', null, 'thinking');
  const sourceCode = _readSourceFiles(projectRoot, elonLog.current);

  const blockedConstraints = _getBlockedConstraints(dataDir);
  const failedHistory = (elonLog.failedAttempts || []).slice(-10).map(fa => ({
    constraint: fa.constraint,
    reason: fa.reason,
    timestamp: fa.timestamp,
  }));

  const task = {
    goals: context.goals ? (context.goals.content || context.raw.goals) : 'No GOALS.md found',
    soul: context.soul ? (context.soul.content || context.raw.soul) : 'No SOUL.md found',
    codebase: sourceCode.substring(0, 25000),
    crawlResults: _buildCrawlSummary(crawlResults),
    integrationHealth: integrationSummary,
    previousConstraints: elonLog.solved || [],
    currentConstraint: elonLog.current || null,
    blockedConstraints: blockedConstraints.slice(0, 30),
    failedHistory,
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
    const reason = analysis.reason === 'invalid-api-key' ? 'Invalid API key — check SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY'
      : analysis.reason === 'no-credits' ? 'No API credits — add funds to your Anthropic account'
      : analysis.reason || 'API unavailable';
    progress('error', `Stopped — ${reason}`, null, 'error');
    return { status: 'failed', reason };
  }

  if (!analysis || !analysis.limitingFactor) {
    progress('error', 'Could not identify a limiting factor', null, 'error');
    return { status: 'failed', reason: 'ELON could not identify a limiting factor', rawAnalysis: analysis };
  }

  const proposedConstraint = {
    description: analysis.limitingFactor.description,
    evidenceFromCrawl: analysis.limitingFactor.evidenceFromCrawl || [],
  };

  if (_isAuthRelatedConstraint(proposedConstraint)) {
    progress('auth-dismissed', `Dismissed auth-related constraint: ${analysis.limitingFactor.description}`, null, 'warning');
    const elonLogForDismiss = loadElonLog(dataDir);
    if (!elonLogForDismiss.history) elonLogForDismiss.history = [];
    elonLogForDismiss.history.push({
      id: 'constraint-' + Date.now(),
      description: analysis.limitingFactor.description,
      status: 'dismissed',
      dismissedReason: 'Auto-dismissed: auth-related constraint from unauthenticated crawl',
      dismissedAt: new Date().toISOString(),
    });
    saveElonLog(dataDir, elonLogForDismiss);
    return { status: 'dismissed', reason: 'Auth-related constraint auto-dismissed', constraint: analysis.limitingFactor.description };
  }

  const dupCheck = _isDuplicateConstraint(analysis.limitingFactor.description, blockedConstraints);
  if (dupCheck.isDuplicate) {
    progress('duplicate-dismissed', `Dismissed duplicate constraint: ${analysis.limitingFactor.description}`, null, 'warning');
    return { status: 'dismissed', reason: `Duplicate of previously identified: ${dupCheck.matchedDescription}`, constraint: analysis.limitingFactor.description };
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

  const specsCreated = _createSpecsFromPlan({
    plan: constraint.steps,
    constraintId: constraint.id,
    constraintDesc: constraint.description,
    source: 'elon-fix',
    dataDir,
    maxSpecs,
  });

  elonLog.current = constraint;
  if (!elonLog.history) elonLog.history = [];
  elonLog.history.push(constraint);
  saveElonLog(dataDir, elonLog);

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

async function evaluateConstraint(config) {
  const {
    apiKey,
    appUrl = 'http://localhost:5000',
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.sneebly'),
    enableCrawl = true,
    crawlMode = 'full',
    memory = null,
  } = config;

  const context = loadContext(projectRoot);
  const elonLog = loadElonLog(dataDir);
  const budget = { spent: 0, max: 2.0 };
  const { log } = _makeProgressLogger(memory);
  const canCrawlFrontend = enableCrawl && crawlMode !== 'backend-only';

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
  if (canCrawlFrontend && constraint.verificationPages && constraint.verificationPages.length > 0) {
    log('ELON: Verifying fix with Playwright...');
    try {
      crawlVerification = await verifyCrawl({ appUrl, pagesToCheck: constraint.verificationPages });
      log(`ELON: Verification: ${crawlVerification.passed} passed, ${crawlVerification.failed} failed`);
    } catch (err) {
      log(`ELON: Verification crawl failed: ${err.message}`);
    }
  }

  let reCrawl = null;
  if (canCrawlFrontend) {
    log('ELON: Re-crawling site to confirm fix...');
    reCrawl = await _performCrawl(appUrl, dataDir, 15, log);
  } else if (enableCrawl) {
    log('ELON: Backend-only mode — skipping Playwright verification');
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

  saveElonLog(dataDir, elonLog);
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
    dataDir = path.join(projectRoot, '.sneebly'),
    maxConstraints = 5,
    budgetMax = 10.0,
    enableCrawl = true,
    memory = null,
    onProgress = null,
  } = config;

  const { log, progress } = _makeProgressLogger(memory, onProgress);

  let totalBudget = 0;
  let constraintsSolved = 0;
  let constraintsAttempted = 0;
  let consecutiveDismissals = 0;
  const MAX_CONSECUTIVE_DISMISSALS = 5;

  progress('init', `ELON starting: ${maxConstraints} max cycles, $${budgetMax.toFixed(2)} budget`, { maxCycles: maxConstraints, budget: totalBudget }, 'thinking');

  for (let cycle = 0; cycle < maxConstraints + MAX_CONSECUTIVE_DISMISSALS; cycle++) {
    if (_isStopRequested(dataDir)) {
      progress('stopped', 'ELON: Stop requested — halting loop', null, 'warning');
      break;
    }
    if (totalBudget >= budgetMax) {
      progress('budget-exhausted', `ELON: Budget exhausted ($${totalBudget.toFixed(2)}/$${budgetMax.toFixed(2)})`, { budget: totalBudget }, 'warning');
      break;
    }
    if (consecutiveDismissals >= MAX_CONSECUTIVE_DISMISSALS) {
      progress('dismissal-limit', `ELON: ${MAX_CONSECUTIVE_DISMISSALS} consecutive constraints dismissed — Claude may be stuck in a loop. Stopping.`, { budget: totalBudget }, 'warning');
      break;
    }

    progress('cycle-start', `Cycle ${cycle + 1}: Starting analysis...`, { cycle: cycle + 1, budget: totalBudget }, 'thinking');

    const remainingBudget = budgetMax - totalBudget;

    const cycleResult = await runElonCycle({
      apiKey, appUrl, projectRoot, dataDir,
      budgetMax: Math.min(remainingBudget * 0.4, 3.0),
      enableCrawl, crawlMode: config.crawlMode,
      memory, onProgress,
    });

    totalBudget += cycleResult.budgetUsed || 0;

    if (cycleResult.mode === 'build') {
      saveElonLog(dataDir, { consecutiveFixCycles: 0 });
    } else {
      const currentLog = loadElonLog(dataDir);
      saveElonLog(dataDir, { consecutiveFixCycles: (currentLog.consecutiveFixCycles || 0) + 1 });
    }

    if (cycleResult.status === 'dismissed') {
      consecutiveDismissals++;
      progress('constraint-dismissed', `Constraint dismissed (${consecutiveDismissals}/${MAX_CONSECUTIVE_DISMISSALS}): ${cycleResult.reason || 'duplicate/auth'}`, { budget: totalBudget }, 'warning');
      continue;
    }

    consecutiveDismissals = 0;

    if (cycleResult.mode === 'build') {
      if (cycleResult.status === 'specs-generated') {
        constraintsAttempted++;
        progress('build-specs', `Build cycle generated ${cycleResult.specs?.length || 0} specs for: ${cycleResult.constraint}`, { budget: totalBudget }, 'success');
      } else {
        progress('build-done', `Build cycle: ${cycleResult.status}`, { budget: totalBudget }, cycleResult.status === 'phase-complete' ? 'success' : 'info');
      }
      continue;
    }

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
      const evalResult = await evaluateConstraint({ apiKey, appUrl, projectRoot, dataDir, enableCrawl, crawlMode: config.crawlMode, memory });
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
    '<!-- Auto-updated by Sneebly ELON engine after every cycle -->',
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

function getElonStatus(dataDir, config) {
  const elonLog = loadElonLog(dataDir);
  const reportData = _loadElonReport(dataDir);
  const buildStateData = loadBuildState(dataDir);

  let currentMode = 'fix';
  if (config && config.context) {
    try { currentMode = getElonMode({ context: config.context, dataDir }); } catch {}
  } else {
    currentMode = elonLog.lastMode || 'fix';
  }

  return {
    mode: currentMode,
    buildState: buildStateData,
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

function getActiveConstraintCounts(dataDir) {
  const reportData = _loadElonReport(dataDir);
  if (!reportData || !reportData.constraintLeaderboard) {
    return { total: 0, critical: 0, high: 0, medium: 0, low: 0, hasActionable: false };
  }
  const active = reportData.constraintLeaderboard.filter(c => c.status === 'active');
  const critical = active.filter(c => (c.score || 0) >= 9);
  const high = active.filter(c => (c.score || 0) >= 7 && (c.score || 0) < 9);
  const medium = active.filter(c => (c.score || 0) >= 4 && (c.score || 0) < 7);
  const low = active.filter(c => (c.score || 0) < 4);
  return {
    total: active.length,
    critical: critical.length,
    high: high.length,
    medium: medium.length,
    low: low.length,
    hasActionable: critical.length > 0 || high.length > 0 || medium.length > 0,
    highest: active.length > 0 ? active[0] : null,
  };
}

function listPendingSpecs(dataDir) {
  const pendingDir = path.join(dataDir, 'queue', 'pending');
  if (!fs.existsSync(pendingDir)) return [];
  try {
    return fs.readdirSync(pendingDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf-8'));
          return { id: f.replace('.json', ''), filename: f, ...content };
        } catch {
          return { id: f.replace('.json', ''), filename: f, error: 'parse_failed' };
        }
      })
      .sort((a, b) => (b.constraint?.score || b.score || 0) - (a.constraint?.score || a.score || 0));
  } catch {
    return [];
  }
}

function approveSpec(dataDir, specId) {
  const pendingDir = path.join(dataDir, 'queue', 'pending');
  const approvedDir = path.join(dataDir, 'approved-queue');
  const filename = specId.endsWith('.json') ? specId : specId + '.json';
  const sourcePath = path.join(pendingDir, filename);
  if (!fs.existsSync(sourcePath)) return { success: false, error: 'Spec not found' };
  fs.mkdirSync(approvedDir, { recursive: true });
  fs.renameSync(sourcePath, path.join(approvedDir, filename));
  return { success: true, action: 'approved', id: specId };
}

function rejectSpec(dataDir, specId) {
  const pendingDir = path.join(dataDir, 'queue', 'pending');
  const rejectedDir = path.join(dataDir, 'rejected-queue');
  const filename = specId.endsWith('.json') ? specId : specId + '.json';
  const sourcePath = path.join(pendingDir, filename);
  if (!fs.existsSync(sourcePath)) return { success: false, error: 'Spec not found' };
  fs.mkdirSync(rejectedDir, { recursive: true });
  fs.renameSync(sourcePath, path.join(rejectedDir, filename));
  return { success: true, action: 'rejected', id: specId };
}

function approveAllSpecs(dataDir) {
  const specs = listPendingSpecs(dataDir);
  let approved = 0;
  for (const spec of specs) {
    const result = approveSpec(dataDir, spec.filename || spec.id + '.json');
    if (result.success) approved++;
  }
  return { success: true, approved, total: specs.length };
}

async function executeApprovedSpecs(config) {
  const {
    apiKey,
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.sneebly'),
    budgetMax = 5.0,
    memory = null,
    onProgress = null,
  } = config;

  const context = loadContext(projectRoot);
  const specBudget = { spent: 0, max: budgetMax };
  const approvedDir = path.join(dataDir, 'approved-queue');
  const { log, progress } = _makeProgressLogger(memory, onProgress);

  if (!fs.existsSync(approvedDir)) {
    return { status: 'no-specs', executed: 0, succeeded: 0, failed: 0, budgetUsed: 0 };
  }

  const specFiles = fs.readdirSync(approvedDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const spec = JSON.parse(fs.readFileSync(path.join(approvedDir, f), 'utf8'));
        return { file: f, score: spec.constraint?.score || spec.score || 0 };
      } catch { return { file: f, score: 0 }; }
    })
    .sort((a, b) => b.score - a.score)
    .map(s => s.file);

  if (specFiles.length === 0) {
    return { status: 'no-specs', executed: 0, succeeded: 0, failed: 0, budgetUsed: 0 };
  }

  progress('executing', `Executing ${specFiles.length} approved specs...`, { total: specFiles.length }, 'thinking');

  let executed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const specFile of specFiles) {
    if (specBudget.spent >= specBudget.max) {
      progress('budget-limit', `Budget limit reached ($${specBudget.spent.toFixed(2)}/$${specBudget.max.toFixed(2)})`, null, 'warning');
      break;
    }
    if (_isStopRequested(dataDir)) {
      progress('stopped', 'Execution stopped by user', null, 'warning');
      break;
    }

    const specPath = path.join(approvedDir, specFile);
    try {
      progress('spec-executing', `Executing: ${specFile}`, { file: specFile }, 'thinking');
      const loopResult = await executeRalphLoop(specPath, context, specBudget, {
        projectRoot, dataDir, memory, apiKey,
        identityDir: projectRoot, templatesDir: TEMPLATES_DIR,
      });
      executed++;
      if (loopResult.status === 'completed' || loopResult.status === 'success') {
        succeeded++;
        progress('spec-done', `Spec completed: ${specFile}`, { file: specFile, status: loopResult.status }, 'success');
      } else {
        failed++;
        progress('spec-failed', `Spec finished with status ${loopResult.status}: ${specFile}`, { file: specFile, status: loopResult.status }, 'warning');
      }
    } catch (err) {
      executed++;
      failed++;
      progress('spec-error', `Spec failed: ${specFile} — ${err.message}`, { file: specFile, error: err.message }, 'error');
    }
  }

  progress('complete', `Execution complete: ${succeeded} succeeded, ${failed} failed out of ${executed} executed. Budget: $${specBudget.spent.toFixed(2)}`, { executed, succeeded, failed, budgetUsed: specBudget.spent }, 'success');

  return { status: 'completed', executed, succeeded, failed, budgetUsed: specBudget.spent };
}

async function runElonFixAll(config) {
  const {
    apiKey,
    appUrl = 'http://localhost:5000',
    projectRoot = process.cwd(),
    dataDir = path.join(projectRoot, '.sneebly'),
    budgetMax = 25.0,
    enableCrawl = true,
    memory = null,
    onProgress = null,
    maxRounds = 30,
    constraintsPerRound = 3,
  } = config;

  const { log, progress } = _makeProgressLogger(memory, onProgress);

  let totalSpent = 0;
  let totalSolved = 0;
  let totalDismissed = 0;
  let consecutiveNoProgress = 0;
  const MAX_NO_PROGRESS = 3;

  progress('fix-all-start', `ELON Fix-All starting: max ${maxRounds} rounds, $${budgetMax.toFixed(2)} budget`, { maxRounds, budget: budgetMax }, 'thinking');

  for (let round = 0; round < maxRounds; round++) {
    if (_isStopRequested(dataDir)) {
      progress('stopped', 'ELON Fix-All: Stop requested', null, 'warning');
      break;
    }

    if (totalSpent >= budgetMax) {
      progress('budget-exhausted', `ELON Fix-All: Budget exhausted ($${totalSpent.toFixed(2)}/$${budgetMax.toFixed(2)})`, null, 'warning');
      break;
    }

    if (consecutiveNoProgress >= MAX_NO_PROGRESS) {
      progress('no-progress', `ELON Fix-All: ${MAX_NO_PROGRESS} rounds with no progress — stopping to avoid waste`, null, 'warning');
      break;
    }

    const counts = getActiveConstraintCounts(dataDir);
    if (round > 0 && !counts.hasActionable) {
      progress('all-resolved', `ELON Fix-All: All critical/high/medium issues resolved! (${counts.low} low-priority remain)`, { totalSolved, totalSpent }, 'success');
      break;
    }

    const roundBudget = Math.min(budgetMax - totalSpent, 5.0);
    const crawlMode = config.crawlMode || (enableCrawl ? 'full' : 'backend-only');

    progress('fix-all-round', `Fix-All round ${round + 1}/${maxRounds}: ${counts.total} active issues (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium) — $${totalSpent.toFixed(2)} spent`, { round: round + 1, counts, budget: totalSpent }, 'thinking');

    try {
      const result = await runElonLoop({
        apiKey, appUrl, projectRoot, dataDir,
        maxConstraints: constraintsPerRound,
        budgetMax: roundBudget,
        enableCrawl,
        crawlMode,
        memory,
        onProgress,
      });

      totalSpent += result.totalBudget || 0;

      if (result.constraintsSolved > 0) {
        totalSolved += result.constraintsSolved;
        consecutiveNoProgress = 0;
        progress('fix-all-progress', `Round ${round + 1}: Solved ${result.constraintsSolved} constraint(s)! Total solved: ${totalSolved}`, { totalSolved, totalSpent }, 'success');
      } else {
        consecutiveNoProgress++;
        progress('fix-all-no-progress', `Round ${round + 1}: No constraints solved this round (${consecutiveNoProgress}/${MAX_NO_PROGRESS} no-progress rounds)`, { totalSolved, totalSpent, consecutiveNoProgress }, 'warning');
      }
    } catch (err) {
      progress('fix-all-error', `Round ${round + 1} error: ${err.message}`, null, 'error');
      if (err.message && (err.message.includes('429') || err.message.includes('rate limit'))) {
        progress('rate-limited', 'Rate limited — pausing 60s before retry', null, 'warning');
        await new Promise(r => setTimeout(r, 60000));
      }
      consecutiveNoProgress++;
    }

    if (round < maxRounds - 1 && !_isStopRequested(dataDir) && totalSpent < budgetMax) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const finalCounts = getActiveConstraintCounts(dataDir);
  progress('fix-all-complete', `ELON Fix-All complete: ${totalSolved} solved, ${finalCounts.total} remaining, $${totalSpent.toFixed(2)} spent`, { totalSolved, remaining: finalCounts, totalSpent, totalDismissed }, 'success');

  return { status: 'completed', totalSolved, totalDismissed, totalSpent, remaining: finalCounts };
}

function resetElonState(dataDir) {
  try {
    const reportPath = path.join(dataDir, 'elon-report-data.json');
    const logPath = path.join(dataDir, 'elon-log.json');
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    const dirs = ['approved-queue', 'completed', 'failed', 'queue/pending', 'rejected-queue'];
    for (const dir of dirs) {
      const fullDir = path.join(dataDir, dir);
      if (fs.existsSync(fullDir)) {
        const files = fs.readdirSync(fullDir).filter(f => f.startsWith('elon-'));
        for (const f of files) {
          try { fs.unlinkSync(path.join(fullDir, f)); } catch {}
        }
      }
    }
    return { success: true, message: 'ELON state reset — all constraint history cleared' };
  } catch (err) {
    return { success: false, message: `Reset failed: ${err.message}` };
  }
}

module.exports = {
  runElonCycle,
  runElonLoop,
  runElonFixAll,
  evaluateConstraint,
  getElonStatus,
  getActiveConstraintCounts,
  getElonSettings,
  updateElonSettings,
  listPendingSpecs,
  approveSpec,
  rejectSpec,
  approveAllSpecs,
  executeApprovedSpecs,
  resetElonState,
  getElonMode,
  runElonBuildCycle,
  parseAppSpec,
  parseRoadmapMilestones,
  loadBuildState,
  saveBuildState,
  loadElonLog,
  saveElonLog,
};
