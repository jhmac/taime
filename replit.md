# Taime Clock - AI-Powered Workforce Management

## Overview
Taime Clock is an AI-powered workforce management platform designed to streamline time tracking, scheduling, task management, and payroll processes for teams. It functions as a Progressive Web App (PWA), offering a mobile-first experience with features like geofencing-enabled time clocking, automated task assignment via Claude AI, real-time communication, and comprehensive payroll management. The platform aims to enhance operational efficiency, optimize labor costs, and provide actionable insights for businesses.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React and TypeScript, utilizing Vite for development and bundling. It features a mobile-first design with responsive layouts, styled using Tailwind CSS and shadcn/ui components built on Radix UI primitives. State management is handled by TanStack React Query for server state and caching, while Wouter manages client-side routing.

### Backend
The backend is a Node.js Express.js server written in TypeScript. It uses Drizzle ORM for type-safe PostgreSQL database operations and Clerk for authentication and authorization, integrated with Express sessions. Real-time communication is facilitated by a WebSocket server. The architecture supports modular routes, Zod for settings validation, and security middleware like Helmet and express-rate-limit.

### Core Features
- **AI Integration**: Leverages Anthropic Claude AI for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, and conversational AI.
- **Authentication & Authorization**: Utilizes Clerk for OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing with both circular radius and custom polygon boundaries using point-in-polygon (ray-casting) detection and Haversine distance calculation. Admin UI features interactive Leaflet map for drawing geofence boundaries, configurable grace periods (1-30min), and auto clock-out. Live employee monitoring with boundary proximity warnings (>80% of radius), geofence enter/exit event logging, and real-time status indicators in TimeClockWidget. Geofence events table for comprehensive audit trail. Routes: server/routes/geofence.ts (check, check-detailed, monitor, event, CRUD endpoints). Service: server/services/geofencingService.ts. Admin UI: client/src/components/settings/GeofenceMapSection.tsx. Schema: work_locations (extended with geofence_type, geofence_polygon, geofence_grace_minutes, auto_clock_out), geofence_events table. Security measures include CORS, secure session cookies, and Zod for input validation. AI prompt injection defense is implemented using system prompts and input sanitization.
- **Employee Work Patterns**: Recurring weekly schedule patterns with 4 status types per day: REQUIRED (must schedule), available (can schedule), preferred_off (avoid if possible), HARD_OFF (never schedule). Pre-built templates (Standard Mon-Fri, Retail Manager, Weekend Warrior, Part-Time Flexible, Mid-Week Off). Visual click-to-toggle weekly grid UI with copy pattern feature. Integrated into AI scheduling as strict rules. Schema: work_pattern_templates, user_work_patterns tables. UI: client/src/components/settings/WorkPatternsSection.tsx (in AI Scheduling settings).
- **Holiday Pay System**: AI-powered parsing of natural language rules to automatically apply holiday pay multipliers, integrated into payroll exports. Includes Holiday Pay Calendar in PayPeriodManagement with AI-recommended popular US holidays (computed for correct year including floating holidays), checkbox selection, custom multiplier (1.25x-3x), custom holiday date picker, and bulk save. Year selector for current/next year. Routes: GET/POST(bulk)/DELETE /api/holiday-pay-rules. UI: PayPeriodManagement.tsx holiday section.
- **Performance Scoring**: Tracks and scores employee clock events across various categories to provide performance insights, configurable via admin settings.
- **AI Success Assistant**: Comprehensive AI-powered employee success coach featuring SOP knowledge base management, Claude-powered chat with SOP context (RAG-style), commute intelligence with departure alerts, pre-shift briefings, onboarding learning paths with progress tracking, and a floating assistant button accessible from every page. Admin-managed SOP categories and documents with publish controls. Routes: server/routes/sop.ts, server/routes/aiAssistant.ts. UI: client/src/components/AIAssistant.tsx, client/src/components/settings/SOPManagementSection.tsx, client/src/pages/Learning.tsx.
- **Shopify Integration**: Provides OAuth-based integration with Shopify to sync sales data, analyze patterns, and offer AI-driven staffing recommendations. Includes year-over-year sales comparison and AI-powered per-day staffing recommendations using Claude. Routes: server/routes/shopify.ts (yoy-comparison, ai-staffing endpoints). UI: client/src/components/AIStaffingPanel.tsx integrated into ScheduleManagement page.
- **AI Auto-Scheduling**: Smart schedule generation using last year's Shopify sales data matched by closest day-of-week (not exact date) to predict revenue per day. Admin configures store hours (per-day open/close times with closed toggle and copy-to-days feature), shift blocks (custom time slots), staffing tiers (dollar-range-to-headcount table), and minimum staffing threshold. Claude AI generates optimized employee assignments respecting availability, store hours, and closed days (employees without explicit availability treated as available). Preview/edit/apply workflow. Includes Employee Scheduling Roster for excluding owners/admins from schedules and setting target weekly hours for full-time employees (AI prioritizes meeting hour targets). Routes: server/routes/aiScheduling.ts (settings, generate, apply, roster endpoints). UI: client/src/components/settings/AISchedulingSection.tsx (admin settings + store hours + roster), client/src/components/AIScheduleGenerator.tsx (schedule generation in ScheduleManagement page).
- **Team Invitation Emails**: Nylas-powered email invitations sent automatically when adding new team members. Includes resend capability with "Resend Invite" button on employee profile. Service: server/services/emailService.ts. Route: POST /api/users, POST /api/users/:userId/resend-invite.
- **Employee Profile Pages**: Homebase-style 4-tab employee detail pages (Job Details, Personal Information, Documents, Performance). Job Details: Access/Roles/Wages with edit, Location Settings checkboxes, Payroll Info, Job History, Time Off. Personal Information: Contact info (preferred name, email, phone, emergency contact), Payroll info (legal name, DOB, SSN, home address). Documents: Certificates, Onboarding forms (W-4, I-9, etc.), general file uploads with download/delete (base64 stored, 5MB limit). Performance: Attendance stats (on-time rate, avg hours/week, missed clock-outs, shifts worked), Task completion (shows N/A when no tasks), Role breakdown, Milestones, Performance score, Manager notes. Routes: GET/POST /api/users/:userId/documents, GET /api/documents/:docId/download, DELETE /api/documents/:docId, GET/POST /api/users/:userId/notes, DELETE /api/notes/:noteId. Schema: employee_documents, manager_notes tables. UI: client/src/pages/TeamMember.tsx.
- **Visual Analytics Dashboard**: Offers Recharts-based visualizations for labor cost trends, punctuality, and task completion, with optional Shopify integration for labor cost vs. revenue analysis. Includes AI anomaly detection.
- **Payroll Export**: Generates CSV exports of detailed payroll information per employee, including hours, overtime, and pay.
- **In-App Messaging**: Supports real-time team chat, direct messages, and announcements via WebSockets.
- **Push Notifications**: Implements Web Push API for critical alerts like clock-out reminders, schedule updates, and task assignments.
- **Offline Mode**: Utilizes a service worker with IndexedDB for offline data storage and background synchronization for time entries.
- **ELON Authenticated Crawling**: Manual popup login flow (similar to Replit's approach) where admin signs in via Clerk in a popup window, session token is stored server-side in `.sneebly/crawler-session.json`, and ELON's Playwright crawler reuses it for authenticated page crawling. Session persists for days (until Clerk expiry). Dashboard shows auth status with "Sign In for ELON" button. Routes: GET/POST/DELETE `/sneebly/api/crawler-session`, GET `/sneebly/crawler-login`. Files: `sneebly-package/src/middleware/admin-dashboard.js`, `sneebly-package/src/subagents/site-crawler.js`.
- **ELON Code Engine Enhancements**: Spec executor has 20K char file context with multi-file awareness (auto-resolves imports for related context). Fuzzy matching with uniqueness requirement (exactly one match, min 2 lines). Syntax verification with negative-depth detection and auto-rollback. Runtime validation via health endpoint check after changes (auto-rollback if app crashes). Multi-file atomic changes: specs can group interdependent changes across files with all-or-nothing rollback. Max 10 iterations per spec. Files: `sneebly-package/src/code-engine.js` (CodeEngine class with verifyRuntime, backupMultiple, rollbackMultiple), `sneebly-package/src/ralph-loop.js` (executeRalphLoop with _applySingleChange, _applyMultiFileChanges, _runRuntimeValidation), `sneebly-package/src/subagents/spec-executor.js` (multi-change response parsing), `sneebly-package/templates/subagents/spec-executor.md` (template with multi-change and runtime docs).

## External Dependencies

### Core Framework & Language
- **React Ecosystem**: React, React Query
- **TypeScript**: Used across all layers
- **Build Tools**: Vite, esbuild

### Database & ORM
- **Neon Database**: Serverless PostgreSQL
- **Drizzle ORM**: Type-safe ORM for PostgreSQL
- **@neondatabase/serverless**: Connection pooling for database access

### Authentication
- **Clerk**: Comprehensive authentication and user management (frontend and backend libraries)

### AI Services
- **Anthropic Claude**: AI services for various platform functionalities (claude-sonnet-4-20250514 model)

### ELON Deep Testing & Autonomous Improvement (Sneebly)
- **Integration Health Monitor**: `sneebly-package/src/integration-health.js` probes Shopify, Nylas, Claude AI, Database, and WebSocket integrations. Checks API connectivity, token validity, and configuration without exposing secrets. Dashboard route: `GET /sneebly/api/integration-health`. Results feed into ELON's constraint analysis.
- **Scenario Test Runner**: `sneebly-package/src/scenario-runner.js` executes JSON-defined Playwright test scripts for critical user journeys (Shopify connect, clock-in/out, schedule management, payroll, API health). Supports authenticated sessions. Dashboard routes: `GET /sneebly/api/scenario-results`, `POST /sneebly/api/run-scenarios`.
- **Regression Tracker**: `sneebly-package/src/regression-tracker.js` tracks test/health failures over time with escalation scoring (consecutive failures × rate × duration). Dashboard route: `GET /sneebly/api/regressions`. Escalated issues get priority in ELON's constraint analysis.
- **Dependency Index**: `sneebly-package/src/dependency-index.js` maps routes→services→schema→pages for integration-aware code context. Helps ELON find all related files when fixing integration bugs. Dashboard route: `GET /sneebly/api/dependency-index`.
- **Dev Mode Toggle**: Test fixture creation mode with 24-hour auto-warning. Routes: `GET/POST /sneebly/api/dev-mode`. Owner action logged.
- **ELON Cycle Integration**: All modules wired into `elon.js` `runElonCycle()` — health checks, scenario tests, regression data, and dependency index all feed into Claude's constraint analysis. Integration health issues, scenario failures, and escalated regressions appear as additional evidence alongside crawl results.

### Advanced Action Logging (Sneebly Integration)
- **Server-side action logger**: Middleware in `server/services/actionLogger.ts` captures every API request with user context, action intent mapping, status codes, and failure details. Writes to `.sneebly/action-log.jsonl` and feeds 500/401/403 errors into `.sneebly/error-log.jsonl` for Sneebly/ELON analysis. Includes deep redaction of sensitive fields.
- **Client-side error reporter**: `client/src/lib/errorReporter.ts` catches unhandled errors, promise rejections, and failed API calls. Batches and sends to `POST /api/client-errors`. Initialized globally via `initGlobalErrorHandlers()` in App.tsx.
- **ELON integration**: `_loadActionLogInsights()` in elon.js reads action logs to identify top user failure patterns, feeding real-world usage data into constraint analysis.
- **API endpoints**: `POST /api/client-errors` (unauthenticated, receives frontend errors), `GET /api/action-logs/summary` (authenticated, returns failure analytics).

### UI & Styling
- **shadcn/ui**: Component library based on Radix UI
- **Tailwind CSS**: Utility-first CSS framework
- **Font Awesome**: Icon library
- **Google Fonts**: Inter font

### Real-time & Communication
- **WebSockets**: Native implementation for real-time features
- **Web Push API**: For push notifications

### Utility Libraries
- **date-fns**: Date manipulation
- **Zod**: Runtime type validation
- **clsx, tailwind-merge**: Conditional styling utilities
- **memoizee**: Caching utility