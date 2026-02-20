# Sneebly

Autonomous AI agent that monitors, analyzes, and improves your app. Uses Claude to find issues, generate fixes, and apply them — with rollback safety.

## Install

```bash
npm install ./sneebly-0.3.0.tgz
```

## Setup

```bash
npx sneebly init
npx playwright install chromium
```

Edit GOALS.md, AGENTS.md, and SOUL.md for your app.

Set environment variables:
- `ANTHROPIC_API_KEY` (required)
- `ANTHROPIC_BASE_URL` (if using Replit AI proxy)
- `SNEEBLY_INTERNAL_KEY` (random secret for dashboard auth)

## Commands

| Command | What it does |
|---------|-------------|
| `npx sneebly init` | Set up Sneebly in your project |
| `npx sneebly-heartbeat` | Run one monitoring + fix cycle |
| `npx sneebly-elon` | Find and solve limiting factors with Playwright |
| `npx sneebly-crawl` | Crawl your site and report errors |
| `npx sneebly-continuous` | Keep fixing until all high/medium issues are resolved |

All commands support `--help` for usage details.

## Integration

Add Sneebly to your Express app:

```javascript
const { initSneebly } = require('sneebly');

const app = express();
initSneebly(app, {
  projectRoot: __dirname,
  dashboardPath: '/sneebly/dashboard',
});
```

Then visit `/sneebly/dashboard` (requires `SNEEBLY_INTERNAL_KEY` env var for auth).

## Features

- **Ralph Loop** — specs go in, code changes come out, tests validate
- **ELON** — strategic constraint solver that finds what's most blocking your goals
- **Playwright Crawler** — crawls your live site like a real user to find errors
- **Auto-approval** — safe changes apply automatically, risky ones wait for you
- **Dashboard** — web UI at /sneebly/dashboard showing status, errors, queue
- **Memory** — ELON-REPORT.md tracks everything tested, passed, failed, and trending
- **Rollback** — every change is backed up and reverted if tests fail
- **Identity Protection** — SHA-256 checksums on config files prevent tampering

## The OpenClaw Identity System

Sneebly's behavior is defined by markdown files in your project root. Each file uses optional YAML frontmatter and markdown content. The agent reads these files but can **never modify them**.

| File | Purpose | Who edits it |
|------|---------|-------------|
| `SOUL.md` | Agent personality, values, communication style | You (the owner) |
| `AGENTS.md` | Project config: safe/protected file paths, coding standards | You |
| `GOALS.md` | Mission, priorities, quality targets | You |
| `IDENTITY.md` | Operating procedures, decision-making rules | You |
| `USER.md` | Owner context: your goals, preferences, business domain | You |
| `TOOLS.md` | Available capabilities and their constraints | You |
| `HEARTBEAT.md` | Schedule, budget limits, performance thresholds | You |

## Security Architecture

Sneebly uses defense-in-depth security with six independent layers:

1. **Identity Protection** — SHA-256 checksummed config files, halt on tampering
2. **Owner Verification** — Timing-safe key comparison for dashboard access
3. **Rate Limiting** — Per-IP brute-force protection
4. **Command Validation** — Whitelisted commands only (npm test/build, git, eslint, curl)
5. **Input Sanitization** — Social engineering and injection pattern detection
6. **Output Validation** — File path and command checks before execution

## Safety Guarantees

- Identity files cannot be modified by the agent
- Protected paths require owner approval
- All commands are whitelisted — no arbitrary shell execution
- Changes are backed up before application, auto-rollback on test failure
- Budget limits prevent runaway API spending
- External data is never treated as instructions

## Dashboard API Endpoints

All endpoints require `X-Sneebly-Key` header or `key` query parameter.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sneebly/dashboard` | Dashboard HTML |
| GET | `/sneebly/api/status` | Agent status and stats |
| GET | `/sneebly/api/feed` | Activity feed |
| GET | `/sneebly/api/errors` | Known errors |
| GET | `/sneebly/api/metrics` | Performance metrics |
| GET | `/sneebly/api/queue` | Pending and approved items |
| POST | `/sneebly/api/queue/:id/approve` | Approve a pending item |
| POST | `/sneebly/api/queue/:id/reject` | Reject a pending item |
| POST | `/sneebly/api/discover` | Trigger discovery cycle |
| POST | `/sneebly/api/continuous` | Start continuous loop |
| POST | `/sneebly/api/crawl` | Start site crawl |
| POST | `/sneebly/api/elon/start` | Start ELON constraint solver |
| GET | `/sneebly/api/elon/status` | ELON status |
| POST | `/sneebly/api/elon/stop` | Stop ELON |
| GET | `/sneebly/api/elon/report` | ELON report data |

## Cost Estimate

Typical monthly cost: **$15-40/month** for a standard Express application at 4 heartbeats/day. Budget cap per heartbeat (default $1.50) prevents spikes.

## Changelog

### 0.3.0

- Added ELON strategic constraint solver
- Added Playwright site crawler
- Added continuous improvement loop
- Added ELON-REPORT.md memory and reporting
- Added dashboard buttons for ELON, Crawl, Discovery
- Added CLI commands: sneebly-elon, sneebly-crawl, sneebly-continuous
- Fixed: init no longer overwrites host app's package.json
- Fixed: JSON parser handles markdown-wrapped responses
- Fixed: Path safety strips descriptions from patterns
- Fixed: curl in command whitelist
- Fixed: Test retry with recompilation delay
- Fixed: Smart code truncation (50KB limit)

### 0.2.0

- Added goals-aware auto-approval system
- Added CLI setup script with template scaffolding
- Added standalone heartbeat CLI command
- Fixed: dispatcher uses ANTHROPIC_BASE_URL for proxy support
- Fixed: completion detection for plain-text responses
