#!/usr/bin/env node
'use strict';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
ELON — Sneebly Strategic Constraint Solver

Crawls your live site, identifies the #1 blocking constraint using AI,
creates specs to fix it, executes them, then verifies the fix.

Usage:
  npx sneebly elon [options]

Options:
  --budget <amount>      Max budget in dollars (default: $10.00)
  --max <count>          Max constraints to solve per run (default: 5)
  --mode <mode>          Force mode: build, fix, or auto (default: auto)
  --no-crawl             Skip Playwright crawl, analyze code only
  --url <url>            App URL to crawl (default: http://localhost:5000)
  --help, -h             Show this help message

Environment variables (alternative to flags):
  ANTHROPIC_API_KEY      Required. Claude API key for analysis.
  ELON_BUDGET            Same as --budget
  ELON_MAX_CONSTRAINTS   Same as --max
  ELON_CRAWL=false       Same as --no-crawl
  APP_URL                Same as --url

Examples:
  npx sneebly elon
  npx sneebly elon --budget 5 --max 3
  npx sneebly elon --no-crawl --budget 2
  npx sneebly elon --mode=build
  npx sneebly elon --mode=fix
`);
  process.exit(0);
}

function getArg(flag, envVar, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (envVar && process.env[envVar]) return process.env[envVar];
  return defaultVal;
}

const path = require('path');
const { runElonLoop, getElonMode, saveElonLog } = require('../src/elon.js');
const { loadContext } = require('../src/context-loader.js');

const modeArg = args.find(a => a.startsWith('--mode='));
const forcedMode = modeArg ? modeArg.split('=')[1] : null;
const projectRoot = process.cwd();
const dataDir = path.join(projectRoot, '.sneebly');

if (forcedMode && ['build', 'fix', 'auto'].includes(forcedMode)) {
  saveElonLog(dataDir, { modeOverride: forcedMode === 'auto' ? null : forcedMode });
  console.log(`ELON mode set to: ${forcedMode}`);
}

const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const budgetMax = parseFloat(getArg('--budget', 'ELON_BUDGET', '10.0')) || 10.0;
const maxConstraints = parseInt(getArg('--max', 'ELON_MAX_CONSTRAINTS', '5')) || 5;
const enableCrawl = !args.includes('--no-crawl') && process.env.ELON_CRAWL !== 'false';
const appUrl = getArg('--url', 'APP_URL', 'http://localhost:5000');

const context = loadContext(projectRoot);
const currentMode = getElonMode({ context, dataDir });

console.log('ELON starting — identifying limiting factors...');
console.log(`   Mode: ${currentMode}`);
console.log(`   Playwright crawl: ${enableCrawl ? 'ENABLED' : 'DISABLED'}`);
console.log(`   Budget: $${budgetMax.toFixed(2)}`);
console.log(`   Max constraints: ${maxConstraints}`);
console.log(`   Target: ${appUrl}`);
console.log('');

runElonLoop({
  apiKey,
  appUrl,
  maxConstraints,
  budgetMax,
  enableCrawl,
  projectRoot,
}).then(r => {
  console.log('\nFinal result:', JSON.stringify(r, null, 2));
  process.exit(r.constraintsSolved > 0 ? 0 : 1);
}).catch(e => {
  console.error('ELON failed:', e.message);
  process.exit(1);
});
