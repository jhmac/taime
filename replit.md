# Taime - AI Boutique Manager

## Overview
Taime is an AI-powered Progressive Web App (PWA) designed as an AI boutique manager. Its core purpose is to streamline time tracking, scheduling, task management, and payroll processes using AI. Key capabilities include geofencing-enabled time clocking, automated task assignment, and comprehensive payroll management, all delivered through a mobile-first, user-friendly interface. The project aims to boost operational efficiency, optimize labor costs, and provide actionable business insights.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React and TypeScript PWA, built with Vite. It features a responsive, mobile-first design using Tailwind CSS and shadcn/ui components. State management is handled by TanStack React Query, and Wouter manages client-side routing.

### Backend
The backend is a Node.js Express.js server written in TypeScript. It uses Drizzle ORM for type-safe PostgreSQL interactions and Clerk for authentication and authorization. Real-time communication is powered by WebSockets. The architecture emphasizes modular routes, Zod for input validation, and security middleware.

### Core Features
- **AI Integration**: Leverages Anthropic Claude for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI, and AI-assisted SOP generation. This includes an "Ask MAinager" conversational AI copilot with multi-layer context and actionable suggestions.
- **Authentication & Authorization**: Implemented with Clerk, supporting OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing capabilities including circular and polygon boundaries, configurable grace periods, auto clock-out, live monitoring, and event logging.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability and pre-built templates, integrated with AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers, integrated with a configurable Holiday Pay Calendar.
- **AI Auto-Scheduling**: Generates optimized schedules using historical sales data (from Shopify), considering store hours, staffing tiers, employee availability, minimum staffing thresholds, and **employee performance scores** (90-day lookback from `clock_events` — attendance, task completion, reliability points used as a tiebreaker when multiple employees are available). Includes shift overlap for briefing and cleaning.
- **SOP Library & Execution**: Structured operating procedures with templates, versioning, execution tracking, and mobile-optimized checklist runner. Features **Decision Tree SOPs** with branching logic and flow visualization. Includes a training mode with multimedia content, auto-activation for new hires, and a Training Hub.
- **AI Learning Center Phase 3**: Interactive training module player at `/training/:moduleId` (TrainingPlayer.tsx) with concept cards, script practice, scenario questions, and quiz knowledge checks (70% pass threshold). Employee training dashboard at `/training` (TrainingHub.tsx) with streak badge, practice queue, and module progress. Morning Huddle Learning Moment slide in `/huddle` powered by Claude with daily AI-generated tip + quiz (+10pts on correct answer). Manager Training Matrix tab in AI Learning Center (`/learning-center`) with team matrix table, flag management, and CSV export. Gamification: module complete (50pts), quiz pass (25pts), morning moment (10pts), daily practice (15pts), 7-day streak (100pts). Spaced repetition for practice: intervals double on correct (1→3→7→14 days), reset to 1 on incorrect. DB tables: `training_lessons`, `training_questions`, `training_practice_schedule`, `training_lesson_progress`, `morning_learning_moments`, `morning_moment_answers`, `training_flags`. Key files: `server/routes/trainingPlayer.ts`, `server/routes/morningMoment.ts`, `client/src/pages/TrainingPlayer.tsx`, `client/src/pages/TrainingHub.tsx`, `client/src/pages/AILearningCenter.tsx`, `client/src/pages/MorningHuddle.tsx`.
- **Issue Tracker**: System for employees to log problems and managers to track and resolve them.
- **Daily Ritual System**: Includes Morning Huddle, Daily Debrief, Daily Improvement Quotes, Kudos, and Midday Pulse, with AI-generated content and trend analysis.
- **Improvement Video Platform**: System for sharing 60-second improvement videos with YouTube/S3 storage.
- **Offline Mode**: Utilizes a service worker with IndexedDB for offline data storage and background synchronization.
- **Role-Specific Dashboards**: Provides distinct dashboards for Associates, Managers, and Owners.
- **GTD Workflow Engine**: Comprehensive Getting Things Done system with an AI-powered inbox processor for classifying raw captures and an AI-guided weekly review ritual.
- **In-App Messaging**: Real-time threaded messaging system with direct messages, group chats, and channels, featuring optimistic sending, typing indicators, and read receipts.
- **Performance Optimizations**: Request timing middleware with >200ms slow endpoint warnings (`server/index.ts`), N+1 query fixes (GTD projects uses single GROUP BY), strategic database indexes on SOP tables/issues/weekly_reviews, and in-memory cache (`server/lib/cache.ts`) applied to dashboard summaries, analytics, roles, and background insights with TTL-based expiration and prefix invalidation. Centralized store ID resolution via `server/lib/storeResolver.ts` with 60s cache — all routes use `resolveStoreId()` instead of non-existent `user.storeId`.
- **RAG Semantic Search**: Vector-based SOP search using pgvector and local embeddings for efficient content retrieval.
- **Lean Board**: Team-level improvement tracking board displaying daily snapshots of metrics, trend mini-charts, and weekly AI summaries, focusing on aggregate team performance.
- **SOP Evolution System**: AI-powered revision proposals for SOPs based on employee feedback and analytics, with a review and approval workflow.
- **SOP Intelligence Layer**: AI-powered analysis of SOP execution data (completion rates, timings, skip rates) to generate actionable insights regarding friction points, training gaps, and optimization opportunities.
- **Smart Task Suggestions (AI Review Assistant)**: Proactive AI-powered daily task prioritization answering "What should I be doing right now?" using employee context (tasks, SOPs, GTD actions, issues, schedule, surfaced SOPs). 5s Claude timeout with deterministic fallback, 15-min per-employee cache, integrated with Ask MAinager copilot for consistency.
- **Anomaly Detection & Push Notifications**: Clock-in anomaly detection (chronic lateness, geofence violations, phone usage patterns) and payroll anomaly detection (missing clock-outs, duplicate entries, excessive/short shifts, overtime alerts) in `server/services/backgroundInsights.ts`. All queries scoped by storeId. Push notifications via Web Push API with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` Replit secrets). VAPID public key served via `/api/push/vapid-key` endpoint (no hardcoded keys in client). `NotificationService.sendAnomalyAlert()` sends push to managers/owners for action-needed anomalies. BackgroundInsightsCard has All/Anomalies/Insights tabs with type-specific badges and icons. Service worker v2.3.0 handles anomaly_alert notification clicks.
- **Timesheets & Pay Period Review**: Best-in-class timesheet management page at `/timesheets` with: Pay Period Review table (expandable employee rows with day-by-day breakdown), Daily Review tab, Time Card Detail Modal (inline editing, audit trail, GPS data, off-site sessions, approve/lock), enhanced CSV export with customizable fields and format presets (QuickBooks/Gusto/ADP), Add Time Card form, bulk approve/lock-period actions. Features AI Overtime Prevention Engine (`server/services/overtimePreventionService.ts`) that detects OT risk, finds alternative workers, generates Claude AI swap suggestions with one-click apply. Off-Site Allowance System with configurable rules per location (allowed minutes, time windows, alert recipients), off-site session tracking integrated into timesheets, and live monitoring. Audit trail via `time_entry_edits` table logs all field changes. DB tables: `time_entry_edits`, `offsite_allowance_rules`, `offsite_sessions`, `overtime_alerts`. Key files: `server/routes/timesheets.ts`, `server/routes/offsiteRules.ts`, `client/src/pages/Timesheets.tsx`, `client/src/components/TimeCardModal.tsx`, `client/src/components/timesheets/ExportOptionsModal.tsx`, `client/src/components/timesheets/OvertimePreventionPanel.tsx`, `client/src/components/settings/OffsiteAllowanceSection.tsx`. Cache invalidation uses `invalidatePrefix()` for query-param-based keys.
- **Employee Gamification Score Panel**: Performance scoring system at `/my-score` with 0-100 overall score computed from attendance (30%), tasks (30%), SOPs (20%), and engagement (20%). Features tier system (Bronze/Silver/Gold/Platinum/Diamond), anonymous team leaderboard, 12 achievement badges (Perfect Week, SOP Master, Team Player, Iron Streak, etc.), score history with selectable time ranges (7d/30d/90d/all), dashboard widget on AssociateDashboard, admin team scores view and admin settings panel (configurable tier thresholds and prize descriptions) in Analytics. Push notifications for tier changes, achievement unlocks, top-3 rank, and weekly Monday summary with per-user opt-in toggle. Nightly cron at 2am for score snapshots. Live rank computation fallback when no snapshots exist. DB tables: `score_history`, `gamification_settings`, `user_achievements`. Key files: `server/services/gamificationService.ts`, `server/routes/gamification.ts`, `server/services/gamificationCron.ts`, `client/src/pages/MyScore.tsx`, `client/src/features/dashboard/ScoreWidget.tsx`.
- **Payroll Export**: Dedicated payroll export page at `/payroll-export` with QuickBooks/Gusto/ADP format presets, custom field selection, hour format toggle (decimal/clock), and CSV download via fetch+blob. Protected by `hr.payroll_view` permission. Uses existing `/api/timesheets/export` backend.
- **Visual Dashboards**: Enhanced analytics dashboard at `/analytics` restricted to owners/admins (`admin.manage_all`). Features: weekly comparison cards (this week vs last week for hours, labor cost, tasks, punctuality), 30-day labor cost and hours bar charts, punctuality donut, task completion progress, employee punctuality breakdown table, AI anomaly detection, and Shopify analytics integration.
- **Supply & Inventory Kanban System** (Paul Akers 2 Second Lean): Two-bin Kanban-inspired supply management at `/supply`. Supply items displayed as Kanban cards organized by category (Bags, Cleaning, Paper/Office, Packaging, Other). Each card shows: item name, visual stock fill bar (green=stocked / yellow=below par / red=below safety stock), supplier, and clickable Order Now link. Admin features: add/edit/archive supply items (name, category, unit, par level, safety stock, supplier, order URL, local pickup flag, notes). **Inventory Count**: Admin assigns a count task to a team member; team member goes through mobile-first one-item-at-a-time counting flow at `/supply/count/:sessionId`. On submit, app compares counts to par levels and auto-generates reorder tasks for low items (with order links and supplier info embedded). **Weekly AI Rotation**: Admin sets a day/time for weekly inventory count — creates a recurring task that the AI auto-assign picks up and assigns to a scheduled team member. Reorder tasks appear in TaskManagement with 🔴/🟡 urgency indicators. Navigation: DesktopSidebar (Management > Supply) and MoreMenu (Management > Supply Kanban). DB tables: `supply_items`, `inventory_count_sessions`, `inventory_count_entries`. Key files: `server/routes/supply.ts`, `client/src/pages/SupplyCatalog.tsx`, `client/src/pages/InventoryCount.tsx`.

- **AI Content Studio**: Manager-only hub at `/ai-studio` for AI-powered content generation. Managers upload source documents (PDF, DOCX, TXT, JPG, PNG, up to 50MB); Claude automatically extracts text and generates SOPs, Training Modules, Task Lists, and Knowledge Base Articles. Content goes through a Review → Approve → Publish workflow with inline editing (InlineTextField with save/✓ indicator) and per-section Claude refinement (SectionRefineBox). Published SOPs go to `sop_documents`, training modules to `training_modules`, tasks to `tasks`, KB articles to `sop_documents` in a "Knowledge Base" category. Navigation: DesktopSidebar (AI Studio, manager+ only) and SOPManagement settings button. DB tables: `knowledge_documents`, `generation_jobs`, `ai_generated_items`, `company_ai_context`. Key files: `server/routes/aiStudio.ts`, `server/services/aiStudioGeneration.ts`, `server/services/knowledgeExtractor.ts`, `client/src/pages/AIContentStudio.tsx`.

- **Digital Cash Management System**: Replaces paper-based drawer opening/closing with a guided step-by-step denomination wizard. Features include per-register opening/closing counts, AI deposit slip verification (Claude Vision), denomination-by-denomination guided counting (coins → rolled coins → bills), running totals, recount flow with AI suggestions, register summary data entry (Shopify integration), over/short tracking with explanations, employee on-duty snapshots via time_entries, and an **AI Cash Investigation Engine** that analyzes 90 days of discrepancy data to detect employee patterns, register patterns, day/time patterns, amount patterns, and provides risk scores with recommendations. Includes owner review dashboard with daily reports, 30-day trend charts, and investigation tab. CashStatusCard on Manager/Owner dashboards. Navigation via MoreMenu (mobile) and DesktopSidebar. DB tables: drawer_sessions, cash_deposits, cash_management_settings, cash_discrepancy_log. **Access Control**: Employees must be clocked in AND at the store location (verified via active time_entry + locationId matching storeId) to access Cash Management — both frontend gate and backend enforcement on all endpoints. Managers/owners bypass for review access. Frontend shows distinct messages for "not clocked in" vs "clocked in but not at store".

## External Dependencies

### Database & ORM
- **Neon Database** (PostgreSQL)
- **Drizzle ORM**
- **@neondatabase/serverless**

### Authentication
- **Clerk**

### AI Services
- **Anthropic Claude**

### UI & Styling
- **shadcn/ui**
- **Tailwind CSS**
- **Font Awesome**
- **Google Fonts**

### Real-time & Communication
- **WebSockets**
- **Web Push API**
- **Nylas** (for email invitations)

### Utility Libraries
- **date-fns**
- **Zod**
- **clsx, tailwind-merge**
- **@xenova/transformers** (for local embeddings)