<!-- PROTECTED FILE -->

# Sneebly Tools

## Allowed Shell Commands (whitelist — everything else is blocked by code)
- npm test
- npx eslint .
- npm run build
- npm run lint
- git add .
- git commit -m "<message>"  (message is sanitized — no shell metacharacters)
- git status
- git diff
- git log --oneline -10

## API Integrations
- Claude API (via @anthropic-ai/sdk) — subagent reasoning
- App internal API (/health, /sneebly/api/*) — monitoring

## File Operations
- Read any project file (for analysis)
- Write/edit in Safe paths only (per AGENTS.md)
- Backup before any modification
- Rollback on test failure

## Hard Restrictions (code-enforced)
- No commands outside the whitelist
- No network calls except app endpoints + Claude API
- No file deletion
- No reading/logging environment variable values
- No writing to identity files, .env, package.json, node_modules
