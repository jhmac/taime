#!/usr/bin/env node

'use strict';

const { runHeartbeatCycle } = require('../src/orchestrator.js');

const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
const appUrl = process.env.APP_URL || 'http://localhost:5000';

if (!apiKey) {
  console.error('Error: SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

console.log(`Running Sneebly heartbeat against ${appUrl}...`);

runHeartbeatCycle({ apiKey, appUrl, projectRoot: process.cwd() })
  .then(r => {
    console.log(JSON.stringify(r, null, 2));
    const hasErrors = r.errors && r.errors.length > 0;
    process.exit(hasErrors ? 1 : 0);
  })
  .catch(e => {
    console.error('Heartbeat failed:', e.message);
    process.exit(1);
  });
