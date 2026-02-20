'use strict';

const fs = require('fs');
const path = require('path');
const { executeSpec } = require('./subagents/spec-executor');
const { CodeEngine } = require('./code-engine');
const { CommandValidator } = require('./security');

function _emptyBackupInfo() {
  return { backups: {}, newFiles: [] };
}

function _rollbackAndMark(engine, backupInfo, result, memory, reason) {
  const backupMap = backupInfo.backups || backupInfo;
  const newFiles = backupInfo.newFiles || [];
  const allFiles = [...Object.keys(backupMap), ...newFiles];

  if (allFiles.length > 0) {
    engine.rollbackMultiple(backupInfo);
    for (const fp of allFiles) {
      const idx = result.changes.findIndex(c => c.filePath === fp && c.applied && !c.rolledBack);
      if (idx !== -1) result.changes[idx].rolledBack = true;
    }
  }

  if (memory) {
    memory.logDaily(`Ralph Loop: ${reason}. Rolled back ${allFiles.length} file(s)`);
  }
}

async function _applySingleChange(engine, execResult, result, memory) {
  const { filePath, oldCode, newCode, description } = execResult;
  const applyResult = engine.applyChange(filePath, oldCode, newCode);

  if (!applyResult.applied) {
    result.changes.push({ filePath, applied: false, reason: applyResult.reason });
    return { success: false, backups: _emptyBackupInfo() };
  }

  const syntaxCheck = engine.verifySyntax(filePath);
  if (!syntaxCheck.valid) {
    if (applyResult.backupPath) engine.rollback(filePath, applyResult.backupPath);
    const reason = `Syntax error after change: ${syntaxCheck.issues.join(', ')}`;
    result.changes.push({ filePath, applied: false, reason, rolledBack: true });
    if (memory) memory.logDaily(`Ralph Loop: syntax check failed for ${filePath}: ${syntaxCheck.issues.join(', ')} — rolled back`);
    return { success: false, backups: _emptyBackupInfo() };
  }

  result.changes.push({ filePath, applied: true, backupPath: applyResult.backupPath, description, fuzzyMatched: applyResult.fuzzyMatched || false });

  return {
    success: true,
    backups: { backups: applyResult.backupPath ? { [filePath]: applyResult.backupPath } : {}, newFiles: [] },
  };
}

async function _applyMultiFileChanges(engine, changes, result, memory) {
  const backupInfo = engine.backupMultiple(changes.map(c => c.filePath));
  const appliedFiles = [];

  for (const change of changes) {
    const { filePath, oldCode, newCode, description } = change;
    const applyResult = engine.applyChange(filePath, oldCode, newCode);

    if (!applyResult.applied) {
      if (appliedFiles.length > 0) {
        _rollbackAndMark(engine, backupInfo, result, memory, `multi-file change failed on ${filePath}: ${applyResult.reason}`);
      }
      result.changes.push({ filePath, applied: false, reason: applyResult.reason, atomicRollback: appliedFiles.length > 0 });
      return { success: false, backups: backupInfo };
    }

    const syntaxCheck = engine.verifySyntax(filePath);
    if (!syntaxCheck.valid) {
      _rollbackAndMark(engine, backupInfo, result, memory, `multi-file syntax check failed on ${filePath}: ${syntaxCheck.issues.join(', ')}`);
      result.changes.push({ filePath, applied: false, reason: `Syntax error: ${syntaxCheck.issues.join(', ')}`, atomicRollback: true });
      return { success: false, backups: backupInfo };
    }

    appliedFiles.push(filePath);
    result.changes.push({ filePath, applied: true, backupPath: backupInfo.backups[filePath], description, fuzzyMatched: applyResult.fuzzyMatched || false });
  }

  return { success: true, backups: backupInfo };
}

async function _runRuntimeValidation(engine, backupInfo, result, spec, memory) {
  const config = spec.runtimeValidation || {};
  const healthUrl = config.healthUrl || 'http://localhost:5000/health';
  const startCommand = config.startCommand || null;
  const timeoutMs = config.timeoutMs || 15000;

  let runtimeResult;
  if (startCommand) {
    const cmdCheck = CommandValidator.isAllowed(startCommand);
    if (!cmdCheck.allowed) {
      _rollbackAndMark(engine, backupInfo, result, memory, `startCommand blocked: ${cmdCheck.reason}`);
      result.changes.push({ runtimeCheck: false, reason: `startCommand blocked by security policy: ${cmdCheck.reason}`, rolledBack: true });
      return false;
    }
    runtimeResult = await engine.verifyRuntimeWithProcess({ startCommand, healthUrl, crashWatchMs: 5000, healthTimeoutMs: timeoutMs });
  } else {
    runtimeResult = await engine.verifyRuntime({ healthUrl, timeoutMs });
  }

  if (!runtimeResult.healthy) {
    const reason = runtimeResult.reason + (runtimeResult.errors ? ': ' + runtimeResult.errors.slice(0, 2).join('; ') : '');
    _rollbackAndMark(engine, backupInfo, result, memory, `runtime validation failed — ${reason}`);
    result.changes.push({ runtimeCheck: false, reason, rolledBack: true });
    return false;
  }

  if (memory) memory.logDaily(`Ralph Loop: runtime validation passed (status ${runtimeResult.statusCode})`);
  return true;
}

async function executeRalphLoop(specPath, context, budget, options = {}) {
  const maxIterations = options.maxIterations || 10;
  const projectRoot = options.projectRoot || process.cwd();
  const dataDir = options.dataDir || path.join(projectRoot, '.sneebly');
  const memory = options.memory || null;
  const dryRun = options.dryRun || false;

  const engine = new CodeEngine({
    projectRoot,
    backupsDir: path.join(dataDir, 'backups'),
    agentsContext: context && context.agents ? context.agents : null,
  });

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  } catch (err) {
    return { status: 'failed', reason: `Cannot read spec: ${err.message}`, iterations: 0 };
  }

  const result = { status: 'pending', iterations: 0, specPath, changes: [] };
  const iterationHistory = [];
  let consecutiveStuck = 0;
  const MAX_CONSECUTIVE_STUCK = 3;

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
      context, budget, memory, dryRun, projectRoot,
      apiKey: options.apiKey, identityDir: options.identityDir, templatesDir: options.templatesDir,
      iterationHistory,
    });

    if (execResult.status === 'SPEC_COMPLETE') {
      result.status = 'completed';
      if (memory) memory.logDaily(`Ralph Loop: spec completed after ${result.iterations} iteration(s) — ${spec.filePath || 'unknown'}`);
      break;
    }

    if (execResult.status === 'stuck') {
      consecutiveStuck++;
      iterationHistory.push({
        iteration: result.iterations,
        status: 'stuck',
        reason: execResult.reason || 'unknown',
      });

      if (consecutiveStuck >= MAX_CONSECUTIVE_STUCK) {
        result.status = 'stuck';
        result.reason = `${execResult.reason || 'unknown'} (after ${consecutiveStuck} consecutive stuck attempts)`;
        if (memory) memory.logDaily(`Ralph Loop: stuck after ${result.iterations} iteration(s) — ${result.reason}`);
        break;
      }

      if (memory) memory.logDaily(`Ralph Loop: attempt ${result.iterations} stuck (${execResult.reason}) — retrying with context`);
      continue;
    }

    consecutiveStuck = 0;

    if (execResult.status === 'dry-run') { result.status = 'dry-run'; break; }

    let changeBackups = _emptyBackupInfo();

    if (execResult.status === 'multi-change' && Array.isArray(execResult.changes)) {
      const multiResult = await _applyMultiFileChanges(engine, execResult.changes, result, memory);
      if (!multiResult.success) continue;
      changeBackups = multiResult.backups;
    } else if (execResult.status === 'change') {
      const singleResult = await _applySingleChange(engine, execResult, result, memory);
      if (!singleResult.success) continue;
      changeBackups = singleResult.backups;
    } else {
      continue;
    }

    if (spec.testCommand) {
      const testResult = engine.runTests(spec.testCommand);
      if (!testResult.passed && !testResult.warning) {
        _rollbackAndMark(engine, changeBackups, result, memory, 'tests failed after changes');
        iterationHistory.push({ iteration: result.iterations, status: 'test-failed', reason: 'tests failed after applying change' });
        continue;
      }
    }

    if (spec.runtimeValidation) {
      const runtimeOk = await _runRuntimeValidation(engine, changeBackups, result, spec, memory);
      if (!runtimeOk) {
        iterationHistory.push({ iteration: result.iterations, status: 'runtime-failed', reason: 'runtime validation failed after change' });
        continue;
      }
    }

    iterationHistory.push({
      iteration: result.iterations,
      status: 'change-applied',
      changeDescription: execResult.description || (execResult.changes ? execResult.changes.map(c => c.description).join('; ') : 'applied'),
    });
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
  const destDir = path.join(dataDir, status === 'completed' ? 'completed' : 'failed');
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(specPath));
    fs.copyFileSync(specPath, destPath);
    fs.unlinkSync(specPath);
  } catch {}
}

module.exports = { executeRalphLoop, _moveSpec };
