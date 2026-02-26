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
- **AI Integration**: Leverages Anthropic Claude for automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI, and AI-assisted SOP generation. This includes an "Ask MAinager" conversational AI copilot with multi-layer context and actionable suggestions.
- **Authentication & Authorization**: Implemented with Clerk, supporting OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing capabilities including circular and polygon boundaries, configurable grace periods, auto clock-out, live monitoring, and event logging.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability and pre-built templates, integrated with AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers, integrated with a configurable Holiday Pay Calendar.
- **AI Auto-Scheduling**: Generates optimized schedules using historical sales data (from Shopify), considering store hours, staffing tiers, employee availability, and minimum staffing thresholds. Includes shift overlap for briefing and cleaning.
- **SOP Library & Execution**: Structured operating procedures with templates, versioning, execution tracking, and mobile-optimized checklist runner. Features **Decision Tree SOPs** with branching logic and flow visualization. Includes a training mode with multimedia content, auto-activation for new hires, and a Training Hub.
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
- **Digital Cash Management System**: Replaces paper-based drawer opening/closing with a guided step-by-step denomination wizard. Features include per-register opening/closing counts, AI deposit slip verification (Claude Vision), denomination-by-denomination guided counting (coins → rolled coins → bills), running totals, recount flow with AI suggestions, register summary data entry (Shopify integration), over/short tracking with explanations, employee on-duty snapshots via time_entries, and an **AI Cash Investigation Engine** that analyzes 90 days of discrepancy data to detect employee patterns, register patterns, day/time patterns, amount patterns, and provides risk scores with recommendations. Includes owner review dashboard with daily reports, 30-day trend charts, and investigation tab. CashStatusCard on Manager/Owner dashboards. Navigation via MoreMenu (mobile) and DesktopSidebar. DB tables: drawer_sessions, cash_deposits, cash_management_settings, cash_discrepancy_log.

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