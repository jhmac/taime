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
