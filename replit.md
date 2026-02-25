# Taime Clock - AI-Powered Workforce Management

## Overview
Taime Clock is an AI-powered Progressive Web App (PWA) designed to enhance workforce management. It integrates AI to streamline time tracking, scheduling, task management, and payroll, offering features like geofencing-enabled time clocking and automated task assignment. The platform aims to boost operational efficiency, optimize labor costs, and provide actionable business insights through comprehensive payroll management, intelligent scheduling, and robust employee performance tracking, all delivered via a mobile-first, user-friendly interface.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React and TypeScript PWA, built with Vite. It features a responsive, mobile-first design using Tailwind CSS and shadcn/ui components. State management is handled by TanStack React Query, and Wouter manages client-side routing.

### Backend
The backend is a Node.js Express.js server written in TypeScript. It uses Drizzle ORM for type-safe PostgreSQL interactions and Clerk for authentication and authorization. Real-time communication is powered by WebSockets. The architecture emphasizes modular routes, Zod for input validation, and security middleware. Environment variables are centrally managed and validated using Zod.

### Core Features
- **AI Integration**: Utilizes Anthropic Claude AI for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI, and AI-assisted SOP generation.
- **Authentication & Authorization**: Implemented with Clerk for OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing with circular and polygon boundaries, configurable grace periods, auto clock-out, live monitoring, and event logging.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability statuses and pre-built templates, integrated into AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers, integrated with a configurable Holiday Pay Calendar.
- **Performance Scoring**: Tracks and scores employee metrics to provide performance insights.
- **AI Success Assistant**: An AI-powered employee coach with a knowledge base, Claude-powered chat, commute intelligence, pre-shift briefings, and onboarding paths.
- **Shopify Integration**: OAuth-based integration to sync sales data for AI-driven staffing recommendations and sales comparisons.
- **AI Auto-Scheduling**: Generates optimized schedules using historical Shopify sales data, considering store hours, staffing tiers, employee availability, and minimum staffing thresholds.
- **Team Invitation Emails**: Automated Nylas-powered email invitations for new team members.
- **Employee Profile Pages**: Comprehensive profiles with job details, personal information, documents, and performance metrics.
- **Visual Analytics Dashboard**: Recharts-based visualizations for labor costs, punctuality, task completion, and AI anomaly detection.
- **Payroll Export**: Generates detailed CSV exports of payroll information.
- **In-App Messaging**: Real-time team chat, direct messages, announcements, and a shoutout system via WebSockets.
- **Push Notifications**: Web Push API for critical alerts and schedule updates.
- **SOP Library**: Structured operating procedures with templates, versioning, execution tracking, and step-level completions with evidence and manager sign-off.
- **SOP Execution UI**: Full-screen mobile-optimized checklist runner with progress tracking, step-specific actions, skip flows, training mode, and manager sign-off.
- **Context-Aware SOP Surfacing** (`server/services/sopSurfacing.ts`): Automatically surfaces the right SOP for the right person at the right time. Five trigger types: (1) Time-based — opening/closing checklists surfaced near store open/close hours via 5-minute cron. (2) Event-based — opening SOPs for first clock-in of the day, shift handoff SOPs when overlapping shifts detected. (3) Role-based — recommends training mode for employees who completed an SOP fewer than 3 times. (4) Issue-based — matches issue categories/keywords to SOP categories when issues are created. (5) API-driven — `GET /api/sops/surfaced` returns currently relevant SOPs for the authenticated user. Store hours sourced from `ai_scheduling_settings.store_hours` JSONB. Frontend: `SurfacedSOPBanner` component on Dashboard/AdminDashboard with trigger-specific colors, dismissible cards, WebSocket-reactive (`sop_surfaced` events), 5-min polling fallback.
- **Issue Tracker**: Full-featured system for employees to log problems and managers to track/resolve them, with categories, priorities, statuses, and comments.
- **Daily Ritual System**: Includes Morning Huddle, Daily Debrief, Daily Improvement Quotes, Kudos, and Midday Pulse, with AI-generated content and trend analysis.
- **Midday Pulse** (`server/services/middayPulse.ts`): Automated noon sales check-in using Shopify data. Compares today's sales to same day last week, calculates pace-to-target. Claude AI generates encouraging headline, detail, and optional suggestion. Cached per store per day in `midday_pulses` table. Cron fires at noon, broadcasts via WebSocket (`midday_pulse` event). Frontend: `MiddayPulseCard` on Dashboard/AdminDashboard with revenue/transactions/avg order metrics, pace indicator, stale-data warning, and suggestion callout. Toast notification on WebSocket push.
- **Shift Handoff Protocol SOP**: Auto-seeded SOP template (`server/services/shiftHandoffSeed.ts`) with 7 steps: Review open issues, Handoff notes, Check task board, 3S: Sweep, 3S: Sort, 3S: Standardize, Ready to go. Created for each active store on startup if no `shift_handoff` SOP exists. Uses existing SOP infrastructure for execution tracking and training mode.
- **Improvement Video Platform**: Paul Akers-inspired 60-second improvement video sharing system. Schema: `improvement_videos` (YouTube/S3 storage, categories, featured picks, view counts), `video_likes` (unique per user per video), `video_comments`. All tables indexed for store-scoped queries. Frontend: `ImprovementFeed` page at `/improvements` with YouTube-style grid, featured banner, category/sort filters, VideoRecordDialog (camera recording via MediaRecorder API with 60s limit + file upload fallback), VideoPlayerModal (HTML5 video + like/comment), ImprovementFeedWidget on Dashboard (3 recent thumbnails + nudge). Static file serving for local uploads at `/uploads`.
- **Offline Mode**: Service worker with IndexedDB for offline data storage and background synchronization.
- **ELON Authenticated Crawling**: Manual popup login flow for authenticated page crawling by ELON's Playwright crawler, with server-side session token storage.
- **ELON Code Engine Enhancements**: Features include multi-file awareness, fuzzy matching, syntax verification with auto-rollback, runtime validation, and multi-file atomic changes for robust autonomous code modifications.
- **Shift Overlap & Handoff**: AI scheduling generates overlapping shifts (configurable 30/45/60 min) for briefing and 3S time. Budget warnings alert when overlap labor cost exceeds weekly limit. SOP surfacing shows personalized handoff messages with employee names.
- **Role-Specific Dashboards** (`client/src/features/dashboard/`): `DashboardRouter` checks `user.role.name` and renders the appropriate dashboard. Three distinct views: (1) **AssociateDashboard** (employee role) — warm greeting, daily quote, surfaced SOPs, my tasks today with checkboxes, active SOP with continue button, quick actions (Report Issue, Record Improvement, Give a Kudo), improvement feed, personal stats. (2) **ManagerDashboard** (admin role) — metrics cards (clocked in, team size, shifts, tasks done), morning huddle status, team on shift, open issues by priority, SOP completion progress bar, tasks overview (overdue/due today/upcoming), kudos, midday pulse, improvements. (3) **OwnerDashboard** (owner role) — executive header, morning whisper preview (analytics), sales snapshot (Shopify), team health, operational scorecard (SOP completion %, avg issue resolution, task completion %, weekly videos), flagged items (urgent issues + overdue tasks), quick links. Each section wrapped in `DashboardErrorBoundary` for fault isolation.

- **GTD Workflow Engine**: David Allen-inspired Getting Things Done system with 6 tables: `gtd_inbox_items` (universal capture from manual/voice/debrief/issue/SOP/huddle/quick sources, AI clarification JSONB, processing status tracking), `gtd_projects` (multi-action outcomes with desired outcome and status lifecycle), `gtd_next_actions` (context-tagged actions with energy level, time estimates, 2-minute flags, priority, and project linking), `gtd_waiting_for` (delegation tracking with follow-up dates and employee linking), `gtd_someday_maybe` (parked ideas with categories, activatable into projects/actions), `gtd_reference` (searchable reference material with JSONB tags). All tables store-scoped via `work_locations(id)`, user-scoped via Clerk IDs. 12 composite indexes including partial indexes on active/waiting status for query performance.
- **GTD AI Clarification Engine** (`server/services/gtdClarificationAI.ts`): Claude-powered inbox processor that classifies raw captures into GTD destinations (next_action, project, waiting_for, someday_maybe, reference, trash, calendar, issue). 3-second timeout, fire-and-forget async processing. Returns suggested title, context, energy level, time estimate, priority, two-minute flag, and related SOP hints. Auto-triggers on inbox creation. WebSocket event `inbox_item_clarified` sent on completion. Three auto-capture integrations: (1) Daily Debrief `whatBuggedYou` → source `debrief`, (2) Issue creation → source `issue_auto`, (3) SOP execution feedback notes → source `sop_feedback`. GTD routes at `/api/gtd/inbox` with CRUD + reclarify endpoint.

## Performance Optimizations
- **Request Timing**: `requestLogger` middleware tracks response times, warns on slow endpoints (>200ms standard, >5000ms AI). Logged as `SLOW ENDPOINT` with threshold context.
- **Batch Operations**: `createSchedulesBatch()` in storage replaces N+1 schedule creation loops in schedules.ts and aiScheduling.ts.
- **Query Optimization**: Dashboard queries use column selection instead of `SELECT *`. AI task assignment uses batch `inArray` user lookup instead of per-user queries. Analytics uses `Promise.all` for parallel data fetching.
- **Database Indexes**: Added indexes on `time_entries(user_id, clock_in_time)`, `time_entries(clock_in_time)`, `time_entries(user_id) WHERE clock_out_time IS NULL`, `time_entries(location_id)`, `users(is_active)`, `shoutouts(recipient_id, created_at)`.
- **In-Memory Cache**: `MemoryCache` utility (`server/lib/cache.ts`) with TTL-based expiry. Applied to: company settings, dashboard user list (60s), analytics user data (120s), roles, permissions, role-permission maps.

## External Dependencies

### Core Framework & Language
- **React Ecosystem**
- **TypeScript**
- **Vite, esbuild**

### Database & ORM
- **Neon Database** (PostgreSQL)
- **Drizzle ORM**
- **@neondatabase/serverless**

### Authentication
- **Clerk**

### AI Services
- **Anthropic Claude**

### ELON Deep Testing & Autonomous Improvement (Sneebly)
- **Integration Health Monitor**
- **Scenario Test Runner** (Playwright)
- **Regression Tracker**
- **Dependency Index**
- **ELON Cycle Integration**

### UI & Styling
- **shadcn/ui**
- **Tailwind CSS**
- **Font Awesome**
- **Google Fonts**

### Real-time & Communication
- **WebSockets**
- **Web Push API**

### Utility Libraries
- **date-fns**
- **Zod**
- **clsx, tailwind-merge**
- **memoizee**