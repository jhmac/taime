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

  _fuzzyMatch(content, oldCode) {
    const trimmedOld = oldCode.trim();
    const contentLines = content.split('\n');
    const oldLines = trimmedOld.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (oldLines.length < 2) return null;

    const matches = [];
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      let matched = true;
      for (let j = 0; j < oldLines.length; j++) {
        if (contentLines[i + j].trim() !== oldLines[j]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        matches.push(i);
      }
    }

    if (matches.length === 1) {
      const matchedLines = contentLines.slice(matches[0], matches[0] + oldLines.length);
      return matchedLines.join('\n');
    }

    return null;
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

    let matchedOldCode = oldCode;
    if (!currentContent.includes(oldCode)) {
      const fuzzyResult = this._fuzzyMatch(currentContent, oldCode);
      if (fuzzyResult) {
        matchedOldCode = fuzzyResult;
      } else {
        const oldLines = oldCode.trim().split('\n').filter(l => l.trim().length > 0);
        const preview = oldLines.slice(0, 3).map(l => l.trim()).join(' | ');
        return { applied: false, reason: `Old code not found in file. Looked for: "${preview}..."` };
      }
    }

    const backupPath = this.backup(filePath);

    const newContent = currentContent.replace(matchedOldCode, newCode);
    fs.writeFileSync(fullPath, newContent, 'utf-8');

    return { applied: true, backupPath, fuzzyMatched: matchedOldCode !== oldCode };
  }

  verifySyntax(filePath) {
    const fullPath = path.resolve(this.projectRoot, filePath);
    const ext = path.extname(fullPath).toLowerCase();

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        let braceDepth = 0, parenDepth = 0, bracketDepth = 0;
        let inString = false, stringChar = '', inTemplate = false, inComment = false, inBlockComment = false;

        for (let i = 0; i < content.length; i++) {
          const ch = content[i];
          const next = content[i + 1];

          if (inBlockComment) {
            if (ch === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
          }
          if (inComment) {
            if (ch === '\n') inComment = false;
            continue;
          }
          if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === stringChar) inString = false;
            continue;
          }
          if (inTemplate) {
            if (ch === '\\') { i++; continue; }
            if (ch === '`') inTemplate = false;
            continue;
          }

          if (ch === '/' && next === '/') { inComment = true; continue; }
          if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
          if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
          if (ch === '`') { inTemplate = true; continue; }

          if (ch === '{') braceDepth++;
          if (ch === '}') { braceDepth--; if (braceDepth < 0) return { valid: false, issues: ['extra closing brace at position ' + i] }; }
          if (ch === '(') parenDepth++;
          if (ch === ')') { parenDepth--; if (parenDepth < 0) return { valid: false, issues: ['extra closing parenthesis at position ' + i] }; }
          if (ch === '[') bracketDepth++;
          if (ch === ']') { bracketDepth--; if (bracketDepth < 0) return { valid: false, issues: ['extra closing bracket at position ' + i] }; }
        }

        const issues = [];
        if (braceDepth !== 0) issues.push(`unbalanced braces (depth: ${braceDepth})`);
        if (parenDepth !== 0) issues.push(`unbalanced parentheses (depth: ${parenDepth})`);
        if (bracketDepth !== 0) issues.push(`unbalanced brackets (depth: ${bracketDepth})`);
        if (inString) issues.push('unclosed string literal');
        if (inTemplate) issues.push('unclosed template literal');
        if (inBlockComment) issues.push('unclosed block comment');

        if (issues.length > 0) {
          return { valid: false, issues };
        }
        return { valid: true };
      } catch (err) {
        return { valid: false, issues: [`read error: ${err.message}`] };
      }
    }

    return { valid: true };
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
