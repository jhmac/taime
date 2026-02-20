'use strict';

const fs = require('fs');
const path = require('path');
const { executeSpec } = require('./subagents/spec-executor');
const { CodeEngine } = require('./code-engine');

async function _applySingleChange(engine, execResult, result, spec, memory) {
  const { filePath, oldCode, newCode, description } = execResult;

  const applyResult = engine.applyChange(filePath, oldCode, newCode);

  if (!applyResult.applied) {
    result.changes.push({ filePath, applied: false, reason: applyResult.reason });
    return { success: false, backups: { backups: {}, newFiles: [] } };
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
    return { success: false, backups: { backups: {}, newFiles: [] } };
  }

  const backupInfo = {
    backups: applyResult.backupPath ? { [filePath]: applyResult.backupPath } : {},
    newFiles: [],
  };
  result.changes.push({ filePath, applied: true, backupPath: applyResult.backupPath, description, fuzzyMatched: applyResult.fuzzyMatched || false });

  return { success: true, backups: backupInfo };
}

async function _applyMultiFileChanges(engine, changes, result, memory) {
  const filePaths = changes.map(c => c.filePath);
  const backupInfo = engine.backupMultiple(filePaths);
  const appliedFiles = [];

  for (const change of changes) {
    const { filePath, oldCode, newCode, description } = change;
    const applyResult = engine.applyChange(filePath, oldCode, newCode);

    if (!applyResult.applied) {
      if (appliedFiles.length > 0) {
        engine.rollbackMultiple(backupInfo);
        for (const af of appliedFiles) {
          const idx = result.changes.findIndex(c => c.filePath === af && c.applied);
          if (idx !== -1) result.changes[idx].rolledBack = true;
        }
      }
      result.changes.push({ filePath, applied: false, reason: applyResult.reason, atomicRollback: appliedFiles.length > 0 });
      if (memory) {
        memory.logDaily(`Ralph Loop: multi-file change failed on ${filePath}: ${applyResult.reason} — rolled back ${appliedFiles.length} file(s)`);
      }
      return { success: false, backups: backupInfo };
    }

    const syntaxCheck = engine.verifySyntax(filePath);
    if (!syntaxCheck.valid) {
      engine.rollbackMultiple(backupInfo);
      for (const af of appliedFiles) {
        const idx = result.changes.findIndex(c => c.filePath === af && c.applied);
        if (idx !== -1) result.changes[idx].rolledBack = true;
      }
      result.changes.push({ filePath, applied: false, reason: `Syntax error: ${syntaxCheck.issues.join(', ')}`, atomicRollback: true });
      if (memory) {
        memory.logDaily(`Ralph Loop: multi-file syntax check failed on ${filePath}: ${syntaxCheck.issues.join(', ')} — rolled back all ${appliedFiles.length + 1} file(s)`);
      }
      return { success: false, backups: backupInfo };
    }

    appliedFiles.push(filePath);
    result.changes.push({ filePath, applied: true, backupPath: backupInfo.backups[filePath], description, fuzzyMatched: applyResult.fuzzyMatched || false });
  }

  return { success: true, backups: backupInfo };
}

async function _runRuntimeValidation(engine, backupInfo, result, spec, memory) {
  const runtimeConfig = spec.runtimeValidation || {};
  const healthUrl = runtimeConfig.healthUrl || 'http://localhost:5000/health';
  const startCommand = runtimeConfig.startCommand || null;
  const timeoutMs = runtimeConfig.timeoutMs || 15000;

  const backupMap = backupInfo.backups || backupInfo;
  const fileCount = Object.keys(backupMap).length + (backupInfo.newFiles ? backupInfo.newFiles.length : 0);

  const _doRollback = (reason) => {
    if (fileCount > 0) {
      engine.rollbackMultiple(backupInfo);
      for (const fp of Object.keys(backupMap)) {
        const idx = result.changes.findIndex(c => c.filePath === fp && c.applied && !c.rolledBack);
        if (idx !== -1) result.changes[idx].rolledBack = true;
      }
      if (backupInfo.newFiles) {
        for (const fp of backupInfo.newFiles) {
          const idx = result.changes.findIndex(c => c.filePath === fp && c.applied && !c.rolledBack);
          if (idx !== -1) result.changes[idx].rolledBack = true;
        }
      }
    }
    if (memory) {
      memory.logDaily(`Ralph Loop: runtime validation failed — ${reason}. Rolled back ${fileCount} file(s)`);
    }
    result.changes.push({ runtimeCheck: false, reason, rolledBack: true });
  };

  let runtimeResult;
  if (startCommand) {
    const { CommandValidator } = require('./security');
    const cmdCheck = CommandValidator.isAllowed(startCommand);
    if (!cmdCheck.allowed) {
      _doRollback(`startCommand blocked by security policy: ${cmdCheck.reason}`);
      return false;
    }
    runtimeResult = await engine.verifyRuntimeWithProcess({
      startCommand,
      healthUrl,
      crashWatchMs: 5000,
      healthTimeoutMs: timeoutMs,
    });
  } else {
    runtimeResult = await engine.verifyRuntime({ healthUrl, timeoutMs });
  }

  if (!runtimeResult.healthy) {
    const reason = runtimeResult.reason + (runtimeResult.errors ? ': ' + runtimeResult.errors.slice(0, 2).join('; ') : '');
    _doRollback(reason);
    return false;
  }

  if (memory) {
    memory.logDaily(`Ralph Loop: runtime validation passed (status ${runtimeResult.statusCode})`);
  }
  return true;
}

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

    let changeBackups = {};

    if (execResult.status === 'multi-change' && Array.isArray(execResult.changes)) {
      const multiResult = await _applyMultiFileChanges(engine, execResult.changes, result, memory);
      if (!multiResult.success) continue;
      changeBackups = multiResult.backups;
    } else if (execResult.status === 'change') {
      const singleResult = await _applySingleChange(engine, execResult, result, spec, memory);
      if (!singleResult.success) continue;
      changeBackups = singleResult.backups;
    } else {
      continue;
    }

    if (spec.testCommand) {
      const testResult = engine.runTests(spec.testCommand);

      if (!testResult.passed && !testResult.warning) {
        const backupMap = changeBackups.backups || changeBackups;
        const allFiles = [...Object.keys(backupMap), ...(changeBackups.newFiles || [])];
        if (allFiles.length > 0) {
          engine.rollbackMultiple(changeBackups);
          for (const fp of allFiles) {
            const idx = result.changes.findIndex(c => c.filePath === fp && c.applied && !c.rolledBack);
            if (idx !== -1) result.changes[idx].rolledBack = true;
          }
        }
        if (memory) {
          memory.logDaily(`Ralph Loop: tests failed after changes, rolled back ${allFiles.length} file(s)`);
        }
        continue;
      }
    }

    if (spec.runtimeValidation) {
      const runtimeOk = await _runRuntimeValidation(engine, changeBackups, result, spec, memory);
      if (!runtimeOk) continue;
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
