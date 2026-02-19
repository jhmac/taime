'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { IDENTITY_FILES, CommandValidator } = require('./security');
const { isPathSafe } = require('./safety');

class CodeEngine {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.backupsDir = options.backupsDir || path.join(this.projectRoot, 'apppilot', 'backups');
    this.agentsContext = options.agentsContext || null;
  }

  backup(filePath) {
    const fullPath = path.resolve(this.projectRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeName = filePath.replace(/[/\\]/g, '__');
    const backupName = `${safeName}.${timestamp}`;
    const backupPath = path.join(this.backupsDir, backupName);

    fs.copyFileSync(fullPath, backupPath);
    return backupPath;
  }

  applyChange(filePath, oldCode, newCode) {
    const safetyCheck = this._checkSafety(filePath);
    if (!safetyCheck.safe) {
      return { applied: false, reason: safetyCheck.reason };
    }

    const fullPath = path.resolve(this.projectRoot, filePath);

    if (!fs.existsSync(fullPath)) {
      return { applied: false, reason: `File not found: ${filePath}` };
    }

    const currentContent = fs.readFileSync(fullPath, 'utf-8');

    if (!currentContent.includes(oldCode)) {
      return { applied: false, reason: 'Old code not found in file (exact match required)' };
    }

    const backupPath = this.backup(filePath);

    const newContent = currentContent.replace(oldCode, newCode);
    fs.writeFileSync(fullPath, newContent, 'utf-8');

    return { applied: true, backupPath };
  }

  rollback(filePath, backupPath) {
    const fullPath = path.resolve(this.projectRoot, filePath);

    if (!fs.existsSync(backupPath)) {
      return { restored: false, reason: `Backup not found: ${backupPath}` };
    }

    fs.copyFileSync(backupPath, fullPath);
    return { restored: true };
  }

  runTests(testCommand) {
    const cmdCheck = CommandValidator.isAllowed(testCommand);
    if (!cmdCheck.allowed) {
      return { passed: false, reason: cmdCheck.reason, output: '' };
    }

    const isHealthCheck = testCommand.includes('/health') || testCommand.includes('curl');
    const maxRetries = isHealthCheck ? 4 : 1;
    const retryDelaySeconds = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1 || isHealthCheck) {
        execSync(`sleep ${retryDelaySeconds}`, { cwd: this.projectRoot });
      }

      try {
        const output = execSync(testCommand, {
          cwd: this.projectRoot,
          timeout: 60000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { passed: true, output };
      } catch (err) {
        const stderr = err.stderr || '';
        const stdout = err.stdout || '';
        const combined = stdout + '\n' + stderr;

        if (combined.includes('no test specified') || combined.includes('Error: no test specified')) {
          return { passed: true, warning: 'no-tests-configured', output: combined };
        }

        if (attempt < maxRetries) {
          continue;
        }

        return {
          passed: false,
          output: combined.slice(0, 5000),
          errors: stderr.slice(0, 2000),
        };
      }
    }
  }

  cleanupOldBackups(keepCount = 50) {
    if (!fs.existsSync(this.backupsDir)) return;

    try {
      const files = fs.readdirSync(this.backupsDir).sort();
      if (files.length <= keepCount) return;

      const toDelete = files.slice(0, files.length - keepCount);
      for (const file of toDelete) {
        try {
          fs.unlinkSync(path.join(this.backupsDir, file));
        } catch {}
      }
    } catch {}
  }

  _checkSafety(filePath) {
    const normalized = path.normalize(filePath);
    const basename = path.basename(normalized);

    if (IDENTITY_FILES.includes(basename) || IDENTITY_FILES.includes(normalized)) {
      return { safe: false, reason: `Identity file '${basename}' is always blocked` };
    }

    if (normalized.includes('..')) {
      return { safe: false, reason: 'Path traversal (..) is blocked' };
    }

    if (this.agentsContext) {
      return isPathSafe(normalized, this.agentsContext);
    }

    return { safe: true, reason: 'No agents context — allowing by default' };
  }
}

module.exports = { CodeEngine };
