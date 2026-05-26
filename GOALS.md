# Taime

## Mission

Taime is an AI-powered boutique retail operations platform that replaces paper-based and manual processes with a unified mobile-first PWA. It handles time clocking with GPS geofencing, AI-generated shift scheduling, task management, SOP execution, payroll review, and real-time business dashboards — all in one app. The target user is a small retail boutique with a mix of associate, manager, and owner roles, each seeing a tailored experience. The backend is Node/Express/TypeScript with Drizzle ORM on Neon PostgreSQL; the frontend is React/Vite with Tailwind CSS, shadcn/ui, and Clerk for authentication.

## Roadmap

Core operations ship first (Phase 1), then the AI intelligence layer (Phase 2), then advanced engagement and reporting features (Phase 3).

### Phase 1: Core Operations

- [x] Authentication and RBAC — Clerk OAuth, role-based access (Associate/Manager/Owner/Admin), permission overrides per user
- [x] Employee profiles — HR metadata, documents, availability, pay rates, location assignment
- [x] Time clocking with geofencing — GPS radius/polygon enforcement, grace periods, auto clock-out, stale-location checker
- [x] Schedule management — weekly timeline UI, drag-and-drop shift creation, conflict detection, published vs draft states
- [x] Task management — recurring and one-off tasks, AI-assisted assignment, priority, due dates, completion tracking
- [x] SOP library and execution — template builder, versioning, mobile checklist runner, completion tracking
- [x] Timesheets and pay period review — per-employee hour summaries, edit history, overtime flagging, off-site allowance
- [ ] Payroll export — format presets and custom field selection UI complete; CSV file generation logic stubbed (partial: actual CSV byte stream not produced)
- [x] Push notifications — Web Push (VAPID) and Capacitor native token registration, anomaly and shift alerts
- [x] Offline mode — service worker + IndexedDB caching, background sync on reconnect

### Phase 2: AI Intelligence Layer

- [x] AI auto-scheduling — Claude-powered schedule generation using Shopify sales history, staffing tiers, availability, and zone minimums
- [x] AI task assignment — proactive daily task prioritization surfaced per employee based on context and performance
- [x] AI Morning Briefing — daily AI-generated store briefing for managers on the AdminOwner dashboard
- [x] Ask MAinager (conversational AI) — in-app chat with Claude for operational questions and decision support
- [x] AI Content Studio — manager-facing hub for generating training content from uploaded documents
- [x] AI Learning Center — quiz generation from uploaded docs, daily quizzes, manager analytics
- [x] Holiday pay system — natural-language rule parser for automatic pay multipliers, holiday calendar UI
- [x] Anomaly detection — payroll and clock-in anomaly detection with push notification delivery
- [x] Overtime Prevention Engine — real-time projected overtime warnings per employee in timesheet view
- [x] SOP Evolution System — AI revision proposals for SOPs based on employee feedback and execution analytics
- [x] AI Cash Investigation Engine — AI-assisted drawer reconciliation discrepancy analysis

### Phase 3: Advanced Features and Reporting

- [x] Shopify sales integration — order webhook ingestion, 30-min reconciliation cron, historical backfill, refund/void handling
- [x] Digital cash management — denomination wizard, deposit slip capture, AI verification, advanced drawer reconciliation
- [x] Supply and inventory Kanban — two-bin visual stock levels, reorder threshold alerts, auto-generated reorder tasks
- [x] Gamification and leaderboards — composite performance score (attendance, tasks, SOPs, learning, engagement), tiers, per-employee score panel
- [x] Daily ritual system — Morning Huddle, Daily Debrief, and Kudos with AI-generated content
- [x] Lean board — team improvement tracking, daily snapshots, weekly AI summaries
- [x] Analytics dashboards — weekly sales vs goal comparison, labor cost breakdown, AI anomaly overlays, Owner/Admin real-time panel
- [x] RAG semantic search — pgvector-backed SOP and knowledge-doc search with local Xenova embeddings
- [x] GTD inbox system — personal inbox, projects, and weekly review for managers
- [x] Role-specific dashboards — tailored home screens for Associates, Managers, and Owners/Admins with collapsible panels (localStorage persistence)
- [ ] Employee profile self-service delete — delete-account confirmation flow UI present but confirmation/backend teardown not wired (partial: missing final confirmation step and cascading cleanup)
