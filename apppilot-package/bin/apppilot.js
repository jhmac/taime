#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const TARGET_DIR = process.cwd();

const IDENTITY_FILES = [
  'SOUL.md', 'AGENTS.md', 'GOALS.md',
  'IDENTITY.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md',
];

const TEMPLATE_MAP = {
  'SOUL.md': 'SOUL-template.md',
  'AGENTS.md': 'AGENTS-template.md',
  'GOALS.md': 'GOALS-template.md',
  'HEARTBEAT.md': 'HEARTBEAT-template.md',
  'IDENTITY.md': 'IDENTITY-template.md',
  'TOOLS.md': 'TOOLS-template.md',
};

const DATA_DIRS = [
  '.apppilot',
  '.apppilot/approved-queue',
  '.apppilot/queue/pending',
  '.apppilot/completed',
  '.apppilot/failed',
  '.apppilot/backups',
  '.apppilot/memory',
  '.apppilot/decisions',
];

function init() {
  console.log('apppilot init — setting up your project...\n');

  let created = 0;
  let skipped = 0;

  for (const dir of DATA_DIRS) {
    const fullPath = path.join(TARGET_DIR, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`  [dir] ${dir}/`);
    }
  }

  for (const file of IDENTITY_FILES) {
    const dest = path.join(TARGET_DIR, file);
    if (fs.existsSync(dest)) {
      console.log(`  [skip] ${file} already exists`);
      skipped++;
      continue;
    }

    const templateName = TEMPLATE_MAP[file];
    const src = templateName
      ? path.join(TEMPLATE_DIR, templateName)
      : path.join(TEMPLATE_DIR, file);

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      const editable = ['SOUL.md', 'AGENTS.md', 'GOALS.md'].includes(file);
      console.log(`  [copy] ${file}${editable ? ' (edit this for your app)' : ''}`);
      created++;
    } else {
      const fallback = path.join(TEMPLATE_DIR, file);
      if (fs.existsSync(fallback)) {
        fs.copyFileSync(fallback, dest);
        console.log(`  [copy] ${file}`);
        created++;
      }
    }
  }

  const checksums = {};
  for (const f of IDENTITY_FILES) {
    const fp = path.join(TARGET_DIR, f);
    if (fs.existsSync(fp)) {
      checksums[f] = crypto.createHash('sha256')
        .update(fs.readFileSync(fp, 'utf8'))
        .digest('hex');
    }
  }
  const checksumPath = path.join(TARGET_DIR, '.apppilot', 'identity-checksums.json');
  fs.writeFileSync(checksumPath, JSON.stringify(checksums, null, 2));
  console.log('  [gen] identity checksums');

  const knownErrorsPath = path.join(TARGET_DIR, '.apppilot', 'known-errors.json');
  if (!fs.existsSync(knownErrorsPath)) {
    fs.writeFileSync(knownErrorsPath, JSON.stringify({ errors: [] }, null, 2));
  }
  const metricsPath = path.join(TARGET_DIR, '.apppilot', 'metrics.json');
  if (!fs.existsSync(metricsPath)) {
    fs.writeFileSync(metricsPath, JSON.stringify({ snapshots: [] }, null, 2));
  }

  const gitignorePath = path.join(TARGET_DIR, '.gitignore');
  const gitignoreEntries = [
    '',
    '# AppPilot',
    '.apppilot/backups/',
    '.apppilot/memory/',
    '.apppilot/completed/',
    '.apppilot/failed/',
  ];
  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, 'utf8');
    if (!current.includes('# AppPilot')) {
      fs.appendFileSync(gitignorePath, gitignoreEntries.join('\n') + '\n');
      console.log('  [update] .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, gitignoreEntries.join('\n') + '\n');
    console.log('  [create] .gitignore');
  }

  console.log(`\nDone! ${created} files created, ${skipped} skipped.`);
  console.log('\nNext steps:');
  console.log('  1. Edit GOALS.md — your app\'s mission, priorities, and what to fix/ignore');
  console.log('  2. Edit AGENTS.md — which file paths AppPilot can safely modify');
  console.log('  3. Edit SOUL.md — set your owner email and app identity');
  console.log('  4. Set environment variables:');
  console.log('     ANTHROPIC_API_KEY (required)');
  console.log('     ANTHROPIC_BASE_URL (if using Replit AI proxy)');
  console.log('  5. Install Playwright browser: npx playwright install chromium');
  console.log('');
  console.log('  Commands:');
  console.log('    npx apppilot-heartbeat    — run a monitoring + fix cycle');
  console.log('    npx apppilot-elon         — find and fix limiting factors');
  console.log('    npx apppilot-crawl        — crawl site for errors');
  console.log('    npx apppilot-continuous   — continuous improvement loop');
}

async function heartbeat() {
  console.log('apppilot heartbeat — running cycle...\n');

  const apiKey = process.env.APPPILOT_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: APPPILOT_ANTHROPIC_KEY or ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const { runHeartbeat } = require('../src/index');
  const result = await runHeartbeat({
    projectRoot: TARGET_DIR,
    apiKey,
    appUrl: process.env.APP_URL || 'http://localhost:5000',
    dryRun: process.argv.includes('--dry-run'),
  });

  console.log('\nHeartbeat result:');
  console.log(JSON.stringify(result, null, 2));

  const hasErrors = result.errors && result.errors.length > 0;
  process.exit(hasErrors ? 1 : 0);
}

function status() {
  console.log('apppilot status\n');

  const missing = [];
  const present = [];

  for (const file of IDENTITY_FILES) {
    const dest = path.join(TARGET_DIR, file);
    if (fs.existsSync(dest)) {
      present.push(file);
    } else {
      missing.push(file);
    }
  }

  console.log(`Identity files: ${present.length}/${IDENTITY_FILES.length}`);
  for (const f of present) console.log(`  [ok] ${f}`);
  for (const f of missing) console.log(`  [missing] ${f}`);

  const apppilotDir = path.join(TARGET_DIR, '.apppilot');
  console.log(`\nData directory: ${fs.existsSync(apppilotDir) ? 'exists' : 'not found'}`);

  const queueDirs = ['queue/pending', 'approved-queue', 'completed', 'failed'];
  for (const dir of queueDirs) {
    const dirPath = path.join(apppilotDir, dir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
      console.log(`  ${dir}: ${files.length} specs`);
    }
  }

  if (fs.existsSync(path.join(apppilotDir, 'known-errors.json'))) {
    try {
      const errors = JSON.parse(fs.readFileSync(path.join(apppilotDir, 'known-errors.json'), 'utf-8'));
      console.log(`\nKnown errors: ${errors.errors.length}`);
    } catch {}
  }

  const checksumPath = path.join(apppilotDir, 'identity-checksums.json');
  if (fs.existsSync(checksumPath)) {
    const checksums = JSON.parse(fs.readFileSync(checksumPath, 'utf8'));
    console.log(`Identity checksums: ${Object.keys(checksums).length} files protected`);
  }
}

const command = process.argv[2];

switch (command) {
  case 'init':
    init();
    break;
  case 'heartbeat':
    heartbeat().catch(err => {
      console.error(`Heartbeat failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'status':
    status();
    break;
  default:
    console.log('Usage: npx apppilot <command>\n');
    console.log('Commands:');
    console.log('  init        Set up AppPilot in your project');
    console.log('  heartbeat   Run a single heartbeat cycle');
    console.log('  status      Show current AppPilot status');
    console.log('\nStandalone commands:');
    console.log('  npx apppilot-heartbeat    Run a monitoring + fix cycle');
    console.log('  npx apppilot-elon         Find and fix limiting factors');
    console.log('  npx apppilot-crawl        Crawl site for errors');
    console.log('  npx apppilot-continuous   Continuous improvement loop');
    console.log('\nOptions:');
    console.log('  --dry-run   Run heartbeat without making changes');
    break;
}
