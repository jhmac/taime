# GOALS.md — Sneebly North Star for MAinager

<!-- Sneebly reads this to prioritize what to analyze, fix, and improve. -->
<!-- Update this as MAinager evolves — it's your direct line to the agent. -->

## Mission

MAinager is a Boutique Operating System that transforms how independent retail boutiques run their daily operations. It's for small business owners (1-5 locations, 3-15 employees) who are drowning in operational chaos — forgotten tasks, inconsistent procedures, no visibility into what's actually happening on the floor.

The vision: a boutique owner walks in on Monday morning and MAinager has already briefed them on yesterday's numbers, flagged that the opening checklist wasn't completed on time Saturday, suggested a staffing adjustment for the slow Tuesday ahead, and reminded them that VIP customer Sarah's birthday is Thursday. The owner spends less time managing operations and more time doing what they love — curating products and building customer relationships.

MAinager is built on six proven methodologies: 2 Second Lean (continuous improvement), Profit First (financial discipline), Remarkable Retail (customer experience), SOP Excellence (procedure consistency), GTD (task management), and AI as Copilot (cognitive load reduction).

## Architecture Context

- **Framework**: Express (backend) + React 18 with TypeScript (frontend), built with Vite
- **Database**: PostgreSQL on Neon serverless, managed with Drizzle ORM
- **Auth**: Clerk (OAuth/SSO with RBAC — Owner/Admin/Employee roles, 30+ permissions)
- **AI**: Anthropic Claude (claude-sonnet-4-20250514) for all AI features — inbox clarification, SOP surfacing, pattern recognition, Morning Whisper, staffing optimization
- **Real-time**: WebSocket server for live updates (shift changes, task assignments, notifications)
- **Integrations**: Shopify GraphQL Admin API (sales data sync, staffing recommendations), YouTube Data API v3 (private channel video management for Improvement Videos)
- **Video Storage**: YouTube private channel (primary) with AWS S3/CloudFront as fallback for video hosting
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
- Shopify sync lag: under 60 seconds from Shopify event to MAinager data update
- Video upload processing: under 30 seconds from capture to available in feed
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
- **Daily Ritual System** (Morning Huddle, Daily Debrief, Daily Improvement Quotes, Kudos, Midday Pulse)
- **Improvement Video Platform** (60-second video sharing with YouTube/S3 storage)
- **SOP Library & Execution** (Structured procedures, Decision Tree SOPs, Training Hub)
- **GTD Workflow Engine** (AI-powered inbox processor, weekly review ritual)
- **In-App Messaging** (Real-time threaded chats, direct messages, channels)
- **Anomaly Detection & Push Notifications** (Clock-in/payroll anomalies, Web Push notifications)
- **Timesheets & Pay Period Review** (Pay period table, Daily Review, Time Card Modal, AI OT Prevention, Off-Site Allowance)
- **Digital Cash Management System** (Opening/closing wizard, AI deposit verification, AI Cash Investigation)
- **Smart Task Suggestions (AI Review Assistant)** (Proactive daily task prioritization using employee context)
- **SOP Intelligence Layer** (AI-powered analysis of SOP execution data)
- **Lean Board** (Team-level improvement tracking board with daily snapshots and mini-charts)

### IN DEV — Being Built Now
- Shopify Deep Sync (real-time sales data streaming)
- SOP Evolution System (AI-powered revision proposals based on feedback)
- RAG Semantic Search (Vector-based SOP search using pgvector)

### PLANNED — On the Roadmap but Not Started
- Payroll Export (Gusto/ADP integration)
- Visual Dashboards (labor cost trends, punctuality, task completion)
- Offline Mode (local storage for time entries)
- Holiday Pay System (AI-powered multipliers for holiday pay)

## Improvement Preferences

### Auto-approve these types of changes:

- Database index additions (especially on `time_entries`, `sop_executions`, `next_actions`, `issues`, `notification_log`, `improvement_videos`, `video_comments`, `video_likes` — these tables will grow fast)
- Dead code removal (unused exports, unreachable paths, commented-out code blocks)
- Null check additions on external API responses (Shopify API, Clerk webhooks, Claude API responses, YouTube API responses)
- Performance optimizations (query consolidation, response caching, N+1 elimination)
- Error handling improvements (try/catch additions, transaction wrapping on multi-step DB operations)
- Input validation additions (Zod schemas on API route inputs)
- TypeScript type narrowing (replacing `any` types with proper interfaces)
- WebSocket reconnection logic improvements
- API response standardization (consistent error shapes, proper HTTP status codes)
- Logging improvements (adding structured logs for debugging, removing console.log in favor of proper logger)
- Memory leak prevention (clearing intervals, removing event listeners, connection pool management)
- Drizzle query optimization (using `.select()` to limit columns, adding `.limit()` and `.offset()` for pagination)
- Caching layer additions for expensive queries (daily sales totals, staffing recommendations, video feed aggregation)

### Always require my approval for:

- Authentication/authorization changes (Clerk config, RBAC permissions, middleware)
- Payment/checkout flow modifications (any future Stripe integration)
- Database schema changes (new tables, column additions/removals, type changes, migrations)
- New API endpoints (every new endpoint is a new attack surface)
- Changes to AI prompts or model configuration (Morning Whisper tone, Inbox Clarification logic, SOP surfacing rules, Weekly Review prompts, Daily Quote selection logic, Improvement Video AI summaries)
- Notification timing changes (quiet hours, alert schedules, escalation rules)
- Shopify OAuth flow modifications
- Clerk webhook handler changes
- YouTube API integration changes (channel config, privacy settings, upload permissions)
- Any change to how payroll calculations work (overtime rules, rounding, pay period boundaries)
- Any change to how geofencing distance is calculated (affects legal compliance for time tracking)
- Any change to how the AI Scheduler calculates shift overlap windows
- SOP content modifications (even typo fixes — the owner may have specific wording for legal/training reasons)
- Customer data handling changes (Style DNA privacy implications)
- RBAC role or permission modifications
- Environment variable additions or changes

### Focus areas this month:

- Harden Shopify Deep Sync — ensure real-time sales data streaming is bulletproof with retry logic, dead letter queues, and reconciliation checks
- Performance audit on all LIVE endpoints — identify any query that's > 200ms and optimize
- Error handling sweep across all API routes — ensure every route has try/catch, returns proper status codes, and logs structured errors
- WebSocket stability — ensure reconnection logic handles all edge cases (server restart, network change, mobile app backgrounding)
- Prepare database schemas for Q1 sprint features (SOP Library, Opening/Closing Checklists, Issue Tracker MVP, Improvement Video Platform) — review planned schemas in SPECIFICATION.md and flag any concerns about indexing, data types, or relationships

### Ignore for now:

- GTD Workflow Engine (Q2 2026 — Module 10)
- Style DNA / Customer Intelligence (Q2 2026 — Module 5)
- Lean Board Gamification features (Q3 2026 — leaderboards, badges, awards)
- Advanced Analytics (Q4 2026 — QBR, monthly scorecards)
- Multi-location support (Q4 2026)
- UI/CSS styling changes (unless they cause functional issues)
- Test coverage improvements (important but not urgent for agent focus)
- Documentation updates
- Dependency version bumps (unless security vulnerability)
- Payroll Export integrations (Q4 2026)

---

## Feature Specifications

### Pillar 1: Employee Experience Engine

Every feature maps to at least one Self-Determination Theory need (Autonomy, Competence, Relatedness). This is intentional and non-negotiable.

#### 1.1 The Vibe System (Replaces Traditional Gamification)

Rather than points and badges, MAinager uses a "Vibe" system designed around intrinsic motivation.

- **Personal Growth Dashboard** — Each employee sees: SOP mastery progression (competence), improvement ideas submitted (autonomy), peer kudos received (relatedness). NO comparison to others by default.
- **BYB Tracker (Better Your Best)** — Tommy Mello-inspired. Tracks personal bests: fastest opening checklist, most consistent task completion, longest improvement streak. Competes against YOUR history, never others.
- **Kudos Wall** — Peer-to-peer recognition. Any employee can give a "kudo" to any other with a short message. Kudos appear in the team feed and the Morning Huddle.
- **Improvement Streak** — Track consecutive days where the employee submitted at least one improvement idea. Visible only to them. No shaming for breaks — just a gentle restart.
- **Voluntary Challenges** — Weekly opt-in challenges (never mandatory). Example: "This week: find one way to save 2 seconds in your opening routine." Autonomy-first design.

**UX Principle: Never Mandatory Fun.** Every engagement feature must be opt-in. Employees choose their challenges, choose whether to share improvements, choose whether to appear on any team view. Forced participation destroys the autonomy that makes the system work.

#### 1.2 "Fix What Bugged You?" Daily Improvement Prompt

Paul Akers-inspired continuous improvement engine.

- **End-of-Shift Prompt** — "What bugged you today?" Free text + optional photo. AI categorizes and routes to the right person.
- **Daily Improvement Quote** — Each team member's dashboard displays an AI-curated daily quote about improvement and self-improvement. Claude selects quotes that are powerful, relevant, and rotating — never the same quote twice in a 90-day window. Quotes come from lean thinkers, business leaders, athletes, philosophers. Displayed prominently as a motivational anchor on the dashboard.
- **AI Categorization** — Submissions are auto-tagged by category (process, equipment, customer experience, workspace, training) and routed to the appropriate owner/manager.
- **Improvement Trend Analysis** — AI analyzes patterns: "70% of 'What Bugged You' submissions this month relate to the fitting room. Time for an SOP revision?"
- **SOP Evolution Loop** — Employee submissions + AI insights trigger SOP revision proposals for owner review. This is how SOPs stay alive.

#### 1.3 Improvement Video Platform (Paul Akers 2 Second Lean Style)

A YouTube-style internal platform for teams to create and share short improvement videos. This is the most visible, viral piece of the continuous improvement culture.
