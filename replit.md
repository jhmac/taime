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
- **Performance Optimizations**: Includes request timing middleware, batch operations for schedules, optimized dashboard queries, strategic database indexing, and an in-memory cache for frequently accessed data.

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