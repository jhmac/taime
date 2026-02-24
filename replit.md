# Taime Clock - AI-Powered Workforce Management

## Overview
Taime Clock is an AI-powered Progressive Web App (PWA) designed to revolutionize workforce management. It integrates AI to streamline time tracking, scheduling, task management, and payroll, offering features like geofencing-enabled time clocking, automated task assignment via Claude AI, and real-time communication. The platform aims to boost operational efficiency, optimize labor costs, and provide actionable business insights. Its key capabilities include comprehensive payroll management, intelligent scheduling, and robust employee performance tracking, all accessible through a mobile-first, user-friendly interface.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React and TypeScript PWA, built with Vite. It features a responsive, mobile-first design leveraging Tailwind CSS and shadcn/ui components (based on Radix UI). State management is handled by TanStack React Query for server state and caching, while Wouter manages client-side routing.

### Backend
The backend is a Node.js Express.js server written in TypeScript. It uses Drizzle ORM for type-safe PostgreSQL interactions and Clerk for authentication and authorization, integrated with Express sessions. Real-time communication is powered by WebSockets. The architecture emphasizes modular routes, Zod for robust input validation, and security middleware (Helmet, express-rate-limit).

### Centralized Config
All environment variables are managed through `server/lib/config.ts`. This module uses Zod to validate env vars at startup (fail-fast on missing required vars like DATABASE_URL), groups config by domain (server, database, clerk, shopify, anthropic, nylas, vapid, encryption, youtube, aws), and exports a fully typed `config` object. No server code should use `process.env` directly — always import from `server/lib/config`.

### Core Features
- **AI Integration**: Utilizes Anthropic Claude AI for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI, and AI-assisted SOP generation (`server/services/sopAI.ts`).
- **Authentication & Authorization**: Implemented with Clerk for OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing with circular and polygon boundaries, Haversine distance, and ray-casting. Includes an interactive Leaflet map for boundary drawing, configurable grace periods (per-location with company settings fallback), auto clock-out, live monitoring, and event logging. Tracks all entry/exit/location-lost events in `geofence_events` table. Detects location permission revocation on device and triggers auto clock-out. Server-side stale location checker runs every 60s to auto-clock-out users whose app stops reporting (5-minute threshold). Grace period: uses work location `geofenceGraceMinutes` if > 0, otherwise falls back to company setting `autoClockOutAfterMinutes`.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability statuses (REQUIRED, available, preferred_off, HARD_OFF) and pre-built templates, integrated into AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers, integrated with a configurable Holiday Pay Calendar.
- **Performance Scoring**: Tracks and scores employee clock events and other metrics to provide performance insights.
- **AI Success Assistant**: An AI-powered employee coach with a knowledge base, Claude-powered chat (RAG-style), commute intelligence, pre-shift briefings, onboarding paths, and a floating assistant UI.
- **Shopify Integration**: OAuth-based integration to sync sales data for AI-driven staffing recommendations and year-over-year sales comparisons.
- **AI Auto-Scheduling**: Generates optimized schedules using historical Shopify sales data, considering store hours, staffing tiers, employee availability, and minimum staffing thresholds.
- **Team Invitation Emails**: Automated Nylas-powered email invitations for new team members with resend capabilities.
- **Employee Profile Pages**: Comprehensive Homebase-style employee profiles with tabs for Job Details, Personal Information, Documents (with uploads), and Performance metrics, including attendance, task completion, and manager notes.
- **Visual Analytics Dashboard**: Recharts-based visualizations for labor costs, punctuality, task completion, and AI anomaly detection, optionally integrated with Shopify revenue data.
- **Payroll Export**: Generates detailed CSV exports of payroll information per employee.
- **In-App Messaging**: Real-time team chat, direct messages, announcements, and a shoutout/recognition system via WebSockets.
- **Push Notifications**: Web Push API for critical alerts and schedule updates.
- **SOP Library**: Structured operating procedures with templates (versioned, per-location, role-assignable), ordered steps (action/verification/photo/decision/timer types), execution tracking, and step-level completions with checkpoints, photo evidence, manager sign-off, and skip reasons. Tables: `sop_templates`, `sop_steps`, `sop_executions`, `sop_step_completions`. Note: `store_id` references `work_locations(id)` since that represents physical store locations. Activity logs are created on execution completion/abandonment. API routes in `server/routes/sops.ts` (11 endpoints): CRUD templates with versioning, start/update/list executions, GET single execution with steps+completions, complete/skip steps with auto-completion detection, manager sign-off on checkpoints. WebSocket events: `execution_started`, `step_completed`, `execution_completed`, `sign_off_requested`, `sign_off_completed`. All writes wrapped in Drizzle transactions.
- **SOP Execution UI**: Full-screen mobile-optimized checklist runner at `/sops/execute/:executionId`. Wizard-style one-step-at-a-time view with progress bar, elapsed timer, step dots. Per-step-type actions: Mark Complete (action), Confirm Done (verification), camera capture with client-side compression to <1MB (photo), decision option buttons (decision), countdown timer with auto-complete (timer). Skip flow with required reason. Training mode toggle shows step training detail in callout. Checkpoint steps show "Waiting for manager approval" state with real-time WebSocket updates. Completion celebration screen with stats and optional feedback prompt. Manager sign-off via `SOPSignOffDialog` component. State persisted to localStorage as offline backup. Pages: `SOPExecution.tsx`, `SOPSignOffDialog.tsx`.
- **Issue Tracker**: MVP for employees to log problems and managers to track/resolve them. Tables: `issues` (store-scoped, with category/priority/status enums, optional SOP linkage, photo evidence, resolution tracking) and `issue_comments` (cascading delete). Categories: equipment, process, customer_experience, workspace, inventory, safety, training, other. Priorities: low, medium, high, urgent. Statuses: open, in_progress, waiting, resolved, closed. Activity logs created on issue creation and status changes. `store_id` references `work_locations(id)`. Five composite indexes for efficient queries.
- **Offline Mode**: Service worker with IndexedDB for offline data storage and background synchronization.
- **ELON Authenticated Crawling**: Manual popup login flow for authenticated page crawling by ELON's Playwright crawler, with server-side session token storage.
- **ELON Code Engine Enhancements**: Code engine features include multi-file awareness, fuzzy matching, syntax verification with auto-rollback, runtime validation via health checks, and multi-file atomic changes with all-or-nothing rollback for robust autonomous code modifications.

## External Dependencies

### Core Framework & Language
- **React Ecosystem**: For frontend development.
- **TypeScript**: Used universally for type safety.
- **Vite, esbuild**: For development and bundling.

### Database & ORM
- **Neon Database**: Serverless PostgreSQL for data storage.
- **Drizzle ORM**: Type-safe ORM for database interactions.
- **@neondatabase/serverless**: For database connection pooling.

### Authentication
- **Clerk**: Comprehensive user authentication and management.

### AI Services
- **Anthropic Claude**: For all AI-driven functionalities (using `claude-sonnet-4-20250514` model).

### ELON Deep Testing & Autonomous Improvement (Sneebly)
- **Integration Health Monitor**: Probes external services (Shopify, Nylas, Claude AI, Database, WebSockets).
- **Scenario Test Runner**: Executes JSON-defined Playwright test scripts for critical user journeys.
- **Regression Tracker**: Monitors test failures over time and escalates issues.
- **Dependency Index**: Maps code dependencies for context-aware problem solving.
- **Dev Mode Toggle**: For test fixture creation.
- **ELON Cycle Integration**: All Sneebly modules feed data into ELON's constraint analysis.
- **Server-side action logger**: Captures API requests, errors, and failure details.
- **Client-side error reporter**: Catches frontend errors and failed API calls.

### UI & Styling
- **shadcn/ui**: Component library.
- **Tailwind CSS**: Utility-first CSS framework.
- **Font Awesome**: Icon library.
- **Google Fonts**: Inter font.

### Real-time & Communication
- **WebSockets**: Hardened implementation with server-side heartbeat/ping-pong (30s interval, 10s timeout), connection tracking with structured pino logging, graceful shutdown with `server_restarting` event, and duplicate connection replacement. Client-side uses exponential backoff reconnection (1s initial, 30s max, 2x multiplier, random jitter), mobile backgrounding detection via `visibilitychange`, and exposes `ConnectionStatus` type (`connected` | `connecting` | `disconnected`).
- **Web Push API**: For push notifications.

### Utility Libraries
- **date-fns**: Date manipulation.
- **Zod**: Runtime type validation.
- **clsx, tailwind-merge**: Conditional styling.
- **memoizee**: Caching utility.

## Performance Optimizations

### Database Indexes
Composite indexes on frequently queried columns: `time_entries(user_id, clock_in_time)`, `time_entries(clock_in_time)`, `schedules(user_id, start_time)`, `schedules(start_time)`, `clock_events(user_id, created_at)`, `user_availability(user_id, date)`, `user_availability(payroll_period_id)`, `messages(sender_id, recipient_id)`, `users(role_id)`, `users(is_active)`, `tasks(assigned_to)`, `tasks(due_date)`. SOP tables also have composite indexes.

### In-Memory Caching (`server/lib/cache.ts`)
- `MemoryCache` with TTL, automatic eviction every 60s, `getOrSet` async helper.
- **Cached queries**: `getUserPermissions` (2min TTL, invalidated on role/permission changes and user deactivation), `getCompanySettings` (2min TTL, invalidated on update), dashboard user list (60s TTL, invalidated on user deactivation).
- Cache key namespaces: `permissions:`, `company:`, `dashboard:`.

### Response Time Monitoring
- Slow endpoint detection (>200ms) in `server/index.ts` with Pino structured logging.
- Request logger middleware with per-request UUID tracing.
- Action logger with duration tracking and JSONL log rotation.