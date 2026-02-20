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
  '.sneebly',
  '.sneebly/approved-queue',
  '.sneebly/queue/pending',
  '.sneebly/completed',
  '.sneebly/failed',
  '.sneebly/backups',
  '.sneebly/memory',
  '.sneebly/decisions',
];

function _writeJsonIfNotExists(filePath, data, label) {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  if (label) console.log(`  [gen] ${label}`);
  return true;
}

function _copyDirTemplates(srcDir, destDir, ext, pathPrefix) {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith(ext))) {
    const dest = path.join(destDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(srcDir, file), dest);
      console.log(`  [copy] ${pathPrefix}${file}`);
    }
  }
}

function init() {
  console.log('sneebly init — setting up your project...\n');

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
  const checksumPath = path.join(TARGET_DIR, '.sneebly', 'identity-checksums.json');
  fs.writeFileSync(checksumPath, JSON.stringify(checksums, null, 2));
  console.log('  [gen] identity checksums');

  _writeJsonIfNotExists(path.join(TARGET_DIR, '.sneebly', 'known-errors.json'), { errors: [] });
  _writeJsonIfNotExists(path.join(TARGET_DIR, '.sneebly', 'metrics.json'), { snapshots: [] });
  _writeJsonIfNotExists(
    path.join(TARGET_DIR, '.sneebly', 'build-state.json'),
    { currentPhase: 1, hasUnbuiltMilestones: true, completed: [], failed: [], lastUpdated: null },
    'build-state.json'
  );

  _copyDirTemplates(
    path.join(TEMPLATE_DIR, 'subagents'),
    path.join(TARGET_DIR, '.sneebly', 'subagents'),
    '.md',
    '.sneebly/subagents/'
  );

  const gitignorePath = path.join(TARGET_DIR, '.gitignore');
  const gitignoreEntries = [
    '',
    '# Sneebly',
    '.sneebly/backups/',
    '.sneebly/memory/',
    '.sneebly/completed/',
    '.sneebly/failed/',
  ];
  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, 'utf8');
    if (!current.includes('# Sneebly')) {
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
  console.log('  2. Edit AGENTS.md — which file paths Sneebly can safely modify');
  console.log('  3. Edit SOUL.md — set your owner email and app identity');
  console.log('  4. Set environment variables:');
  console.log('     ANTHROPIC_API_KEY (required)');
  console.log('     ANTHROPIC_BASE_URL (if using Replit AI proxy)');
  console.log('  5. Install Playwright browser: npx playwright install chromium');
  console.log('');
  console.log('  Commands:');
  console.log('    npx sneebly-heartbeat    — run a monitoring + fix cycle');
  console.log('    npx sneebly-elon         — find and fix limiting factors');
  console.log('    npx sneebly-crawl        — crawl site for errors');
  console.log('    npx sneebly-continuous   — continuous improvement loop');
}

async function heartbeat() {
  console.log('sneebly heartbeat — running cycle...\n');

  const apiKey = process.env.SNEEBLY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: SNEEBLY_ANTHROPIC_KEY or ANTHROPIC_API_KEY environment variable is required');
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
  console.log('sneebly status\n');

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

  const sneebyDir = path.join(TARGET_DIR, '.sneebly');
  console.log(`\nData directory: ${fs.existsSync(sneebyDir) ? 'exists' : 'not found'}`);

  const queueDirs = ['queue/pending', 'approved-queue', 'completed', 'failed'];
  for (const dir of queueDirs) {
    const dirPath = path.join(sneebyDir, dir);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
      console.log(`  ${dir}: ${files.length} specs`);
    }
  }

  if (fs.existsSync(path.join(sneebyDir, 'known-errors.json'))) {
    try {
      const errors = JSON.parse(fs.readFileSync(path.join(sneebyDir, 'known-errors.json'), 'utf-8'));
      console.log(`\nKnown errors: ${errors.errors.length}`);
    } catch {}
  }

  const checksumPath = path.join(sneebyDir, 'identity-checksums.json');
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
    console.log('Usage: npx sneebly <command>\n');
    console.log('Commands:');
    console.log('  init        Set up Sneebly in your project');
    console.log('  heartbeat   Run a single heartbeat cycle');
    console.log('  status      Show current Sneebly status');
    console.log('\nStandalone commands:');
    console.log('  npx sneebly-heartbeat    Run a monitoring + fix cycle');
    console.log('  npx sneebly-elon         Find and fix limiting factors');
    console.log('  npx sneebly-crawl        Crawl site for errors');
    console.log('  npx sneebly-continuous   Continuous improvement loop');
    console.log('\nOptions:');
    console.log('  --dry-run   Run heartbeat without making changes');
    break;
}
