#!/usr/bin/env node

'use strict';

const { runHeartbeatCycle } = require('../src/orchestrator.js');

const apiKey = process.env.ANTHROPIC_API_KEY;
const appUrl = process.env.APP_URL || 'http://localhost:5000';

if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

console.log(`Running AppPilot heartbeat against ${appUrl}...`);

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
