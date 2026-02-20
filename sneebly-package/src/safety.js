'use strict';

const path = require('path');
const { IDENTITY_FILES } = require('./security');

function isPathSafe(filePath, agentsContext) {
  if (!filePath || typeof filePath !== 'string') {
    return { safe: false, reason: 'Invalid or empty file path' };
  }

  const normalized = path.normalize(filePath);

  if (normalized.includes('..')) {
    return { safe: false, reason: 'Path traversal (..) is blocked' };
  }

  const basename = path.basename(normalized);
  if (IDENTITY_FILES.includes(basename)) {
    return { safe: false, reason: `Identity file '${basename}' is always protected` };
  }

  if (IDENTITY_FILES.includes(normalized)) {
    return { safe: false, reason: `Identity file '${normalized}' is always protected` };
  }

  const { safePaths, protectedPaths } = _parseAgentsSections(agentsContext);

  for (const pattern of protectedPaths) {
    if (_matchGlob(normalized, pattern)) {
      return { safe: false, reason: `Path '${normalized}' matches protected pattern '${pattern}'` };
    }
  }

  for (const pattern of safePaths) {
    if (_matchGlob(normalized, pattern)) {
      return { safe: true, reason: `Path '${normalized}' matches safe pattern '${pattern}'` };
    }
  }

  return { safe: false, reason: `Path '${normalized}' not in any safe pattern` };
}

function _parseAgentsSections(agentsContext) {
  const result = { safePaths: [], protectedPaths: [] };

  if (!agentsContext || !agentsContext.content) {
    return result;
  }

  const content = agentsContext.content;

  const safeSection = content.match(/##\s*Safe to Auto-Modify\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (safeSection) {
    result.safePaths = _extractPaths(safeSection[1]);
  }

  const protectedSection = content.match(/##\s*(?:Never\s+(?:Auto-)?Modify|Protected|Do Not\s+(?:Auto-)?Modify)\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (protectedSection) {
    result.protectedPaths = _extractPaths(protectedSection[1]);
  }

  return result;
}

function _extractPaths(section) {
  return section
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('<!--'))
    .map(line => {
      // Strip trailing descriptions in parentheses: "server/** (server code)" -> "server/**"
      const stripped = line.replace(/\s*\(.*\)\s*$/, '').trim();
      // Handle comma-separated paths: ".env, .env.*, package.json" -> split into multiple
      return stripped;
    })
    .flatMap(line => {
      if (line.includes(',')) {
        return line.split(',').map(p => p.trim()).filter(Boolean);
      }
      return [line];
    })
    .filter(line => {
      // Filter out non-path entries (sentences, descriptions)
      return line && !line.includes(' ') || line.includes('*') || line.includes('/') || line.includes('.');
    });
}

function _matchGlob(filePath, pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(prefix + '/');
  }

  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    if (!filePath.startsWith(prefix + '/')) return false;
    const rest = filePath.slice(prefix.length + 1);
    return !rest.includes('/');
  }

  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$');
    return regex.test(filePath);
  }

  return filePath === pattern;
}

module.exports = {
  isPathSafe,
  _parseAgentsSections,
  _matchGlob,
};
