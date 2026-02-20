'use strict';

const { delegateToSubagent } = require('./dispatcher');
const { _writeToPendingQueue } = require('./error-resolver');

async function selfImprove(options = {}) {
  const { context, budget, memory, apiKey, identityDir, templatesDir, dryRun, dataDir } = options;

  const recentMemory = memory ? memory.getRecentMemory(7) : [];

  const task = {
    dailyLogs: recentMemory,
    recentDecisions: memory ? memory.getRecentDecisions(20) : [],
  };

  let result;
  try {
    result = await delegateToSubagent('self-improver', task, {
      context, budget, memory, apiKey, identityDir, templatesDir, dryRun,
    });
  } catch (err) {
    return { action: 'skip', reason: `dispatcher-error: ${err.message}` };
  }

  if (!result || !result.action) {
    result = result || {};
    result.action = 'queue';
  }

  if (dataDir) {
    _writeToPendingQueue(dataDir, {
      type: 'self-improvement',
      proposals: result,
    });
  }

  return result;
}

module.exports = {
  selfImprove,
};
