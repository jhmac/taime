# GOALS.md — Sneebly North Star for LIBBY

<!-- Sneebly reads this to prioritize what to analyze, fix, and improve. -->
<!-- Update this as LIBBY evolves — it's your direct line to the agent. -->

## Mission

LIBBY is a Boutique Operating System that transforms how independent retail boutiques run their daily operations. It's for small business owners (1-5 locations, 3-15 employees) who are drowning in operational chaos — forgotten tasks, inconsistent procedures, no visibility into what's actually happening on the floor.

The vision: a boutique owner walks in on Monday morning and LIBBY has already briefed them on yesterday's numbers, flagged that the opening checklist wasn't completed on time Saturday, suggested a staffing adjustment for the slow Tuesday ahead, and reminded them that VIP customer Sarah's birthday is Thursday. The owner spends less time managing operations and more time doing what they love — curating products and building customer relationships.

LIBBY is built on six proven methodologies: 2 Second Lean (continuous improvement), Profit First (financial discipline), Remarkable Retail (customer experience), SOP Excellence (procedure consistency), GTD (task management), and AI as Copilot (cognitive load reduction).

## Architecture Context

- **Framework**: Express (backend) + React 18 with TypeScript (frontend), built with Vite
- **Database**: PostgreSQL on Neon serverless, managed with Drizzle ORM
- **Auth**: Clerk (OAuth/SSO with RBAC — Owner/Admin/Employee roles, 30+ permissions)
- **AI**: Anthropic Claude (claude-sonnet-4-20250514) for all AI features — inbox clarification, SOP surfacing, pattern recognition, Morning Whisper, staffing optimization
- **Real-time**: WebSocket server for live updates (shift changes, task assignments, notifications)
- **Integrations**: Shopify GraphQL Admin API (sales data sync, staffing recommendations)
- **Hosting**: Replit (deployment target: cloudrun)
- **UI Library**: shadcn/ui + Radix UI + Tailwind CSS

## Current Priorities

Sneebly works top-down. Higher = fix first.

1. **Reliability of LIVE features** — Clock-in/out, geofencing, scheduling, payroll reports, task assignment, and Clerk auth MUST work flawlessly. These are the foundation. A broken clock-in at 9:30 AM on a Saturday is a crisis.
2. **API performance** — Every endpoint under 500ms p95. The app is used on mobile devices in retail stores with variable connectivity. Slow = unusable.
3. **Shopify sync stability** — Real-time sales data streaming is IN DEV and critical. Broken sync means the AI Staffing Optimizer, Midday Pulse, and Morning Whisper all give bad data.
4. **Error handling and graceful degradation** — If Claude API is down, the app should still function for core operations (clock-in, tasks, SOPs). AI features degrade gracefully with cached data or sensible defaults.
5. **WebSocket reliability** — Real-time updates power shift change notifications, task assignment alerts, and live dashboard data. Dropped connections must auto-reconnect.
6. **Database query performance** — As SOP, GTD, and issue tracker tables grow, queries must stay fast. Index early, paginate everything, avoid N+1 patterns.

## Quality Targets

- API response: p95 under 500ms for all endpoints
- API response: p99 under 1000ms for all endpoints
- Clock-in/out endpoint: p95 under 200ms (most time-critical action in the app)
- Error rate: below 1% on all endpoints
- Error rate: below 0.1% on clock-in/out and payroll endpoints (financial accuracy)
- Uptime: 99.5% minimum
- WebSocket reconnection: under 5 seconds after disconnect
- Morning Whisper generation: under 10 seconds (audio briefing must feel instant)
- AI Inbox Clarification: under 3 seconds per item
- SOP surfacing: under 1 second (must feel context-aware, not sluggish)
- Shopify sync lag: under 60 seconds from Shopify event to LIBBY data update
- Zero unhandled promise rejections in production logs
- TypeScript strict mode: zero type errors

## What's Built (Sneebly: don't rebuild these, improve them)

### LIVE — In Production
- Digital Clock-In/Out with break logging (mobile-first)
- Geofencing with Haversine distance validation
- Photo Verification on clock-in (optional selfie capture)
- Visual Schedule Calendar with drag-and-drop shift management
- Shift Templates (reusable shift patterns)
- Availability Tracking (employee preferred hours and time-off requests)
- Payroll Reports with automated pay period generation and overtime calculations
- AI Staffing Optimizer (analyzes Shopify sales to suggest optimal staffing)
- Task Assignment with priority flags (create, assign, track)
- Clerk Auth + RBAC (Owner/Admin/Employee roles, 30+ permissions)
- Member Directory with inline profile editing
- Payroll Setup Wizard (onboarding flow)
- Activity Logging (audit trail of admin actions)

### IN DEV — Being Built Now
- Shopify Deep Sync (real-time sales data streaming)

### PLANNED — On the Roadmap but Not Started
- In-App Messaging (real-time threads)
- Payroll Export (Gusto/ADP integration)
- Anomaly Detection (unusual clock-in patterns, payroll errors)
- Visual Dashboards (labor cost trends, punctuality, task completion)
- PWA + Push Notifications
- Offline Mode (local storage for time entries)

## Improvement Preferences

### Auto-approve these types of changes:

- Database index additions (especially on `time_entries`, `sop_executions`, `next_actions`, `issues`, `notification_log` — these tables will grow fast)
- Dead code removal (unused exports, unreachable paths, commented-out code blocks)
- Null check additions on external API responses (Shopify API, Clerk webhooks, Claude API responses)
- Performance optimizations (query consolidation, response caching, N+1 elimination)
- Error handling improvements (try/catch additions, transaction wrapping on multi-step DB operations)
- Input validation additions (Zod schemas on API route inputs)
- TypeScript type narrowing (replacing `any` types with proper interfaces)
- WebSocket reconnection logic improvements
- API response standardization (consistent error shapes, proper HTTP status codes)
- Logging improvements (adding structured logs for debugging, removing console.log in favor of proper logger)
- Memory leak prevention (clearing intervals, removing event listeners, connection pool management)
- Drizzle query optimization (using `.select()` to limit columns, adding `.limit()` and `.offset()` for pagination)
- Caching layer additions for expensive queries (daily sales totals, staffing recommendations)

### Always require my approval for:

- Authentication/authorization changes (Clerk config, RBAC permissions, middleware)
- Payment/checkout flow modifications (any future Stripe integration)
- Database schema changes (new tables, column additions/removals, type changes, migrations)
- New API endpoints (every new endpoint is a new attack surface)
- Changes to AI prompts or model configuration (Morning Whisper tone, Inbox Clarification logic, SOP surfacing rules, Weekly Review prompts)
- Notification timing changes (quiet hours, alert schedules, escalation rules)
- Shopify OAuth flow modifications
- Clerk webhook handler changes
- Any change to how payroll calculations work (overtime rules, rounding, pay period boundaries)
- Any change to how geofencing distance is calculated (affects legal compliance for time tracking)
- SOP content modifications (even typo fixes — the owner may have specific wording for legal/training reasons)
- Customer data handling changes (Style DNA privacy implications)
- RBAC role or permission modifications
- Environment variable additions or changes

### Focus areas this month:

- Harden Shopify Deep Sync — ensure real-time sales data streaming is bulletproof with retry logic, dead letter queues, and reconciliation checks
- Performance audit on all LIVE endpoints — identify any query that's > 200ms and optimize
- Error handling sweep across all API routes — ensure every route has try/catch, returns proper status codes, and logs structured errors
- WebSocket stability — ensure reconnection logic handles all edge cases (server restart, network change, mobile app backgrounding)
- Prepare database schemas for Q1 sprint features (SOP Library, Opening/Closing Checklists, Issue Tracker MVP) — review planned schemas in SPECIFICATION.md and flag any concerns about indexing, data types, or relationships

### Ignore for now:

- GTD Workflow Engine (Q2 2026 — Modules 10)
- Style DNA / Customer Intelligence (Q2 2026 — Module 5)
- Morning Whisper AI Briefing (Q3 2026 — Module 6)
- Lean Board Gamification features (Q3 2026 — leaderboards, badges, awards)
- Advanced Analytics (Q4 2026 — QBR, monthly scorecards)
- Multi-location support (Q4 2026)
- UI/CSS styling changes (unless they cause functional issues)
- Test coverage improvements (important but not urgent for agent focus)
- Documentation updates
- Dependency version bumps (unless security vulnerability)
- Payroll Export integrations (Q4 2026)

## Roadmap

### Phase 1 — Q1 2026 (Current): Foundation + Daily Rituals + SOP Core

Theme: "Make every day run like clockwork with bulletproof procedures"

- Morning Huddle Mode (guided 10-min standup with SOP prompts)
- Opening/Closing Checklist SOPs (step-by-step with quality checkpoints)
- Daily Debrief Capture (end-of-day reflection)
- Issue Tracker MVP (quick logging, priority levels, status workflow, manager notifications)
- SOP Library foundation (searchable repository, step-by-step builder, categories)
- Midday Pulse (automated noon sales check)
- Shift Handoff Protocol SOP
- Shopify Deep Sync completion
- Context-Aware SOP Surfacing
- Role-Based Playbooks (Owner, Manager, Associate)
- Morning Task Check-In alerts
- Scheduled Meeting Reminders

Key outcomes: Daily rituals digitized, problems captured fast, SOPs are impossible to ignore, managers alerted when tasks aren't done.

### Phase 2 — Q2 2026: GTD Workflow + Customer Intelligence + Notifications

Theme: "Know your numbers, know your people, capture everything"

- Universal Inbox + AI Clarification Engine
- Next Actions & Projects Lists with context-based organization
- Waiting For Tracker + Someday/Maybe List
- Weekly Review Ritual (Friday 3pm, AI-guided)
- Style DNA MVP (customer profiles, notes, taste clusters)
- Full Notification Preferences system
- Overdue Task Escalation
- End-of-Day Summary digests
- In-App Messaging
- PWA + Push Notifications + Offline Mode

### Phase 3 — Q3 2026: AI Copilot + Gamification + Advanced SOPs

Theme: "Your AI partner runs the business with you"

- Morning Whisper (AI daily audio/text briefing)
- AI Review Assistant + Smart Task Suggestions
- SOP Training Mode (new hire coaching)
- Lean Board Leaderboard + Pattern Detection
- Recurring Issue Detection
- Decision Tree SOPs
- Taste Cluster Engine + Win-Back Triggers + VIP Alerts
- Photo/Video SOP Walkthroughs

### Phase 4 — Q4 2026: Polish + Scale Prep

Theme: "Ready for thousands of boutiques"

- Quarterly Business Review auto-generation
- Advanced Dashboards
- SOP Version Control + Templates Library
- Payroll Export (Gusto/ADP)
- Anomaly Detection
- AI Task Auto-Assign
- Emergency Procedures quick access
- Multi-location support
- Onboarding wizard
- White-label prep

## Technical Standards

- All database queries must use Drizzle ORM with parameterized inputs
- All API responses must follow the shape: `{ success: boolean, data?: T, error?: { message: string, code: string } }`
- All new routes need Zod input validation middleware
- All WebSocket events must include a `type` field and follow existing naming conventions
- All Claude API calls must include timeout handling (10s default, 30s for Morning Whisper generation)
- All Claude API calls must have fallback behavior if the API is unavailable (cached response, sensible default, or graceful error message)
- All Shopify API calls must handle rate limiting (check `X-Shopify-Shop-Api-Call-Limit` headers) and retry with exponential backoff
- All time-related logic must respect the store's configured timezone (not UTC, not server time)
- All payroll calculations must use decimal arithmetic (never floating point) — use a library like `decimal.js` or integer cents
- All user-facing timestamps must be formatted in the store's locale and timezone
- Clerk middleware must be applied to all protected routes — never bypass auth checks
- RBAC checks must happen at the route level AND the service level (defense in depth)
- All database transactions must be used for multi-step operations (e.g., completing an SOP execution should atomically update `sop_executions` and `activity_log`)
- Never store derived data that can be computed from source data (except for performance-critical caches with TTLs)
- All environment variables must be accessed through a centralized config module, never `process.env` directly in route handlers

## Success Metrics (For Sneebly to Track)

### Operational Health
- Zero unhandled errors in production logs for 24+ hours
- All API endpoints responding under 500ms p95
- WebSocket uptime matching server uptime
- Shopify sync lag under 60 seconds

### Code Quality
- Zero `any` types in new or modified code
- All modified routes have Zod validation
- All modified routes have try/catch error handling
- Zero console.log statements (use structured logger)

### Business Impact (What the Owner Cares About)
- Clock-in reliability: 99.9% success rate
- Payroll report accuracy: zero calculation errors
- Task completion tracking: no lost or orphaned tasks
- SOP execution logging: complete and accurate audit trail
- Notification delivery: all alerts sent within configured windows
