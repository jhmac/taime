'use strict';

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { buildSystemPrompt } = require('../context-loader');
const { InputSanitizer, OutputValidator } = require('../security');

const MODEL_MAP = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-6',
};

const COST_ESTIMATES = {
  haiku: 0.005,
  sonnet: 0.02,
  opus: 0.10,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadSubagentDefinition(agentName, identityDir, templatesDir) {
  const projectPath = path.join(identityDir, 'subagents', `${agentName}.md`);

  try {
    const raw = fs.readFileSync(projectPath, 'utf-8');
    return raw;
  } catch {}

  if (templatesDir) {
    const fallbackPath = path.join(templatesDir, 'subagents', `${agentName}.md`);
    try {
      const raw = fs.readFileSync(fallbackPath, 'utf-8');
      return raw;
    } catch {}
  }

  return `---\nname: ${agentName}\nmodel: sonnet\n---\nYou are the ${agentName} subagent. Analyze the input and return a JSON response.`;
}

function estimateCost(model) {
  return COST_ESTIMATES[model] || COST_ESTIMATES.sonnet;
}

function _extractBalancedJson(text, startIdx) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.substring(startIdx, i + 1);
      }
    }
  }
  return null;
}

const SPEC_COMPLETE_NL_PATTERNS = [
  /all\s+(?:success\s+)?criteria\s+(?:are|have\s+been)\s+(?:met|satisfied|already)/i,
  /both\s+(?:criteria|requirements)\s+(?:are|have\s+been)\s+(?:met|satisfied)/i,
  /criteria.*(?:already|currently)\s+(?:met|satisfied|implemented|working)/i,
  /(?:already|currently)\s+(?:implemented|working|functional|exists|present|in\s+place)/i,
  /no\s+(?:changes?\s+)?(?:needed|required|necessary)/i,
  /(?:the|this)\s+(?:code|implementation|feature)\s+(?:already|is\s+already)\s/i,
  /nothing\s+(?:to|needs?\s+to)\s+(?:change|fix|update|modify)/i,
  /success\s+criteria.*(?:already|all)\s+(?:met|satisfied|fulfilled)/i,
];

function _detectNaturalLanguageComplete(text) {
  if (!text || typeof text !== 'string') return false;
  const firstChunk = text.substring(0, 1500);
  const matchCount = SPEC_COMPLETE_NL_PATTERNS.filter(p => p.test(firstChunk)).length;
  return matchCount >= 1;
}

function _tryFixJson(jsonStr) {
  let fixed = jsonStr;
  fixed = fixed.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  fixed = fixed.replace(/(['"])?(\w+)(['"])?\s*:/g, (_, q1, key, q3) => {
    if (q1 === '"' && q3 === '"') return `"${key}":`;
    if (q1 === "'" && q3 === "'") return `"${key}":`;
    return `"${key}":`;
  });
  try { return JSON.parse(fixed); } catch { return null; }
}

function parseSubagentResponse(response) {
  if (typeof response !== 'string') {
    return { action: 'queue', reason: 'non-string-response', raw: response };
  }

  const trimmed = response.trim();

  if (trimmed.startsWith('SPEC_COMPLETE') || trimmed === 'SPEC_COMPLETE') {
    return { status: 'SPEC_COMPLETE', action: 'queue' };
  }

  const allCodeBlocks = [];
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(response)) !== null) {
    allCodeBlocks.push({ content: cbMatch[1].trim(), index: cbMatch.index });
  }

  for (const block of allCodeBlocks) {
    const braceIdx = block.content.indexOf('{');
    if (braceIdx === -1) continue;
    const candidate = _extractBalancedJson(block.content, braceIdx);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate);
        if (!parsed.action) parsed.action = 'queue';
        return parsed;
      } catch {
        const fixed = _tryFixJson(candidate);
        if (fixed) {
          if (!fixed.action) fixed.action = 'queue';
          return fixed;
        }
      }
    }
  }

  const statusIndices = [];
  let searchFrom = 0;
  while (true) {
    const idx = response.indexOf('"status"', searchFrom);
    if (idx === -1) break;
    statusIndices.push(idx);
    searchFrom = idx + 1;
  }

  for (const statusIdx of statusIndices) {
    let braceStart = response.lastIndexOf('{', statusIdx);
    if (braceStart === -1) continue;

    let outerBrace = braceStart;
    for (let scan = braceStart - 1; scan >= Math.max(0, braceStart - 500); scan--) {
      if (response[scan] === '{') {
        const testCandidate = _extractBalancedJson(response, scan);
        if (testCandidate && testCandidate.includes('"status"')) {
          try {
            const testParsed = JSON.parse(testCandidate);
            if (testParsed.status) { outerBrace = scan; break; }
          } catch {}
        }
      }
    }

    const candidate = _extractBalancedJson(response, outerBrace);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.status) {
          if (!parsed.action) parsed.action = 'queue';
          return parsed;
        }
      } catch {
        const fixed = _tryFixJson(candidate);
        if (fixed && fixed.status) {
          if (!fixed.action) fixed.action = 'queue';
          return fixed;
        }
      }
    }
  }

  for (let i = 0; i < response.length; i++) {
    if (response[i] === '{') {
      const candidate = _extractBalancedJson(response, i);
      if (candidate && candidate.length > 20) {
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && (parsed.status || parsed.filePath || parsed.oldCode || parsed.content)) {
            if (!parsed.action) parsed.action = 'queue';
            return parsed;
          }
        } catch {
          const fixed = _tryFixJson(candidate);
          if (fixed && (fixed.status || fixed.filePath)) {
            if (!fixed.action) fixed.action = 'queue';
            return fixed;
          }
        }
      }
    }
  }

  if (_detectNaturalLanguageComplete(trimmed)) {
    return { status: 'SPEC_COMPLETE', action: 'queue', detectedVia: 'natural-language' };
  }

  return { action: 'queue', reason: 'parse-failed', raw: response.substring(0, 2000) };
}

function isRateLimitError(err) {
  if (err && err.status === 429) return true;
  if (err && err.error && err.error.type === 'rate_limit_error') return true;
  const msg = (err && err.message) || '';
  return msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests');
}

function isOverloadedError(err) {
  if (err && err.status === 529) return true;
  const msg = (err && err.message) || '';
  return msg.includes('529') || msg.toLowerCase().includes('overloaded');
}

function isAuthError(err) {
  if (err && (err.status === 401 || err.status === 403)) return true;
  const msg = (err && err.message) || '';
  return msg.includes('invalid x-api-key') || msg.includes('invalid api key');
}

function isBillingError(err) {
  if (err && err.status === 400) {
    const msg = (err && err.message) || '';
    return msg.toLowerCase().includes('credit balance') || msg.toLowerCase().includes('billing');
  }
  return false;
}

async function callClaudeAPI(apiKey, systemPrompt, userPrompt, model) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, baseURL: process.env.ANTHROPIC_BASE_URL || undefined });

  const maxRetries = 2;
  const baseDelay = 2000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL_MAP[model] || MODEL_MAP.sonnet,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      return response.content[0].text;
    } catch (err) {
      if (isAuthError(err) || isBillingError(err)) {
        throw err;
      }

      const retryable = isRateLimitError(err) || isOverloadedError(err);

      if (!retryable || attempt === maxRetries) {
        throw err;
      }

      let retryAfter = null;
      if (err.headers && typeof err.headers.get === 'function') {
        retryAfter = err.headers.get('retry-after');
      } else if (err.headers && err.headers['retry-after']) {
        retryAfter = err.headers['retry-after'];
      }

      const waitMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 120000)
        : Math.min(baseDelay * Math.pow(2, attempt), 120000);

      const jitter = Math.random() * 2000;
      await sleep(waitMs + jitter);
    }
  }
}

const ACTIONABLE_TYPES = new Set(['file_edit', 'run_command', 'fix']);

function _collectValidationTargets(result) {
  const targets = [];

  if (result.type && ACTIONABLE_TYPES.has(result.type)) {
    targets.push(result);
  }

  if (result.status === 'create' && result.filePath) {
    targets.push({ type: 'file_edit', filePath: result.filePath });
  }

  if (result.status === 'multi-create' && Array.isArray(result.files)) {
    for (const f of result.files) {
      if (f.filePath) targets.push({ type: 'file_edit', filePath: f.filePath });
    }
  }

  return targets;
}

async function delegateToSubagent(agentName, task, options = {}) {
  const {
    context,
    budget,
    memory,
    apiKey,
    identityDir,
    templatesDir,
    dryRun,
  } = options;

  const definition = loadSubagentDefinition(agentName, identityDir, templatesDir);
  const parsed = matter(definition);
  const model = parsed.data.model || 'sonnet';

  const cost = estimateCost(model);
  if (budget.spent + cost > budget.max) {
    return { action: 'skip', reason: 'budget-exceeded' };
  }

  const systemPrompt = buildSystemPrompt(context) + '\n\n---\n\n' + parsed.content.trim();

  const sanitizedTask = InputSanitizer.wrapAsData('task-data', typeof task === 'string' ? task : JSON.stringify(task, null, 2));

  if (dryRun) {
    return {
      action: 'dry-run',
      subagent: agentName,
      model,
      estimatedCost: cost,
    };
  }

  if (!apiKey) {
    return { action: 'skip', reason: 'no-api-key' };
  }

  let response;
  try {
    response = await callClaudeAPI(apiKey, systemPrompt, sanitizedTask, model);
  } catch (apiError) {
    const isAuth = isAuthError(apiError);
    const isBilling = isBillingError(apiError);
    const isRateLimit = isRateLimitError(apiError);
    const isOverload = isOverloadedError(apiError);
    const errorType = isAuth ? 'invalid-api-key' : isBilling ? 'no-credits' : isRateLimit ? 'rate-limited' : isOverload ? 'overloaded' : 'api-unreachable';
    if (memory) {
      memory.logDaily(`Claude API ${errorType} for ${agentName}: ${apiError.message || apiError.status}`);
    }
    return { action: 'skip', reason: errorType };
  }

  budget.spent += cost;

  const result = parseSubagentResponse(response);

  const validationTargets = _collectValidationTargets(result);
  for (const target of validationTargets) {
    const validation = OutputValidator.validateAction(target);
    if (!validation.valid) {
      if (memory) memory.logDaily(`Output validation failed for ${agentName}: ${validation.reasons.join('; ')}`);
      return { action: 'queue', reason: `validation-failed: ${validation.reasons[0]}`, originalResponse: result };
    }
  }

  if (memory) {
    memory.logDaily(`${agentName} (${model}): ${result.action} — $${cost.toFixed(3)}`);
  }

  return result;
}

module.exports = {
  delegateToSubagent,
  loadSubagentDefinition,
  estimateCost,
  parseSubagentResponse,
  callClaudeAPI,
  MODEL_MAP,
  COST_ESTIMATES,
};
