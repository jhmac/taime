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
- **Daily Ritual System**: Includes Morning Huddle, Daily Debrief, Daily Improvement Quotes, and Kudos, with AI-generated content and trend analysis.
- **Improvement Video Platform**: Paul Akers-inspired 60-second improvement video sharing system. Schema: `improvement_videos` (YouTube/S3 storage, categories, featured picks, view counts), `video_likes` (unique per user per video), `video_comments`. All tables indexed for store-scoped queries.
- **Offline Mode**: Service worker with IndexedDB for offline data storage and background synchronization.
- **ELON Authenticated Crawling**: Manual popup login flow for authenticated page crawling by ELON's Playwright crawler, with server-side session token storage.
- **ELON Code Engine Enhancements**: Features include multi-file awareness, fuzzy matching, syntax verification with auto-rollback, runtime validation, and multi-file atomic changes for robust autonomous code modifications.

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