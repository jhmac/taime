# Taime Clock - AI-Powered Workforce Management

## Overview
Taime Clock is an AI-powered Progressive Web App (PWA) designed to enhance workforce management. Its core purpose is to streamline time tracking, scheduling, task management, and payroll processes using AI. Key capabilities include geofencing-enabled time clocking, automated task assignment, and comprehensive payroll management, all delivered through a mobile-first, user-friendly interface. The project aims to boost operational efficiency, optimize labor costs, and provide actionable business insights.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React and TypeScript PWA, built with Vite. It features a responsive, mobile-first design using Tailwind CSS and shadcn/ui components. State management is handled by TanStack React Query, and Wouter manages client-side routing.

### Backend
The backend is a Node.js Express.js server written in TypeScript. It uses Drizzle ORM for type-safe PostgreSQL interactions and Clerk for authentication and authorization. Real-time communication is powered by WebSockets. The architecture emphasizes modular routes, Zod for input validation, and security middleware.

### Core Features
- **AI Integration**: Leverages Anthropic Claude for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI, and AI-assisted SOP generation.
- **Authentication & Authorization**: Implemented with Clerk, supporting OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing capabilities including circular and polygon boundaries, configurable grace periods, auto clock-out, live monitoring, and event logging.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability and pre-built templates, integrated with AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers, integrated with a configurable Holiday Pay Calendar.
- **AI Auto-Scheduling**: Generates optimized schedules using historical sales data (from Shopify), considering store hours, staffing tiers, employee availability, and minimum staffing thresholds.
- **SOP Library & Execution**: Structured operating procedures with templates, versioning, execution tracking, and step-level completions. Features a mobile-optimized checklist runner and context-aware SOP surfacing based on time, events, roles, issues, or API triggers.
- **Issue Tracker**: A system for employees to log problems and managers to track and resolve them, with categories, priorities, statuses, and comments.
- **Daily Ritual System**: Includes Morning Huddle, Daily Debrief, Daily Improvement Quotes, Kudos, and Midday Pulse, with AI-generated content and trend analysis.
- **Improvement Video Platform**: A system for sharing 60-second improvement videos with YouTube/S3 storage, categories, likes, and comments.
- **Offline Mode**: Utilizes a service worker with IndexedDB for offline data storage and background synchronization.
- **ELON Authenticated Crawling**: Supports manual popup login for authenticated page crawling by ELON's Playwright crawler.
- **ELON Code Engine Enhancements**: Features for robust autonomous code modifications including multi-file awareness, fuzzy matching, syntax verification with auto-rollback, and runtime validation.
- **Shift Overlap & Handoff**: AI scheduling generates overlapping shifts for briefing and cleaning, with budget warnings. Personalized handoff messages are surfaced via SOPs.
- **Role-Specific Dashboards**: Provides distinct dashboards for Associates (employees), Managers (admins), and Owners, tailored to their specific needs and metrics.
- **GTD Workflow Engine**: A comprehensive Getting Things Done system with tables for inbox items, projects, next actions, waiting for, someday/maybe, and reference material.
- **GTD AI Clarification Engine**: A Claude-powered inbox processor that classifies raw captures into GTD destinations with suggested attributes.
- **GTD Inbox & List Views**: Frontend components for quick capture, processing inbox items with AI suggestions, and dedicated list views for actions, projects, waiting-for, and someday/maybe items.
- **GTD Weekly Review**: AI-guided weekly review ritual with 5-step flow (Get Clear, Get Current, Get Creative, Week in Review, You're Set). Backend gathers inbox/project/action/waiting/someday/SOP/debrief/video/issue data and generates structured review via Claude (15s timeout, fallback). `weekly_reviews` table with status lifecycle. Three API endpoints at `/api/gtd/review/`. Cron pre-generates Fridays at 2:45pm. WeeklyReviewCard on manager/owner dashboards on Fridays. Desktop sidebar link at `/gtd/review`.
- **In-App Messaging**: Real-time threaded messaging system (`server/routes/messaging.ts`, `client/src/features/messaging/`). Three tables: `message_threads` (direct/group/channel), `thread_participants` (with unread tracking via `last_read_at`), `thread_messages` (text/image/system, soft delete, edit within 15min, threaded replies). WebSocket-powered real-time delivery via targeted `sendToUsers` function. Features: optimistic message sending with temp IDs, typing indicators, read receipts, direct message deduplication, participant validation, split-view desktop layout (thread list + conversation), full-screen mobile conversation. Unread badge on both desktop sidebar and mobile bottom nav. Routes at `/api/messages/`. Frontend at `/messages`. Old Communication/Shoutouts page preserved at `/communication`.
- **Performance Optimizations**: Includes request timing middleware, batch operations for schedules, optimized dashboard queries, strategic database indexing, and an in-memory cache for frequently accessed data.
- **RAG Semantic Search**: Vector-based SOP search using pgvector and local embeddings (`@xenova/transformers`, model: `Xenova/all-MiniLM-L6-v2`, 384 dimensions). `sop_embeddings` table stores vector embeddings for templates, steps, and training notes. `server/services/embeddingService.ts` handles local model loading and embedding generation with in-memory cache. `server/services/sopIndexer.ts` indexes SOPs (auto-triggered on create/update, nightly cron at 2am). `server/routes/ragSearch.ts` provides `GET /api/rag/search?q=...`, `POST /api/sops/reindex`, `POST /api/sops/reindex/:templateId`, `GET /api/rag/status`. Content-hash-based skip for unchanged content.
- **Ask MAinager AI Copilot**: RAG-powered conversational AI assistant (`server/services/askMAinager.ts`, `client/src/features/ai-copilot/AskMAinagerSheet.tsx`). Gathers multi-layer context (store, role, temporal, SOP knowledge via RAG search, operational data: schedules/tasks/issues/debriefs) before Claude call. System prompt includes intent detection for actionable suggestions (start SOP, create issue, view schedule/tasks). `ai_feedback` table for thumbs up/down + text feedback. Slide-up chat sheet on mobile, side panel on desktop. Features: confidence indicators, referenced SOP chips, suggested action buttons, auto-retry on timeout, context-aware quick suggestions based on time of day, conversation persistence. API: `POST /api/ai/ask`, `POST /api/ai/feedback`, `GET /api/ai/conversations`. Rate limited to 30/hour. Global FAB button with pulse animation, opens via custom event `open-ask-mainager` from dashboard AI buttons.

## External Dependencies

### Database & ORM
- **Neon Database** (PostgreSQL)
- **Drizzle ORM**
- **@neondatabase/serverless**

### Authentication
- **Clerk**

### AI Services
- **Anthropic Claude**

### ELON Deep Testing & Autonomous Improvement
- **Integration Health Monitor**
- **Scenario Test Runner** (Playwright)
- **Regression Tracker**

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

## Performance Optimizations
- **Request Timing Middleware**: `server/middleware/requestLogger.ts` tracks response times, warns on slow endpoints (>200ms standard, >5s AI). Includes request IDs for tracing.
- **In-Memory Cache**: `server/lib/cache.ts` provides `MemoryCache` with TTL, `getOrSet`, prefix invalidation, and automatic eviction. Used in storage (work locations, permissions, company settings), dashboard (user lists), analytics, roles, SOP surfacing, and midday pulse.
- **Database Indexes**: 80+ custom indexes across all tables covering frequent query patterns (GTD store/owner/status, messaging threads, kudos, issues, time entries, etc.).
- **Query Optimizations**: Batch participant inserts in messaging (eliminated N+1), column-specific SELECTs on dashboard/sales queries, optimized kudos stats to fetch only needed columns.
- **Kudos Wall**: `client/src/features/kudos/` - expanded wall with filters (by employee, date range, pagination), stats endpoint, 3-step Give Kudo dialog with quick messages and preview.