'use strict';

const fs = require('fs');
const path = require('path');
const { delegateToSubagent } = require('./dispatcher');
const { _getSafePaths, _isPathSafe, _writeSpecFile, _writeToPendingQueue } = require('./error-resolver');

async function optimizePerformance(metrics, options = {}) {
  const { context, budget, memory, apiKey, identityDir, templatesDir, dryRun, dataDir } = options;

  const task = {
    metrics: Array.isArray(metrics) ? metrics : [],
    threshold: options.threshold || 20,
  };

  let result;
  try {
    result = await delegateToSubagent('perf-optimizer', task, {
      context, budget, memory, apiKey, identityDir, templatesDir, dryRun,
    });
  } catch (err) {
    return { action: 'skip', reason: `dispatcher-error: ${err.message}` };
  }

  if (!result || !result.action) {
    return { action: 'queue', reason: 'no-action-returned' };
  }

  if (result.optimizations && Array.isArray(result.optimizations)) {
    const safePaths = _getSafePaths(context);
    const approved = [];
    const queued = [];

    for (const opt of result.optimizations) {
      const filePath = opt.filePath || '';
      if (_isPathSafe(filePath, safePaths)) {
        approved.push(opt);
        if (dataDir) {
          _writeSpecFile(dataDir, opt);
        }
      } else {
        queued.push(opt);
        if (dataDir) {
          _writeToPendingQueue(dataDir, { type: 'perf-optimization', optimization: opt });
        }
      }
    }

    result.approved = approved;
    result.queued = queued;
  }

  return result;
}

module.exports = {
  optimizePerformance,
};
