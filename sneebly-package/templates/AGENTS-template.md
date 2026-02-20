<!-- PROTECTED FILE — Only edit manually via the Replit editor. -->
<!-- Sneebly will NEVER modify this file. Changes are checksummed. -->

# Sneebly Agent Instructions

## Project Overview

Describe your project here. What does it do? What tech stack does it use?

## Architecture

- **Entry point:** `server/index.ts` or `index.js`
- **Frontend:** `/client/src/` or `/src/`
- **Backend API:** `/server/routes/` or `/api/`
- **Database:** `/shared/schema.ts` or similar
- **Config:** `.env`, `package.json`

## Safe Paths

Sneebly CAN modify files matching these patterns:

```
src/**
server/**
client/**
shared/**
public/**
```

## Protected Paths

Sneebly CANNOT modify files matching these patterns:

```
.env
*.config.js
*.config.ts
package.json
SOUL.md
AGENTS.md
GOALS.md
node_modules/**
.git/**
```

## Safe to Create New Files In
<!-- Build mode can scaffold new files in these directories -->
- server/routes/
- server/services/
- server/utils/
- client/src/pages/
- client/src/components/
- client/src/hooks/
- client/src/lib/
- shared/

## Build Mode Rules
1. When creating new files, follow the existing project structure exactly.
2. New routes must be registered in the main routes file.
3. New schema tables must use the same ORM patterns as existing tables.
4. New pages must use the existing routing setup.
5. Import paths must match the project's alias configuration.
6. Always check what already exists before creating.
7. Generated code must be COMPLETE — no placeholders or TODOs.

## Coding Standards

- Follow existing code conventions (indentation, naming, imports)
- Use TypeScript if the project uses TypeScript
- Prefer existing libraries over adding new dependencies
- Write clear error messages
- Keep functions small and focused

## Testing

- Run existing tests after changes: `npm test`
- Verify the app starts: `curl http://localhost:5000/health`
- Check for console errors after changes

## Deployment

- Target: (your deployment platform)
- Build command: `npm run build`
- Start command: `npm start`
