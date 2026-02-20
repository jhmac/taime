'use strict';

const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');
const { InputSanitizer } = require('./security');

class MemoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dailyDir = path.join(dataDir, 'daily');
    this.decisionsDir = path.join(dataDir, 'decisions');
    this.errorsFile = path.join(dataDir, 'known-errors.json');
    this.errorLogFile = path.join(dataDir, 'error-log.jsonl');
    this.metricsFile = path.join(dataDir, 'metrics.json');
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    const dirs = [this.dataDir, this.dailyDir, this.decisionsDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    if (!fs.existsSync(this.errorsFile)) {
      fs.writeFileSync(this.errorsFile, JSON.stringify({ errors: [] }, null, 2));
    }

    if (!fs.existsSync(this.errorLogFile)) {
      fs.writeFileSync(this.errorLogFile, '');
    }

    if (!fs.existsSync(this.metricsFile)) {
      fs.writeFileSync(this.metricsFile, JSON.stringify({ snapshots: [] }, null, 2));
    }

    this.initialized = true;
  }

  logDaily(message) {
    this.initialize();
    const sanitized = InputSanitizer.sanitizeText(message);
    const today = new Date().toISOString().split('T')[0];
    const dailyFile = path.join(this.dailyDir, `${today}.md`);
    const timestamp = new Date().toISOString();
    const line = `- [${timestamp}] ${sanitized}\n`;
    fs.appendFileSync(dailyFile, line);
  }

  getRecentMemory(days = 7, projectRoot) {
    this.initialize();
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    let combined = '';

    if (projectRoot) {
      const memoryMdPath = path.join(projectRoot, 'MEMORY.md');
      try {
        if (fs.existsSync(memoryMdPath)) {
          combined += fs.readFileSync(memoryMdPath, 'utf-8') + '\n\n';
        }
      } catch {}
    }

    try {
      const files = fs.readdirSync(this.dailyDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of files) {
        const dateStr = file.replace('.md', '');
        const fileDate = new Date(dateStr).getTime();
        if (fileDate < cutoff) break;

        const content = fs.readFileSync(path.join(this.dailyDir, file), 'utf-8');
        combined += `## ${dateStr}\n${content}\n`;
      }
    } catch {}

    return _truncateAtParagraph(combined, 8000);
  }

  updateLongTermMemory(projectRoot, insight) {
    const sanitized = InputSanitizer.sanitizeText(insight);
    const memoryPath = path.join(projectRoot, 'MEMORY.md');
    const timestamp = new Date().toISOString().split('T')[0];
    const entry = `\n- [${timestamp}] ${sanitized}`;

    try {
      if (fs.existsSync(memoryPath)) {
        fs.appendFileSync(memoryPath, entry);
      } else {
        fs.writeFileSync(memoryPath, `# Sneebly Memory\n\nLearned insights from autonomous operations.\n${entry}`);
      }
    } catch (err) {
      console.error(`[Sneebly] Failed to write memory: ${err.message}`);
    }
  }

  appendToMemoryFile(projectRoot, insight) {
    return this.updateLongTermMemory(projectRoot, insight);
  }

  logDecision(decision) {
    this.initialize();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = (decision.action || 'unknown').replace(/[^a-z0-9_-]/gi, '-').slice(0, 40);
    const filename = `${timestamp}-${slug}.md`;
    const filepath = path.join(this.decisionsDir, filename);
    const entry = `# Decision: ${decision.action || 'unknown'}\n\n- **Timestamp**: ${new Date().toISOString()}\n- **Details**: ${JSON.stringify(decision, null, 2)}\n`;
    fs.writeFileSync(filepath, entry);
    return filepath;
  }

  appendErrorLog(error) {
    this.initialize();
    const sanitizedMessage = InputSanitizer.sanitizeError(error.message || error);
    const sanitizedStack = InputSanitizer.sanitizeStack(error.stack || '');
    const entry = {
      timestamp: new Date().toISOString(),
      message: sanitizedMessage,
      stack: sanitizedStack,
      path: error.path || null,
      method: error.method || null,
      signature: error.signature || _computeSignature(sanitizedMessage),
    };
    fs.appendFileSync(this.errorLogFile, JSON.stringify(entry) + '\n');
  }

  processErrorLog() {
    this.initialize();

    if (!fs.existsSync(this.errorLogFile)) return { processed: 0 };

    const raw = fs.readFileSync(this.errorLogFile, 'utf-8').trim();
    if (!raw) return { processed: 0 };

    const lines = raw.split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }

    if (entries.length === 0) return { processed: 0 };

    let release;
    try {
      release = lockfile.lockSync(this.errorsFile, { retries: { retries: 3, minTimeout: 100 } });
    } catch {
      release = null;
    }

    try {
      const data = this.loadKnownErrors();

      for (const entry of entries) {
        const sig = entry.signature || _computeSignature(entry.message);
        const existing = data.errors.find(e => e.signature === sig);
        if (existing) {
          existing.occurrences = (existing.occurrences || 1) + 1;
          existing.lastSeen = entry.timestamp;
        } else {
          data.errors.push({
            signature: sig,
            message: entry.message,
            file: entry.path || null,
            occurrences: 1,
            firstSeen: entry.timestamp,
            lastSeen: entry.timestamp,
            status: 'new',
          });
        }
      }

      fs.writeFileSync(this.errorsFile, JSON.stringify(data, null, 2));
      fs.writeFileSync(this.errorLogFile, '');

      return { processed: entries.length };
    } finally {
      if (release) {
        try { release(); } catch {}
      }
    }
  }

  loadKnownErrors() {
    this.initialize();
    try {
      const raw = fs.readFileSync(this.errorsFile, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { errors: [] };
    }
  }

  saveKnownErrors(data) {
    this.initialize();
    fs.writeFileSync(this.errorsFile, JSON.stringify(data, null, 2));
  }

  addKnownError(errorEntry) {
    const data = this.loadKnownErrors();
    const existing = data.errors.find(e => e.signature === errorEntry.signature);
    if (existing) {
      existing.occurrences = (existing.occurrences || 1) + 1;
      existing.lastSeen = new Date().toISOString();
      if (errorEntry.fix) existing.fix = errorEntry.fix;
    } else {
      data.errors.push({
        signature: errorEntry.signature,
        message: errorEntry.message,
        file: errorEntry.file || null,
        occurrences: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        fix: errorEntry.fix || null,
        status: errorEntry.status || 'new',
      });
    }
    this.saveKnownErrors(data);
    return data;
  }

  findErrorBySignature(signature) {
    const data = this.loadKnownErrors();
    return data.errors.find(e => e.signature === signature) || null;
  }

  markErrorResolved(signature) {
    this.initialize();

    let release;
    try {
      release = lockfile.lockSync(this.errorsFile, { retries: { retries: 3, minTimeout: 100 } });
    } catch {
      const data = this.loadKnownErrors();
      const err = data.errors.find(e => e.signature === signature);
      if (err) {
        err.status = 'resolved';
        err.resolvedAt = new Date().toISOString();
        this.saveKnownErrors(data);
      }
      return err || null;
    }

    try {
      const data = this.loadKnownErrors();
      const err = data.errors.find(e => e.signature === signature);
      if (err) {
        err.status = 'resolved';
        err.resolvedAt = new Date().toISOString();
        fs.writeFileSync(this.errorsFile, JSON.stringify(data, null, 2));
      }
      return err || null;
    } finally {
      if (release) {
        try { release(); } catch {}
      }
    }
  }

  getKnownErrors() {
    return this.loadKnownErrors();
  }

  getRecentDecisions(limit = 10) {
    this.initialize();
    try {
      const files = fs.readdirSync(this.decisionsDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      return files.map(f => {
        try {
          const content = fs.readFileSync(path.join(this.decisionsDir, f), 'utf-8');
          if (f.endsWith('.json')) {
            return JSON.parse(content);
          }
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
          return { file: f, content };
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  saveMetricsSnapshot(snapshot) {
    this.initialize();
    try {
      const data = JSON.parse(fs.readFileSync(this.metricsFile, 'utf-8'));
      data.snapshots.push({
        timestamp: new Date().toISOString(),
        ...snapshot,
      });
      if (data.snapshots.length > 100) {
        data.snapshots = data.snapshots.slice(-100);
      }
      fs.writeFileSync(this.metricsFile, JSON.stringify(data, null, 2));
    } catch {
      fs.writeFileSync(this.metricsFile, JSON.stringify({
        snapshots: [{ timestamp: new Date().toISOString(), ...snapshot }],
      }, null, 2));
    }
  }

  getMetricsSnapshots(limit = 20) {
    this.initialize();
    try {
      const data = JSON.parse(fs.readFileSync(this.metricsFile, 'utf-8'));
      return data.snapshots.slice(-limit);
    } catch {
      return [];
    }
  }

  getDashboardLog(limit = 50) {
    this.initialize();

    const entries = [];

    try {
      const files = fs.readdirSync(this.dailyDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 7);

      for (const file of files) {
        const content = fs.readFileSync(path.join(this.dailyDir, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          entries.push(line);
          if (entries.length >= limit) break;
        }
        if (entries.length >= limit) break;
      }
    } catch {}

    return entries.slice(0, limit);
  }

  auditMemory() {
    this.initialize();
    const findings = [];

    const dirsToScan = [this.dailyDir, this.decisionsDir];

    for (const dir of dirsToScan) {
      if (!fs.existsSync(dir)) continue;

      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const injection = InputSanitizer.detectInjection(content);
            if (injection.detected) {
              findings.push({
                file: filePath,
                type: 'injection_pattern',
                patterns: injection.patterns,
              });
            }
          } catch {}
        }
      } catch {}
    }

    try {
      if (fs.existsSync(this.errorLogFile)) {
        const content = fs.readFileSync(this.errorLogFile, 'utf-8');
        const injection = InputSanitizer.detectInjection(content);
        if (injection.detected) {
          findings.push({
            file: this.errorLogFile,
            type: 'injection_pattern',
            patterns: injection.patterns,
          });
        }
      }
    } catch {}

    return { clean: findings.length === 0, findings };
  }

  cleanupOldBackups(keepCount = 50) {
    this.initialize();
    const decisionsFiles = this._getSortedFiles(this.decisionsDir);
    this._pruneFiles(this.decisionsDir, decisionsFiles, keepCount);
  }

  _getSortedFiles(dir) {
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.md') || f.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }

  _pruneFiles(dir, files, keepCount) {
    if (files.length <= keepCount) return;
    const toDelete = files.slice(0, files.length - keepCount);
    for (const file of toDelete) {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch {}
    }
  }
}

function _truncateAtParagraph(text, maxChars) {
  if (!text || text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  const lastNewline = truncated.lastIndexOf('\n');

  if (lastParagraph > maxChars * 0.5) {
    return truncated.slice(0, lastParagraph);
  }

  if (lastNewline > maxChars * 0.5) {
    return truncated.slice(0, lastNewline);
  }

  const lastSentence = truncated.lastIndexOf('. ');
  if (lastSentence > maxChars * 0.5) {
    return truncated.slice(0, lastSentence + 1);
  }

  return truncated;
}

function _computeSignature(message) {
  if (!message || typeof message !== 'string') return 'unknown';
  return message
    .replace(/\d+/g, 'N')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

module.exports = { MemoryStore, _truncateAtParagraph, _computeSignature };
