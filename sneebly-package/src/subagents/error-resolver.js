'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./dispatcher');
const { InputSanitizer } = require('../security');

async function resolveError(error, options = {}) {
  const { context, budget, memory, apiKey, identityDir, templatesDir, dryRun, dataDir } = options;

  const sanitizedError = {
    message: InputSanitizer.sanitizeError(error.message || error),
    stack: InputSanitizer.sanitizeStack(error.stack || ''),
    file: InputSanitizer.sanitizePath(error.file || ''),
    signature: error.signature || null,
  };

  let result;
  try {
    result = await delegateToSubagent('error-resolver', sanitizedError, {
      context, budget, memory, apiKey, identityDir, templatesDir, dryRun,
    });
  } catch (err) {
    return { action: 'skip', reason: `dispatcher-error: ${err.message}` };
  }

  if (!result || !result.action) {
    return { action: 'queue', reason: 'no-action-returned' };
  }

  if (result.action === 'fix' && result.spec) {
    const safePaths = _getSafePaths(context);
    const filePath = result.spec.filePath || '';

    if (_isPathSafe(filePath, safePaths)) {
      if (dataDir) {
        _writeSpecFile(dataDir, result.spec);
      }
      return result;
    }

    result.action = 'queue';
    result.reason = 'path-not-in-safe-list';
  }

  if (result.action === 'queue') {
    if (dataDir) {
      _writeToPendingQueue(dataDir, {
        type: 'error-fix',
        error: sanitizedError,
        suggestion: result,
      });
    }
  }

  return result;
}

function _getSafePaths(context) {
  if (!context || !context.agents || !context.agents.content) return [];

  const content = context.agents.content;
  const safeSection = content.match(/##\s*Safe to Auto-Modify\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!safeSection) return [];

  return safeSection[1]
    .split('\n')
    .map(line => {
      let cleaned = line.replace(/^[-*]\s*/, '').trim();
      cleaned = cleaned.replace(/\s*\(.*\)\s*$/, '').trim();
      return cleaned;
    })
    .filter(l => l && (l.includes('/') || l.includes('*') || l.includes('.')));
}

function _isPathSafe(filePath, safePaths) {
  if (!filePath || safePaths.length === 0) return false;

  return safePaths.some(pattern => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return filePath.startsWith(prefix);
    }
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return filePath.startsWith(prefix) && !filePath.slice(prefix.length + 1).includes('/');
    }
    return filePath === pattern;
  });
}

function _writeSpecFile(dataDir, spec) {
  const specsDir = path.join(dataDir, 'approved-queue');
  if (!fs.existsSync(specsDir)) {
    fs.mkdirSync(specsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-error-fix.json`;
  fs.writeFileSync(path.join(specsDir, filename), JSON.stringify(spec, null, 2));
}

function _writeToPendingQueue(dataDir, entry) {
  const pendingDir = path.join(dataDir, 'pending-queue');
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${entry.type || 'unknown'}.json`;
  fs.writeFileSync(path.join(pendingDir, filename), JSON.stringify(entry, null, 2));
}

module.exports = {
  resolveError,
  _getSafePaths,
  _isPathSafe,
  _writeSpecFile,
  _writeToPendingQueue,
};
