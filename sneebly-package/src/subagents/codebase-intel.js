'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./dispatcher');
const { _getSafePaths, _isPathSafe } = require('./error-resolver');

const DEFAULT_AUTO_APPROVE_CATEGORIES = ['error-handling', 'dead-code', 'performance', 'code-quality'];
const DEFAULT_MANUAL_CATEGORIES = ['security', 'feature'];
const VALID_CATEGORIES = [...DEFAULT_AUTO_APPROVE_CATEGORIES, ...DEFAULT_MANUAL_CATEGORIES];

async function analyzeCodebase(options = {}) {
  const { context, budget, memory, apiKey, identityDir, templatesDir, dryRun, dataDir, projectRoot } = options;

  const root = projectRoot || identityDir || '.';
  const projectFiles = _listProjectFiles(root);
  const fileContents = _readKeyFiles(root, projectFiles, 50000);

  const task = {
    files: projectFiles,
    sourceCode: fileContents,
  };

  let result;
  try {
    result = await delegateToSubagent('codebase-intel', task, {
      context, budget, memory, apiKey, identityDir, templatesDir, dryRun,
    });
  } catch (err) {
    return { action: 'skip', reason: `dispatcher-error: ${err.message}` };
  }

  if (!result) {
    return { action: 'skip', reason: 'no-response' };
  }

  const findings = _extractFindings(result);

  if (!findings || findings.length === 0) {
    return {
      action: 'skip',
      reason: 'no-findings',
      rawResult: result,
    };
  }

  const safePaths = _getSafePaths(context);
  const goalsPrefs = _parseGoalsPreferences(context);
  const filteredFindings = _filterByGoals(findings, goalsPrefs);
  const specResults = _createSpecFiles(filteredFindings, safePaths, dataDir, goalsPrefs);

  if (memory) {
    memory.logDecision({
      action: 'codebase_intel_complete',
      totalFindings: findings.length,
      specsCreated: specResults.created,
      autoApproved: specResults.autoApproved,
      pendingReview: specResults.pendingReview,
    });
  }

  return {
    action: 'completed',
    findings: findings.length,
    filtered: filteredFindings.length,
    specsCreated: specResults.created,
    autoApproved: specResults.autoApproved,
    pendingReview: specResults.pendingReview,
    summary: result.summary || null,
  };
}

function _extractFindings(result) {
  if (result && Array.isArray(result.findings)) {
    return result.findings.filter(_isValidFinding);
  }

  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      if (parsed && Array.isArray(parsed.findings)) {
        return parsed.findings.filter(_isValidFinding);
      }
    } catch {}

    const jsonMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed && Array.isArray(parsed.findings)) {
          return parsed.findings.filter(_isValidFinding);
        }
      } catch {}
    }

    const braceIdx = result.indexOf('{');
    if (braceIdx >= 0) {
      try {
        const candidate = _extractBalancedJson(result, braceIdx);
        if (candidate) {
          const parsed = JSON.parse(candidate);
          if (parsed && Array.isArray(parsed.findings)) {
            return parsed.findings.filter(_isValidFinding);
          }
        }
      } catch {}
    }
  }

  if (result && result.raw && typeof result.raw === 'string') {
    return _extractFindings(result.raw);
  }

  return [];
}

function _extractBalancedJson(text, startIdx) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.substring(startIdx, i + 1);
      }
    }
  }
  return null;
}

function _isValidFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  if (!finding.filePath || typeof finding.filePath !== 'string') return false;
  if (!finding.description || typeof finding.description !== 'string') return false;
  if (!Array.isArray(finding.successCriteria) || finding.successCriteria.length === 0) return false;
  if (!finding.category || !VALID_CATEGORIES.includes(finding.category)) return false;
  return true;
}

function _parseGoalsPreferences(context) {
  const prefs = {
    autoApprovePatterns: [],
    requireApprovalPatterns: [],
    ignorePatterns: [],
  };

  if (!context || !context.goals || !context.goals.content) return prefs;
  const content = context.goals.content;

  const autoSection = content.match(/###?\s*Auto-approve these types of changes[:\s]*\n([\s\S]*?)(?=\n###|$)/i);
  if (autoSection) {
    prefs.autoApprovePatterns = autoSection[1]
      .split('\n')
      .map(l => l.replace(/^[-*]\s*/, '').trim().toLowerCase())
      .filter(Boolean);
  }

  const requireSection = content.match(/###?\s*Always require my approval for[:\s]*\n([\s\S]*?)(?=\n###|$)/i);
  if (requireSection) {
    prefs.requireApprovalPatterns = requireSection[1]
      .split('\n')
      .map(l => l.replace(/^[-*]\s*/, '').trim().toLowerCase())
      .filter(Boolean);
  }

  const ignoreSection = content.match(/###?\s*Ignore for now[:\s]*\n([\s\S]*?)(?=\n###|$)/i);
  if (ignoreSection) {
    prefs.ignorePatterns = ignoreSection[1]
      .split('\n')
      .map(l => l.replace(/^[-*]\s*/, '').trim().toLowerCase())
      .filter(Boolean);
  }

  return prefs;
}

function _filterByGoals(findings, goalsPrefs) {
  if (!goalsPrefs || goalsPrefs.ignorePatterns.length === 0) return findings;

  return findings.filter(finding => {
    const desc = (finding.description || '').toLowerCase();
    const category = (finding.category || '').toLowerCase();
    const filePath = (finding.filePath || '').toLowerCase();

    for (const pattern of goalsPrefs.ignorePatterns) {
      if (desc.includes(pattern) || category.includes(pattern) || filePath.includes(pattern)) {
        return false;
      }
      const keywords = pattern.split(/[\s/]+/).filter(w => w.length > 3);
      if (keywords.length > 0 && keywords.every(kw => desc.includes(kw))) {
        return false;
      }
    }
    return true;
  });
}

function _matchesGoalsPattern(description, category, filePath, patterns) {
  const desc = (description || '').toLowerCase();
  const cat = (category || '').toLowerCase();
  const fp = (filePath || '').toLowerCase();

  for (const pattern of patterns) {
    if (desc.includes(pattern)) return true;
    if (cat.includes(pattern)) return true;
    if (fp.includes(pattern)) return true;
    const keywords = pattern.split(/[\s/]+/).filter(w => w.length > 3);
    if (keywords.length >= 2 && keywords.every(kw => desc.includes(kw) || cat.includes(kw) || fp.includes(kw))) {
      return true;
    }
  }
  return false;
}

function _createSpecFiles(findings, safePaths, dataDir, goalsPrefs) {
  if (!dataDir) return { created: 0, autoApproved: 0, pendingReview: 0 };

  const pendingDir = path.join(dataDir, 'queue', 'pending');
  const approvedDir = path.join(dataDir, 'approved-queue');

  fs.mkdirSync(pendingDir, { recursive: true });
  fs.mkdirSync(approvedDir, { recursive: true });

  let created = 0;
  let autoApproved = 0;
  let pendingReview = 0;

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const spec = {
      filePath: finding.filePath,
      description: finding.description,
      successCriteria: finding.successCriteria,
      priority: finding.priority || 'medium',
      category: finding.category,
      source: 'codebase-intel',
      createdAt: new Date().toISOString(),
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = finding.filePath.replace(/[/\\]/g, '_').replace(/\.[^.]+$/, '');
    const filename = `${timestamp}-intel-${safeName}-${i}.json`;

    const forceRequireApproval = goalsPrefs &&
      _matchesGoalsPattern(finding.description, finding.category, finding.filePath, goalsPrefs.requireApprovalPatterns);

    const goalsAutoApprove = goalsPrefs &&
      _matchesGoalsPattern(finding.description, finding.category, finding.filePath, goalsPrefs.autoApprovePatterns);

    let canAutoApprove;
    if (forceRequireApproval) {
      canAutoApprove = false;
    } else if (goalsAutoApprove && _isPathSafe(finding.filePath, safePaths)) {
      canAutoApprove = true;
    } else {
      canAutoApprove =
        DEFAULT_AUTO_APPROVE_CATEGORIES.includes(finding.category) &&
        _isPathSafe(finding.filePath, safePaths);
    }

    const targetDir = canAutoApprove ? approvedDir : pendingDir;

    try {
      fs.writeFileSync(path.join(targetDir, filename), JSON.stringify(spec, null, 2));
      created++;
      if (canAutoApprove) {
        autoApproved++;
      } else {
        pendingReview++;
      }
    } catch (err) {
      console.error(`[codebase-intel] Failed to write spec ${filename}: ${err.message}`);
    }
  }

  return { created, autoApproved, pendingReview };
}

function _listProjectFiles(root, maxFiles = 200) {
  const results = [];
  const ignored = ['node_modules', '.git', '.sneebly', 'dist', 'coverage'];

  function walk(dir, depth) {
    if (depth > 5 || results.length >= maxFiles) return;

    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (ignored.includes(entry) || entry.startsWith('.')) continue;

      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (stat.isFile()) {
          results.push(path.relative(root, fullPath));
        }
      } catch {}
    }
  }

  walk(root, 0);
  return results;
}

function _readKeyFiles(root, files, maxChars) {
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md'];
  const priorityPaths = ['server/', 'shared/', 'client/src/'];
  const results = {};
  let totalChars = 0;
  
  const sorted = [...files].sort((a, b) => {
    const aPriority = priorityPaths.some(p => a.startsWith(p)) ? 0 : 1;
    const bPriority = priorityPaths.some(p => b.startsWith(p)) ? 0 : 1;
    return aPriority - bPriority;
  });
  
  for (const file of sorted) {
    if (totalChars >= maxChars) break;
    const ext = path.extname(file);
    if (!codeExtensions.includes(ext)) continue;
    if (file === 'package-lock.json') continue;
    try {
      const content = fs.readFileSync(path.join(root, file), 'utf8');
      if (totalChars + content.length > maxChars) {
        results[file] = content.substring(0, maxChars - totalChars) + '\n[TRUNCATED]';
        totalChars = maxChars;
      } else {
        results[file] = content;
        totalChars += content.length;
      }
    } catch {}
  }
  return results;
}

module.exports = {
  analyzeCodebase,
  _listProjectFiles,
  _readKeyFiles,
  _extractFindings,
  _isValidFinding,
  _createSpecFiles,
  _parseGoalsPreferences,
  _filterByGoals,
  _matchesGoalsPattern,
};
