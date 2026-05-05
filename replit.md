# Taime - AI Boutique Manager

## Overview
Taime is an AI-powered Progressive Web App (PWA) designed to function as an AI boutique manager. Its primary goal is to enhance operational efficiency, optimize labor costs, and provide actionable business insights by streamlining time tracking, scheduling, task management, and payroll processes through AI. Key capabilities include geofencing-enabled time clocking, automated task assignment, and comprehensive payroll management, all delivered via a mobile-first interface.

## User Preferences
Preferred communication style: Simple, everyday language.

## Vocabulary
Before naming a new feature, table, column, route, or UI string, consult [`CONTEXT.md`](./CONTEXT.md) at the repo root — it is the canonical glossary for Taime's domain language (Store, Location, User vs Employee, Shift vs Schedule, Permission vs Entitlement, etc.). Foundational decisions are recorded as ADRs in [`docs/adr/`](./docs/adr/).

## System Architecture

### Frontend
The frontend is a React and TypeScript PWA, built with Vite. It features a responsive, mobile-first design using Tailwind CSS and shadcn/ui components. State management is handled by TanStack React Query, and Wouter manages client-side routing.

### Backend
The backend is a Node.js Express.js server written in TypeScript. It uses Drizzle ORM for type-safe PostgreSQL interactions and Clerk for authentication and authorization. Real-time communication is powered by WebSockets. The architecture emphasizes modular routes, Zod for input validation, and security middleware.

### Core Features
- **AI Integration**: Leverages Anthropic Claude for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI ("Ask MAinager"), and AI-assisted SOP generation.
- **Authentication & Authorization**: Implemented with Clerk, supporting OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing with configurable grace periods, auto clock-out, live monitoring, and event logging.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability and pre-built templates, integrated with AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers and a configurable Holiday Pay Calendar.
- **AI Auto-Scheduling**: Generates optimized schedules using real Shopify GraphQL order data (auto-backfilled on demand for the prior-year equivalent date). Claude claude-opus-4-5 receives the hourly sales breakdown, shift blocks, and ranked team roster then produces per-employee shift assignments with rationale; falls back to algorithmic assignment if Claude is unavailable. Considers store hours, staffing tiers, employee availability, zone-split minimum staffing, and employee performance scores. Now includes an **AI Rules engine**: admins can assign scheduling classifications (Opener, Closer, Key Holder, Trainer, New Hire, plus custom skill tags) to each employee, configure structured coverage rules (opening/closing shift requirements, pairing rules, no-clopening), write free-text custom instructions, and define **Special Circumstances** (e.g. holiday rushes, local events, promotions) with enable/disable toggles — all injected into the Claude prompt as hard constraints. **Minimum staffing is now split by time zone**: Opening Zone (pre-hours), Peak Zone (during-hours), and Closing Zone (post-hours) each have independent minimums configurable by admins.
- **Shopify Day Backfill**: `POST /api/shopify/backfill-day` endpoint fetches orders for a specific calendar date via Shopify GraphQL, upserts individual rows into `shopify_orders` (with per-order timestamps for hourly revenue bucketing), and upserts the daily aggregate into `shopify_daily_sales`. The `/api/schedules/suggest` endpoint auto-triggers this backfill when the target historical date has no order data in the DB.
- **Availability & Scheduling Command Center**: A redesigned scheduling experience featuring a "Today's Intelligence" side panel (AvailabilityCommandPanel) that ranks employees by composite availability score (performance + availability overlap + hours remaining), shows a per-hour coverage timeline with gap detection, and supports quick-add shifts from the panel. "AI Auto-Schedule" button triggers a Suggested Schedule Review dialog (SuggestedScheduleReview) showing a historical Shopify sales sparkline alongside proposed shifts with rationale, approve/discard controls, and inline edit. Panel state persists in localStorage. New API endpoints: GET /api/schedules/today-availability, GET /api/schedules/historical-sales, POST /api/schedules/suggest.
- **Available Employee Pills in Create Shift Panel**: The CreateShiftSplitPanel now includes a "Who's Available Today" section below the day-view timeline on the left side. It fetches availability data from GET /api/schedules/today-availability for the selected date. Each employee is shown as a compact pill card (~180px wide) displaying their initials avatar, name, score badge (gold ≥85, silver ≥60, standard below), available time range, and a green availability bar. Clicking "Add shift" on a pill inserts a new shift block onto the timeline (clamped to store hours) and optionally populates the employee dropdown on the right if no employee is selected. Pills reactively show "Scheduled ✓" when the employee already has a block on the timeline (AI-suggested or actual). A "Show unavailable" toggle reveals employees without availability or with time off (shown with a lock icon and greyed style). Skeleton pills are shown while loading. Empty states are shown when no availability data exists or everyone is already scheduled. The pill list re-fetches automatically when the date changes.
- **SOP Library & Execution**: Structured operating procedures with templates, versioning, execution tracking, and mobile-optimized checklist runner. Includes Decision Tree SOPs, training mode, auto-activation for new hires, and a Training Hub.
- **Unified AI Learning Platform**: AI Content Studio and AI Learning Center merged into a single pipeline. Document uploads in AI Studio auto-generate a quiz question bank (10-20 questions per document). Powers "Brain Boost" daily quizzes on the associate dashboard with streak multipliers (2× at 7-day, 3× at 30-day streaks), Boss Battle mode (10-question challenge when all topics covered), seasonal monthly leaderboards, and scenario cards. Manager Learning Analytics tab inside AI Studio shows team participation, topic difficulty heatmap, and 30-day coverage gaps. Learning score is now a formal 20% pillar of the overall performance score. The standalone AI Learning Center navigation is retired; /ai-learning redirects to /ai-studio.
- **Daily Ritual System**: Includes Morning Huddle, Daily Debrief, Daily Improvement Quotes, Kudos, and Midday Pulse, with AI-generated content and trend analysis.
- **Offline Mode**: Utilizes a service worker with IndexedDB for offline data storage and background synchronization.
- **Role-Specific Dashboards**: Provides distinct dashboards for Associates, Managers, and Owners.
- **GTD Workflow Engine**: Comprehensive Getting Things Done system with an AI-powered inbox processor and AI-guided weekly review ritual.
- **In-App Messaging**: Real-time threaded messaging system with direct messages, group chats, and channels.
- **Performance Optimizations**: Includes request timing middleware, N+1 query fixes, strategic database indexes, and in-memory caching for frequently accessed data.
- **RAG Semantic Search**: Vector-based SOP search using pgvector and local embeddings.
- **Lean Board**: Team-level improvement tracking board with daily snapshots, trend charts, and weekly AI summaries.
- **SOP Evolution System**: AI-powered revision proposals for SOPs based on employee feedback and analytics, with review and approval workflows.
- **SOP Intelligence Layer**: AI-powered analysis of SOP execution data to generate insights for optimization.
- **Smart Task Suggestions (AI Review Assistant)**: Proactive AI-powered daily task prioritization based on employee context, integrated with the Ask MAinager copilot.
- **Anomaly Detection & Push Notifications**: Detects clock-in and payroll anomalies, sending push notifications to managers/owners for action.
- **Timesheets & Pay Period Review**: Comprehensive timesheet management with pay period review, daily review, time card detail modal (with inline editing, audit trail, GPS data), enhanced CSV export, bulk actions, and an AI Overtime Prevention Engine. Includes an Off-Site Allowance System.
- **Employee Gamification Score Panel**: Performance scoring system with an overall score (0-100) based on 5 pillars: attendance (25%), tasks (25%), SOPs (15%), engagement (15%), and learning (20%). Features a tier system, anonymous team leaderboard, achievement badges, and score history. Learning score is computed from quiz accuracy, participation rate, and streak bonuses.
- **Payroll Export**: Dedicated payroll export page with format presets (QuickBooks/Gusto/ADP), custom field selection, and hour format toggling.
- **Visual Dashboards**: Enhanced analytics dashboard for owners/admins with weekly comparisons, 30-day trends, punctuality metrics, task completion, AI anomaly detection, and Shopify integration.
- **Supply & Inventory Kanban System**: Two-bin Kanban-inspired supply management with visual stock levels, ordering links, and an inventory count process that auto-generates reorder tasks for low items. Includes a weekly AI rotation for assigning inventory counts.
- **AI Content Studio**: Manager-only hub for AI-powered content generation from uploaded documents, creating SOPs, Training Modules, Task Lists, and Knowledge Base Articles with a review, approve, and publish workflow.
- **Digital Cash Management System**: Replaces paper-based processes with a guided denomination wizard for opening/closing counts, AI deposit slip verification, over/short tracking, and an AI Cash Investigation Engine for discrepancy analysis. Access is restricted based on clock-in status and location. Now includes **Drawer Reconciliation**: after deposit slip analysis, `reconcileDrawer()` computes three pairwise deltas (Shopify vs Physical Count, Count vs Deposit Slip, Shopify vs Deposit Slip), writes results back to `cash_deposits` (shopify_expected_cash, physical_count_cash, shopify_vs_count_delta, count_vs_deposit_delta, reconciliation_status), logs discrepancy events to `cash_discrepancy_log` (with discrepancy_sources JSONB), sends push notifications and SendGrid email alerts to all store-scoped owner/admin users when any delta exceeds the `overShortThreshold`, shows a color-coded three-source panel in the deposit flow (green=match, amber=within tolerance, red=exceeds), shows Shopify-vs-Physical comparison even when no slip is uploaded, and displays an expandable reconciliation row in the Owner Review daily report. Standalone `POST /api/cash/deposits/:id/reconcile` endpoint available for manual re-runs. Migration: `0031_cash_reconciliation_fields.sql`.
- **Mobile-First Schedule Page (Task #584)**: The timeline view (`ScheduleTimelineView.tsx`) has been redesigned as a mobile-first experience with: (1) `usePinchZoom` hook — two-finger pinch scales the hour density (40–160 px/hr) reactively; (2) `useSwipeNav` hook — single-finger horizontal swipe navigates day/week with a CSS slide animation; (3) Mobile 3-day week window — on screens < 768 px the week view shows 3 columns with a 7-day pill strip for quick day jumping; (4) Current-time red indicator line in Day and Week views with an IntersectionObserver-based "Now" FAB that appears when the line scrolls out of view; (5) Touch-friendly 44 px drag handles on shift blocks (always visible on mobile, fade-in on desktop hover); (6) Toolbar overflow fix — action buttons (AI Auto-Schedule, Generate Week, Notify Team) show icon-only on mobile with min-44px tap targets. The CreateShiftSplitPanel "Who's Available" section is now wrapped in a collapsible accordion that defaults closed on mobile and open on desktop.

## External Dependencies

### Database & ORM
- **Neon Database** (PostgreSQL)
- **Drizzle ORM**
- **@neondatabase/serverless**

### Authentication
- **Clerk**

### AI Services
- **Anthropic Claude**
- **@xenova/transformers** (for local embeddings)

### UI & Styling
- **shadcn/ui**
- **Tailwind CSS**
- **Font Awesome**
- **Google Fonts**

### Real-time & Communication
- **WebSockets**
- **Web Push API**
- **Nylas** (for email invitations)

### Native App (Capacitor)
- **@capacitor/core** — runtime bridge between web and native
- **@capacitor/ios / @capacitor/android** — native platform projects
- **@capacitor/geolocation** — native GPS (replaces browser API on native)
- **@capacitor/haptics** — native haptic feedback (replaces navigator.vibrate)
- **@capacitor/camera** — native camera access; iOS falls back to file picker
- **@capacitor/push-notifications** — APNs (iOS) / FCM (Android) native push
- **@capacitor/status-bar** — status bar color/style control
- **@capacitor/splash-screen** — branded launch screen
- App ID: `com.taime.app` | App Name: `Taime`
- Config: `capacitor.config.ts` at project root; `webDir = dist/public`
- Native projects generated with: `scripts/capacitor-setup.sh` (run on macOS)
- Platform class added to `<html>` element (`capacitor-ios` / `capacitor-android`)
- Safe-area insets: `viewport-fit=cover` + `.safe-area-bottom` / `.safe-area-top` CSS classes
- Native push tokens stored in-memory via `POST /api/push/native-token` (APNs/FCM server integration is a follow-up)
- Run after each web build: `npx cap sync`
- App icons are generated from `resources/icon.png` using `@capacitor/assets`. Run `npm run generate:icons` whenever `resources/icon.png` changes to regenerate icons in `client/public/assets/icons/`.

### Utility Libraries
- **date-fns**
- **Zod**
- **clsx, tailwind-merge**

## Developer Setup

### Git Hooks
A pre-commit hook validates that every `.sql` file in `migrations/` is recorded in `migrations/meta/_journal.json` and vice versa. This prevents commits that would leave the migration journal out of sync.

After cloning the repository, install the hooks by running:

```bash
bash scripts/install-hooks.sh
```

This symlinks `scripts/hooks/pre-commit` into `.git/hooks/` and makes it executable. The hook runs `scripts/validate-migrations.ts` before every commit and blocks the commit with a clear error message if any mismatch is found.