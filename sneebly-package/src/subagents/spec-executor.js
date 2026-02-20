'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./dispatcher');

const SPEC_COMPLETE_SIGNALS = [
  /all\s+(success\s+)?criteria\s+are\s+(met|satisfied|already)/i,
  /both\s+(criteria|requirements)\s+are\s+(met|satisfied|already)/i,
  /criteria.*(?:already|currently)\s+(met|satisfied|implemented|working)/i,
  /(?:already|currently)\s+(implemented|working|functional|exists|present)/i,
  /no\s+(?:changes?\s+)?(?:needed|required|necessary)/i,
  /(?:the|this)\s+(?:code|implementation|feature)\s+(?:already|is\s+already)\s/i,
  /SPEC_COMPLETE/,
];

function _findRelevantSection(full, spec, windowBefore = 60, windowAfter = 80) {
  const lines = full.split('\n');
  const maxChars = 20000;

  if (spec.relevantCode) {
    const idx = full.indexOf(spec.relevantCode.trim().split('\n')[0]);
    if (idx !== -1) {
      const lineNum = full.substring(0, idx).split('\n').length - 1;
      const start = Math.max(0, lineNum - windowBefore);
      const end = Math.min(lines.length, lineNum + windowAfter);
      return lines.slice(start, end).join('\n');
    }
  }

  const searchTexts = [spec.description || '', ...(spec.successCriteria || [])].join(' ');
  const identifiers = searchTexts.match(/[a-zA-Z_][a-zA-Z0-9_]{2,}/g) || [];
  const stopWords = new Set(['the', 'and', 'for', 'that', 'with', 'from', 'this', 'not', 'are', 'but', 'has', 'have', 'should', 'does', 'will', 'when', 'add', 'all', 'any', 'each', 'which', 'their', 'them', 'then', 'than', 'its', 'also', 'been', 'can', 'into', 'could', 'other', 'more', 'some', 'would', 'make', 'like', 'just', 'over', 'such', 'only', 'message', 'include', 'includes', 'actual', 'values', 'logged', 'expose']);
  const uniqueIds = [...new Set(identifiers.map(id => id.toLowerCase()))].filter(id => !stopWords.has(id));

  const idFrequency = {};
  for (const id of uniqueIds) {
    idFrequency[id] = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(id)) idFrequency[id]++;
    }
  }

  let bestLine = 0;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let score = 0;
    for (const id of uniqueIds) {
      if (lower.includes(id)) {
        const freq = idFrequency[id] || 1;
        score += freq <= 3 ? 4 : freq <= 10 ? 2 : 1;
      }
    }
    if (score > bestScore) { bestScore = score; bestLine = i; }
  }

  if (bestScore < 2 && spec.filePath && spec.filePath.includes('route')) {
    for (let i = 0; i < lines.length; i++) {
      if (/app\.(get|post|put|patch|delete)\s*\(/.test(lines[i])) {
        bestLine = i;
        break;
      }
    }
  }

  const start = Math.max(0, bestLine - windowBefore);
  const end = Math.min(lines.length, bestLine + windowAfter);
  let section = lines.slice(start, end).join('\n');

  if (section.length > maxChars) {
    section = lines.slice(start, Math.min(lines.length, bestLine + 60)).join('\n');
  }

  return section;
}

function _extractImports(code) {
  const imports = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.') || importPath.startsWith('@/') || importPath.startsWith('@shared/')) {
        imports.push(importPath);
      }
    }
  }
  return imports;
}

function _resolveImportPath(importPath, filePath, projectRoot) {
  let resolved;
  if (importPath.startsWith('@shared/')) {
    resolved = path.join(projectRoot, 'shared', importPath.replace('@shared/', ''));
  } else if (importPath.startsWith('@/')) {
    resolved = path.join(projectRoot, 'client', 'src', importPath.replace('@/', ''));
  } else {
    resolved = path.resolve(path.dirname(path.join(projectRoot, filePath)), importPath);
  }

  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
    if (fs.existsSync(resolved + ext)) return resolved + ext;
  }
  for (const ext of ['/index.ts', '/index.tsx', '/index.js']) {
    if (fs.existsSync(resolved + ext)) return resolved + ext;
  }
  return null;
}

function _gatherRelatedContext(code, filePath, projectRoot, spec, maxTotalChars = 6000) {
  const importPaths = _extractImports(code);
  const snippets = [];
  let totalChars = 0;

  for (const imp of importPaths) {
    if (totalChars >= maxTotalChars) break;
    const resolved = _resolveImportPath(imp, filePath, projectRoot);
    if (!resolved) continue;
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const relPath = path.relative(projectRoot, resolved);
      const snippet = content.length > 2000 ? content.substring(0, 2000) + '\n// ... (truncated)' : content;
      snippets.push('// RELATED FILE: ' + relPath + '\n' + snippet);
      totalChars += snippet.length;
    } catch {}
  }

  if (spec && Array.isArray(spec.relatedFiles)) {
    for (const rf of spec.relatedFiles) {
      if (totalChars >= maxTotalChars) break;
      try {
        const content = fs.readFileSync(path.join(projectRoot, rf), 'utf-8');
        const snippet = content.length > 2000 ? content.substring(0, 2000) + '\n// ... (truncated)' : content;
        if (!snippets.some(s => s.includes(rf))) {
          snippets.push('// RELATED FILE: ' + rf + '\n' + snippet);
          totalChars += snippet.length;
        }
      } catch {}
    }
  }

  return snippets.join('\n\n');
}

function _isSpecComplete(result) {
  if (result.status === 'SPEC_COMPLETE') return true;
  if (typeof result.raw === 'string' && SPEC_COMPLETE_SIGNALS.some(p => p.test(result.raw))) return true;
  return false;
}

function _normalizeResponse(result) {
  const { status } = result;

  if (status === 'change' && result.filePath && result.oldCode !== undefined && result.newCode !== undefined) {
    return { status: 'change', filePath: result.filePath, oldCode: result.oldCode, newCode: result.newCode, description: result.description || '' };
  }

  if (status === 'create' && result.filePath && typeof result.content === 'string') {
    return { status: 'create', filePath: result.filePath, content: result.content, description: result.description || '' };
  }

  if (status === 'multi-change' && Array.isArray(result.changes)) {
    const valid = result.changes.filter(c => c.filePath && c.oldCode !== undefined && c.newCode !== undefined);
    if (valid.length > 0) {
      return { status: 'multi-change', changes: valid.map(c => ({ filePath: c.filePath, oldCode: c.oldCode, newCode: c.newCode, description: c.description || '' })) };
    }
  }

  if (status === 'multi-create' && Array.isArray(result.files)) {
    const valid = result.files.filter(f => f.filePath && typeof f.content === 'string');
    if (valid.length > 0) {
      return { status: 'multi-create', files: valid.map(f => ({ filePath: f.filePath, content: f.content, description: f.description || '' })) };
    }
  }

  return null;
}

async function executeSpec(spec, options = {}) {
  const { context, budget, memory, apiKey, identityDir, templatesDir, dryRun, projectRoot } = options;
  const iterationHistory = options.iterationHistory || [];

  let currentCode = '';
  let relatedContext = '';
  if (spec.filePath && projectRoot) {
    if (spec.action === 'create') {
      currentCode = 'NEW FILE — does not exist yet. Create from scratch.';
      relatedContext = _gatherRelatedContext('', spec.filePath, projectRoot, spec, 8000);
    } else {
      const fullPath = path.join(projectRoot, spec.filePath);
      try {
        const full = fs.readFileSync(fullPath, 'utf-8');
        if (full.length > 20000) {
          const section = _findRelevantSection(full, spec);
          const totalLines = full.split('\n').length;
          currentCode = `// FILE: ${spec.filePath} (${totalLines} lines total, showing relevant section)\n${section}`;
        } else {
          currentCode = full;
        }
        relatedContext = _gatherRelatedContext(full, spec.filePath, projectRoot, spec, 6000);
      } catch {}
    }
  }

  const taskPayload = { spec, currentCode, relatedContext: relatedContext || undefined };

  if (iterationHistory.length > 0) {
    taskPayload.previousAttempts = iterationHistory.slice(-3).map(h => ({
      iteration: h.iteration,
      status: h.status,
      reason: h.reason || undefined,
      changeAttempted: h.changeDescription || undefined,
    }));
    taskPayload.retryGuidance = 'Previous attempts failed. Review what went wrong and try a DIFFERENT approach. Do NOT repeat the same change.';
  }

  let result;
  try {
    result = await delegateToSubagent('spec-executor', taskPayload, {
      context, budget, memory, apiKey, identityDir, templatesDir, dryRun,
    });
  } catch (err) {
    return { status: 'stuck', reason: `dispatcher-error: ${err.message}` };
  }

  if (!result) return { status: 'stuck', reason: 'no-response' };
  if (result.action === 'skip') return { status: 'stuck', reason: result.reason || 'skipped' };
  if (result.action === 'dry-run') return { status: 'dry-run', spec };

  if (_isSpecComplete(result)) return { status: 'SPEC_COMPLETE' };

  const normalized = _normalizeResponse(result);
  if (normalized) return normalized;

  if (result.status === 'stuck') return { status: 'stuck', reason: result.reason || 'unknown' };

  if (typeof result.raw === 'string' && result.reason === 'parse-failed') {
    if (result.raw.match(/```(?:\w+)?\n([\s\S]*?)```/)) {
      return { status: 'stuck', reason: 'parse-failed-with-code-block' };
    }
  }

  return { status: 'stuck', reason: 'unrecognized-response' };
}

module.exports = { executeSpec };
