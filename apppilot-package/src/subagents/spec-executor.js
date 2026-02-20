'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./dispatcher');

function _findRelevantSection(full, spec, windowBefore = 60, windowAfter = 80) {
  const lines = full.split('\n');
  const maxChars = 20000;

  // Strategy 1: If spec has relevantCode, find it in the file directly
  if (spec.relevantCode) {
    const idx = full.indexOf(spec.relevantCode.trim().split('\n')[0]);
    if (idx !== -1) {
      const lineNum = full.substring(0, idx).split('\n').length - 1;
      const start = Math.max(0, lineNum - windowBefore);
      const end = Math.min(lines.length, lineNum + windowAfter);
      return lines.slice(start, end).join('\n');
    }
  }

  // Strategy 2: Extract key identifiers from description + successCriteria
  const searchTexts = [
    spec.description || '',
    ...(spec.successCriteria || []),
  ].join(' ');

  // Extract identifiers (3+ chars for technical terms like HMAC, API, etc.)
  const identifiers = searchTexts.match(/[a-zA-Z_][a-zA-Z0-9_]{2,}/g) || [];
  // Filter out common English words that appear everywhere
  const stopWords = new Set(['the', 'and', 'for', 'that', 'with', 'from', 'this', 'not', 'are', 'but', 'has', 'have', 'should', 'does', 'will', 'when', 'add', 'all', 'any', 'each', 'which', 'their', 'them', 'then', 'than', 'its', 'also', 'been', 'can', 'into', 'could', 'other', 'more', 'some', 'would', 'make', 'like', 'just', 'over', 'such', 'only', 'message', 'include', 'includes', 'actual', 'values', 'logged', 'expose']);
  const uniqueIds = [...new Set(identifiers.map(id => id.toLowerCase()))].filter(id => !stopWords.has(id));

  // Count how many lines each identifier appears on (rarity scoring)
  const idFrequency = {};
  for (const id of uniqueIds) {
    idFrequency[id] = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(id)) idFrequency[id]++;
    }
  }

  // Strategy 3: Score each line — rare identifiers score higher
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

  // Strategy 4: If no good match, search for route handler if filePath looks like routes
  if (bestScore < 2 && spec.filePath && spec.filePath.includes('route')) {
    // Look for the first route handler as default
    for (let i = 0; i < lines.length; i++) {
      if (/app\.(get|post|put|patch|delete)\s*\(/.test(lines[i])) {
        bestLine = i;
        bestScore = 1;
        break;
      }
    }
  }

  const start = Math.max(0, bestLine - windowBefore);
  const end = Math.min(lines.length, bestLine + windowAfter);
  let section = lines.slice(start, end).join('\n');

  // If section is still too small or too large, adjust
  if (section.length > maxChars) {
    const trimEnd = Math.min(lines.length, bestLine + 60);
    section = lines.slice(start, trimEnd).join('\n');
  }

  return section;
}

function _extractImports(code, filePath, projectRoot) {
  const imports = [];
  const importPatterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of importPatterns) {
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
    const dir = path.dirname(path.join(projectRoot, filePath));
    resolved = path.resolve(dir, importPath);
  }
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  const indexExts = ['/index.ts', '/index.tsx', '/index.js'];
  for (const ext of indexExts) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function _gatherRelatedContext(code, filePath, projectRoot, spec, maxTotalChars = 6000) {
  const importPaths = _extractImports(code, filePath, projectRoot);
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

  if (spec && spec.relatedFiles && Array.isArray(spec.relatedFiles)) {
    for (const rf of spec.relatedFiles) {
      if (totalChars >= maxTotalChars) break;
      const rfPath = path.join(projectRoot, rf);
      try {
        const content = fs.readFileSync(rfPath, 'utf-8');
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

async function executeSpec(spec, options = {}) {
  const { context, budget, memory, apiKey, identityDir, templatesDir, dryRun, projectRoot } = options;

  let currentCode = '';
  let relatedContext = '';
  if (spec.filePath && projectRoot) {
    const fullPath = path.join(projectRoot, spec.filePath);
    try {
      const full = fs.readFileSync(fullPath, 'utf-8');
      if (full.length > 20000) {
        const section = _findRelevantSection(full, spec);
        const totalLines = full.split('\n').length;
        currentCode = '// FILE: ' + spec.filePath + ' (' + totalLines + ' lines total, showing relevant section)\n' + section;
      } else {
        currentCode = full;
      }
      relatedContext = _gatherRelatedContext(full, spec.filePath, projectRoot, spec, 6000);
    } catch {}
  }

  const task = {
    spec,
    currentCode,
    relatedContext: relatedContext || undefined,
  };

  let result;
  try {
    result = await delegateToSubagent('spec-executor', task, {
      context, budget, memory, apiKey, identityDir, templatesDir, dryRun,
    });
  } catch (err) {
    return { status: 'stuck', reason: `dispatcher-error: ${err.message}` };
  }

  if (!result) {
    return { status: 'stuck', reason: 'no-response' };
  }

  if (result.action === 'skip') {
    return { status: 'stuck', reason: result.reason || 'skipped' };
  }

  if (result.action === 'dry-run') {
    return { status: 'dry-run', spec };
  }

  // Check for SPEC_COMPLETE in result.raw (parse-failed responses)
  if (typeof result.raw === 'string') {
    if (result.raw.includes('SPEC_COMPLETE')) {
      return { status: 'SPEC_COMPLETE' };
    }
  }

  if (result.status === 'SPEC_COMPLETE') {
    return { status: 'SPEC_COMPLETE' };
  }

  if (result.status === 'change' && result.filePath && result.oldCode !== undefined && result.newCode !== undefined) {
    return {
      status: 'change',
      filePath: result.filePath,
      oldCode: result.oldCode,
      newCode: result.newCode,
      description: result.description || '',
    };
  }

  if (result.status === 'multi-change' && Array.isArray(result.changes) && result.changes.length > 0) {
    const validChanges = result.changes.filter(c => c.filePath && c.oldCode !== undefined && c.newCode !== undefined);
    if (validChanges.length > 0) {
      return {
        status: 'multi-change',
        changes: validChanges.map(c => ({
          filePath: c.filePath,
          oldCode: c.oldCode,
          newCode: c.newCode,
          description: c.description || '',
        })),
      };
    }
  }

  if (result.status === 'stuck') {
    return { status: 'stuck', reason: result.reason || 'unknown' };
  }

  // If the raw response is plain text that Claude used to analyze criteria,
  // and it indicates all are met, treat as SPEC_COMPLETE
  if (typeof result.raw === 'string') {
    const raw = result.raw;
    const allMetSignals = [
      /all\s+(success\s+)?criteria\s+are\s+(met|satisfied|already)/i,
      /both\s+(criteria|requirements)\s+are\s+(met|satisfied|already)/i,
      /criteria.*(?:already|currently)\s+(met|satisfied|implemented|working)/i,
      /(?:already|currently)\s+(implemented|working|functional|exists|present)/i,
      /no\s+(?:changes?\s+)?(?:needed|required|necessary)/i,
      /(?:the|this)\s+(?:code|implementation|feature)\s+(?:already|is\s+already)\s/i,
      /SPEC_COMPLETE/,
    ];
    if (allMetSignals.some(p => p.test(raw))) {
      return { status: 'SPEC_COMPLETE' };
    }

    // If Claude returned a code block with file path, try to parse as a change
    const codeBlockMatch = raw.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch && result.reason === 'parse-failed') {
      // Could not extract structured change, treat as stuck with better reason
      return { status: 'stuck', reason: 'parse-failed-with-code-block' };
    }
  }

  return { status: 'stuck', reason: 'unrecognized-response' };
}

module.exports = {
  executeSpec,
};
