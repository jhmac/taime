# GOALS.md — Sneebly North Star

<!-- Sneebly reads this to prioritize what to analyze, fix, and improve. -->
<!-- Update this as your app evolves — it's your direct line to the agent. -->

## Mission

Describe your app's purpose and who it's for. What problem does it solve?

Example: "MyApp is a task management tool for small teams who need simple, reliable project tracking without the bloat of enterprise software."

## Architecture Context

- **Framework**: (e.g., Express + React, Next.js, Django + Vue)
- **Database**: (e.g., PostgreSQL, MongoDB, SQLite)
- **Auth**: (e.g., Clerk, Auth0, Passport.js)
- **AI**: (e.g., Anthropic Claude, OpenAI GPT-4)
- **Hosting**: (e.g., Replit, Vercel, Railway)

## Current Mode

<!-- Sneebly checks this to know if it's building or fixing -->
<!-- Values: build | fix | auto (auto is recommended) -->
**mode: auto**

## Current Phase

<!-- Which roadmap phase is active? -->
**phase: 1**

---

## App Specification

<!-- Full spec of what Sneebly should build. -->
<!-- Be specific: data models with all fields, endpoints with methods, pages with routes. -->

### Data Models

<!-- List every table with every field, type, and constraint -->

### API Endpoints

<!-- List every endpoint with method, path, auth, and behavior -->

### Pages / UI

<!-- List every page with route, purpose, and components -->

### Key Behaviors

<!-- Describe business logic, workflows, calculations, and rules -->

---

## Roadmap

### Phase 1: Foundation
- [ ] First milestone
- [ ] Second milestone

### Phase 2: Core Features
- [ ] First milestone
- [ ] Second milestone

---

## Current Priorities

Sneebly works top-down. Higher = fix first.

1. **Reliability** — Core features must work flawlessly. A broken login or crash is a crisis.
2. **Performance** — Pages should load fast. Target sub-500ms API responses.
3. **User experience** — Polish rough edges, fix confusing flows, improve error messages.
4. **New features** — Build what's next on your roadmap.

## Quality Targets

- Page load time: < 2 seconds
- API response time: < 500ms p95
- Error rate: < 0.1%
- Test coverage: > 80%

## Ignore for Now

List things Sneebly should NOT touch:

- Legacy code that's being replaced soon
- Experimental features behind feature flags
- Third-party code or vendored libraries

## Focus Areas This Month

1. (What are you working on this month?)
2. (What needs to be stable?)
3. (What can wait?)
