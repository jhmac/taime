'use strict';

const fs = require('fs');
const path = require('path');
const { executeSpec } = require('./subagents/spec-executor');
const { CodeEngine } = require('./code-engine');

async function executeRalphLoop(specPath, context, budget, options = {}) {
  const maxIterations = options.maxIterations || 10;
  const projectRoot = options.projectRoot || process.cwd();
  const dataDir = options.dataDir || path.join(projectRoot, '.apppilot');
  const memory = options.memory || null;
  const dryRun = options.dryRun || false;

  const agentsContext = context && context.agents ? context.agents : null;
  const engine = new CodeEngine({
    projectRoot,
    backupsDir: path.join(dataDir, 'backups'),
    agentsContext,
  });

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  } catch (err) {
    return { status: 'failed', reason: `Cannot read spec: ${err.message}`, iterations: 0 };
  }

  const result = {
    status: 'pending',
    iterations: 0,
    specPath,
    changes: [],
  };

  for (let i = 0; i < maxIterations; i++) {
    result.iterations++;

    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    } catch {
      result.status = 'failed';
      result.reason = 'Spec file unreadable mid-iteration';
      break;
    }

    const execResult = await executeSpec(spec, {
      context,
      budget,
      memory,
      apiKey: options.apiKey,
      identityDir: options.identityDir,
      templatesDir: options.templatesDir,
      dryRun,
      projectRoot,
    });

    if (execResult.status === 'SPEC_COMPLETE') {
      result.status = 'completed';
      if (memory) {
        memory.logDaily(`Ralph Loop: spec completed after ${result.iterations} iteration(s) — ${spec.filePath || 'unknown'}`);
      }
      break;
    }

    if (execResult.status === 'stuck') {
      result.status = 'stuck';
      result.reason = execResult.reason || 'unknown';
      if (memory) {
        memory.logDaily(`Ralph Loop: stuck after ${result.iterations} iteration(s) — ${execResult.reason}`);
      }
      break;
    }

    if (execResult.status === 'dry-run') {
      result.status = 'dry-run';
      break;
    }

    if (execResult.status === 'change') {
      const { filePath, oldCode, newCode, description } = execResult;

      const applyResult = engine.applyChange(filePath, oldCode, newCode);

      if (!applyResult.applied) {
        result.changes.push({ filePath, applied: false, reason: applyResult.reason });
        continue;
      }

      const syntaxCheck = engine.verifySyntax(filePath);
      if (!syntaxCheck.valid) {
        if (applyResult.backupPath) {
          engine.rollback(filePath, applyResult.backupPath);
        }
        result.changes.push({ filePath, applied: false, reason: `Syntax error after change: ${syntaxCheck.issues.join(', ')}`, rolledBack: true });
        if (memory) {
          memory.logDaily(`Ralph Loop: syntax check failed for ${filePath}: ${syntaxCheck.issues.join(', ')} — rolled back`);
        }
        continue;
      }

      result.changes.push({ filePath, applied: true, backupPath: applyResult.backupPath, description, fuzzyMatched: applyResult.fuzzyMatched || false });

      if (spec.testCommand) {
        const testResult = engine.runTests(spec.testCommand);

        if (!testResult.passed && !testResult.warning) {
          if (applyResult.backupPath) {
            engine.rollback(filePath, applyResult.backupPath);
            result.changes[result.changes.length - 1].rolledBack = true;
          }
          if (memory) {
            memory.logDaily(`Ralph Loop: tests failed after change to ${filePath}, rolled back`);
          }
          continue;
        }
      }
    }
  }

  if (result.status === 'pending') {
    result.status = 'max-iterations';
    result.reason = `Exhausted ${maxIterations} iterations without completion`;
  }

  _moveSpec(specPath, result.status, dataDir);

  engine.cleanupOldBackups(50);

  return result;
}

function _moveSpec(specPath, status, dataDir) {
  const destDir = status === 'completed'
    ? path.join(dataDir, 'completed')
    : path.join(dataDir, 'failed');

  try {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const filename = path.basename(specPath);
    const destPath = path.join(destDir, filename);
    fs.copyFileSync(specPath, destPath);
    fs.unlinkSync(specPath);
  } catch {}
}

module.exports = { executeRalphLoop, _moveSpec };
