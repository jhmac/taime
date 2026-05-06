# Taime - AI Boutique Manager

## Overview
Taime is an AI-powered Progressive Web App (PWA) designed to operate as an AI boutique manager. Its core purpose is to boost operational efficiency, reduce labor costs, and deliver crucial business insights by integrating AI into time tracking, scheduling, task management, and payroll processes. Key features include geofencing-enabled time clocking, automated task assignment, and comprehensive payroll management, all through a mobile-first interface. The project aims to provide a comprehensive solution for boutique management, leveraging AI for optimization and decision-making.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React and TypeScript PWA, built with Vite. It features a responsive, mobile-first design using Tailwind CSS and shadcn/ui components. State management is handled by TanStack React Query, and Wouter manages client-side routing. The UI/UX prioritizes touch-friendly interactions and adaptive layouts for various screen sizes, including mobile-specific navigation and interactive elements like pinch-zoom and swipe navigation on schedules.

### Backend
The backend is a Node.js Express.js server written in TypeScript, utilizing Drizzle ORM for type-safe PostgreSQL interactions and Clerk for authentication and authorization. Real-time communication is powered by WebSockets. The architecture emphasizes modular routes, Zod for input validation, and security middleware.

### Core Features
- **AI Integration**: Leverages Anthropic Claude for tasks such as automated task assignment, schedule optimization, labor cost forecasting, anomaly detection, payroll validation, conversational AI ("Ask MAinager"), and AI-assisted SOP generation.
- **Authentication & Authorization**: Implemented with Clerk, supporting OAuth/SSO, user synchronization, and role-based access control (Admin, Owner, Employee) with granular permissions.
- **Geofencing & Security**: Advanced geofencing capabilities with configurable grace periods, auto clock-out, live monitoring, and event logging.
- **Employee Work Patterns**: Supports recurring weekly schedule patterns with flexible availability and pre-built templates, integrated with AI scheduling.
- **Holiday Pay System**: AI-powered parsing of natural language rules for automatic holiday pay multipliers and a configurable Holiday Pay Calendar.
- **AI Auto-Scheduling**: Generates optimized schedules using historical Shopify sales data, considering store hours, staffing tiers, employee availability, zone-split minimum staffing, and employee performance scores. It includes an AI Rules engine for custom instructions and special circumstances.
- **Shopify Day Backfill**: An endpoint to fetch and store Shopify order data for historical analysis, automatically triggered for schedule suggestions.
- **Availability & Scheduling Command Center**: A redesigned scheduling experience with a "Today's Intelligence" side panel ranking employees by availability, per-hour coverage timeline, and quick-add shift functionalities.
- **SOP Library & Execution**: Structured operating procedures with templates, versioning, execution tracking, and a mobile-optimized checklist runner.
- **Unified AI Learning Platform**: Integrates AI Content Studio and AI Learning Center for quiz generation from documents, daily quizzes, and manager learning analytics.
- **Daily Ritual System**: Includes Morning Huddle, Daily Debrief, and Kudos, with AI-generated content.
- **Offline Mode**: Utilizes a service worker with IndexedDB for offline data storage and background synchronization.
- **Role-Specific Dashboards**: Provides distinct dashboards for Associates, Managers, and Owners/Admins. The AdminOwnerDashboard is a real-time business health monitor with ~11 collapsible panels (AI Morning Briefing, Floor Status, Sales vs. Goal, Payroll Health, Performance Leaderboard, HR Actions, Tasks Health, Supplies Reorder, Issues Snapshot, Schedule Overview, Cash Status). Panels are collapsible with localStorage persistence.
- **Performance Optimizations**: Includes request timing middleware, N+1 query fixes, strategic database indexes, and in-memory caching.
- **RAG Semantic Search**: Vector-based SOP search using pgvector and local embeddings.
- **Lean Board**: Team-level improvement tracking board with daily snapshots and weekly AI summaries.
- **SOP Evolution System**: AI-powered revision proposals for SOPs based on employee feedback and analytics.
- **Smart Task Suggestions (AI Review Assistant)**: Proactive AI-powered daily task prioritization based on employee context.
- **Anomaly Detection & Push Notifications**: Detects clock-in and payroll anomalies, sending push notifications.
- **Timesheets & Pay Period Review**: Comprehensive timesheet management with AI Overtime Prevention Engine and Off-Site Allowance System.
- **Employee Gamification Score Panel**: Performance scoring system based on attendance, tasks, SOPs, engagement, and learning, with tiers and leaderboards.
- **Payroll Export**: Dedicated payroll export page with format presets and custom field selection.
- **Visual Dashboards**: Enhanced analytics dashboard for owners/admins with weekly comparisons and AI anomaly detection.
- **Supply & Inventory Kanban System**: Two-bin Kanban-inspired supply management with visual stock levels and auto-generated reorder tasks.
- **AI Content Studio**: Manager-only hub for AI-powered content generation from uploaded documents.
- **Digital Cash Management System**: Replaces paper-based processes with a guided denomination wizard, AI deposit slip verification, and an AI Cash Investigation Engine, including advanced drawer reconciliation features.
- **Mobile-First Schedule Page**: Redesigned timeline view with pinch-zoom, swipe navigation, a mobile 3-day week window, and touch-friendly shift block interactions.

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
- **@capacitor/core**
- **@capacitor/ios / @capacitor/android**
- **@capacitor/geolocation**
- **@capacitor/haptics**
- **@capacitor/camera**
- **@capacitor/push-notifications**
- **@capacitor/status-bar**
- **@capacitor/splash-screen**

### Utility Libraries
- **date-fns**
- **Zod**
- **clsx, tailwind-merge**