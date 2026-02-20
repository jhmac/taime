#!/usr/bin/env node
'use strict';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Sneebly Continuous Improvement Loop

Runs multiple heartbeat cycles back-to-back, fixing high and medium
severity issues until resolved or budget is exhausted.

Usage:
  npx sneebly-continuous [options]

Options:
  --cycles <count>       Max cycles to run (default: 5)
  --url <url>            App URL to monitor (default: http://localhost:5000)
  --help, -h             Show this help message

Environment variables:
  ANTHROPIC_API_KEY      Required. Claude API key.
  APP_URL                Same as --url
`);
  process.exit(0);
}

function getArg(flag, envVar, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (envVar && process.env[envVar]) return process.env[envVar];
  return defaultVal;
}

const { runHeartbeatCycle } = require('../src/orchestrator.js');

const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const maxCycles = parseInt(getArg('--cycles', null, '5')) || 5;
const appUrl = getArg('--url', 'APP_URL', 'http://localhost:5000');

console.log('Sneebly Continuous Loop starting...');
console.log(`   Max cycles: ${maxCycles}`);
console.log(`   Target: ${appUrl}`);
console.log('');

async function runLoop() {
  let totalChanges = 0;

  for (let i = 0; i < maxCycles; i++) {
    if (i > 0) {
      const pause = 5000 + Math.random() * 5000;
      console.log(`Pausing ${(pause / 1000).toFixed(1)}s before next cycle...`);
      await new Promise(r => setTimeout(r, pause));
    }

    console.log(`\n--- Cycle ${i + 1}/${maxCycles} ---`);

    try {
      const result = await runHeartbeatCycle({
        apiKey,
        appUrl,
        forceDiscovery: i === 0,
        projectRoot: process.cwd(),
      });

      if (result.steps) {
        const completed = result.steps.filter(s => s.status === 'completed').length;
        totalChanges += completed;
        console.log(`Cycle ${i + 1}: ${completed} changes applied`);
      } else {
        console.log(`Cycle ${i + 1}: completed`);
      }
    } catch (err) {
      console.error(`Cycle ${i + 1} failed: ${err.message}`);
      if (err.message.includes('429')) {
        console.log('Rate limited — waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
      }
    }
  }

  console.log(`\nContinuous loop complete. ${totalChanges} total changes applied across ${maxCycles} cycles.`);
  process.exit(0);
}

runLoop().catch(e => {
  console.error('Continuous loop failed:', e.message);
  process.exit(1);
});
