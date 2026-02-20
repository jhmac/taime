'use strict';

const fs = require('fs');
const path = require('path');

const REGRESSION_FILE = 'regression-history.json';

function _loadHistory(dataDir) {
  try {
    const filePath = path.join(dataDir, REGRESSION_FILE);
    if (!fs.existsSync(filePath)) return { entries: [], lastUpdated: null };
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return { entries: [], lastUpdated: null }; }
}

function _saveHistory(dataDir, history) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    history.lastUpdated = new Date().toISOString();
    fs.writeFileSync(path.join(dataDir, REGRESSION_FILE), JSON.stringify(history, null, 2));
  } catch {}
}

function recordResult(dataDir, result) {
  const history = _loadHistory(dataDir);

  const entry = {
    id: result.id || result.integration || 'unknown',
    type: result.type || 'unknown',
    status: result.status,
    message: result.message || result.errors?.[0] || '',
    timestamp: new Date().toISOString(),
    details: result.details || null,
  };

  const existing = history.entries.find(e => e.id === entry.id);
  if (existing) {
    existing.history = existing.history || [];
    existing.history.push({ status: entry.status, message: entry.message, timestamp: entry.timestamp });
    if (existing.history.length > 50) existing.history = existing.history.slice(-50);

    existing.lastStatus = entry.status;
    existing.lastChecked = entry.timestamp;
    existing.totalChecks = (existing.totalChecks || 0) + 1;

    if (entry.status === 'failed' || entry.status === 'unhealthy' || entry.status === 'misconfigured' || entry.status === 'error') {
      existing.consecutiveFailures = (existing.consecutiveFailures || 0) + 1;
      existing.totalFailures = (existing.totalFailures || 0) + 1;
      if (!existing.firstFailed) existing.firstFailed = entry.timestamp;
      existing.lastFailed = entry.timestamp;
    } else {
      existing.consecutiveFailures = 0;
      existing.lastPassed = entry.timestamp;
    }

    existing.escalationScore = _calculateEscalation(existing);
  } else {
    const newEntry = {
      id: entry.id,
      type: entry.type,
      firstSeen: entry.timestamp,
      lastChecked: entry.timestamp,
      lastStatus: entry.status,
      totalChecks: 1,
      totalFailures: (entry.status === 'failed' || entry.status === 'unhealthy' || entry.status === 'misconfigured') ? 1 : 0,
      consecutiveFailures: (entry.status === 'failed' || entry.status === 'unhealthy' || entry.status === 'misconfigured') ? 1 : 0,
      firstFailed: (entry.status === 'failed' || entry.status === 'unhealthy' || entry.status === 'misconfigured') ? entry.timestamp : null,
      lastFailed: (entry.status === 'failed' || entry.status === 'unhealthy' || entry.status === 'misconfigured') ? entry.timestamp : null,
      lastPassed: entry.status === 'passed' || entry.status === 'healthy' ? entry.timestamp : null,
      escalationScore: 0,
      history: [{ status: entry.status, message: entry.message, timestamp: entry.timestamp }],
    };
    newEntry.escalationScore = _calculateEscalation(newEntry);
    history.entries.push(newEntry);
  }

  _saveHistory(dataDir, history);
  return history;
}

function _calculateEscalation(entry) {
  let score = 0;

  score += Math.min(entry.consecutiveFailures * 2, 10);

  const failRate = entry.totalChecks > 0 ? entry.totalFailures / entry.totalChecks : 0;
  score += Math.round(failRate * 5);

  if (entry.firstFailed) {
    const hoursSinceFirst = (Date.now() - new Date(entry.firstFailed).getTime()) / (1000 * 60 * 60);
    if (hoursSinceFirst > 24) score += 3;
    else if (hoursSinceFirst > 6) score += 2;
    else if (hoursSinceFirst > 1) score += 1;
  }

  return Math.min(score, 15);
}

function getEscalatedIssues(dataDir, minScore = 3) {
  const history = _loadHistory(dataDir);
  return history.entries
    .filter(e => e.escalationScore >= minScore && e.lastStatus !== 'passed' && e.lastStatus !== 'healthy')
    .sort((a, b) => b.escalationScore - a.escalationScore)
    .map(e => ({
      id: e.id,
      type: e.type,
      escalationScore: e.escalationScore,
      consecutiveFailures: e.consecutiveFailures,
      totalFailures: e.totalFailures,
      firstFailed: e.firstFailed,
      lastFailed: e.lastFailed,
      lastStatus: e.lastStatus,
      message: e.history && e.history.length > 0 ? e.history[e.history.length - 1].message : '',
    }));
}

function getRegressionSummary(dataDir) {
  const history = _loadHistory(dataDir);
  const entries = history.entries;

  return {
    totalTracked: entries.length,
    currentlyFailing: entries.filter(e => e.lastStatus !== 'passed' && e.lastStatus !== 'healthy' && e.lastStatus !== 'skipped').length,
    escalated: entries.filter(e => e.escalationScore >= 3).length,
    longestRegression: entries
      .filter(e => e.firstFailed && e.lastStatus !== 'passed')
      .sort((a, b) => new Date(a.firstFailed).getTime() - new Date(b.firstFailed).getTime())[0] || null,
    recentFailures: entries
      .filter(e => e.lastFailed)
      .sort((a, b) => new Date(b.lastFailed).getTime() - new Date(a.lastFailed).getTime())
      .slice(0, 5),
    lastUpdated: history.lastUpdated,
  };
}

module.exports = {
  recordResult,
  getEscalatedIssues,
  getRegressionSummary,
};
