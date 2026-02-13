# Taime Clock - AI-Powered Workforce Management

## Overview

Taime Clock is a comprehensive workforce management platform that combines time tracking, scheduling, task management, and AI-powered insights for teams. The application provides smart time tracking with geofencing, automated task assignment using Claude AI, real-time team communication, and payroll management capabilities. Built as a Progressive Web App (PWA), it offers mobile-first design with features like push notifications, offline support, and location-based clock-in validation.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables
- **State Management**: TanStack React Query for server state and caching
- **Routing**: Wouter for lightweight client-side routing
- **Mobile-First Design**: Responsive layout optimized for mobile devices with bottom navigation

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Session Management**: Express sessions with PostgreSQL store using connect-pg-simple
- **Real-time Communication**: WebSocket server for live updates and notifications
- **File Structure**: Monorepo structure with shared schema between client and server
- **Security Middleware**: Helmet for HTTP security headers, express-rate-limit for AI endpoint throttling, 2MB request body size limits

### Authentication & Authorization
- **Provider**: Clerk (clerk.com) for OAuth/SSO authentication
- **Frontend**: @clerk/clerk-react with ClerkProvider, SignedIn/SignedOut components, UserButton
- **Backend**: @clerk/express with clerkMiddleware() for JWT verification via getAuth()
- **User Sync**: On first login, Clerk user data syncs to local database via /api/auth/sync
- **Role-based Access**: Admin, Owner, and Employee roles with granular permissions
- **Token Flow**: Frontend sends Clerk JWT Bearer tokens; backend verifies via Clerk middleware
- **AI Prompt Injection Defense**: All Claude AI calls use `PROMPT_INJECTION_GUARD` system prompt that prevents role hijacking, instruction override, and social engineering attacks; user inputs are sanitized with regex pattern matching to strip common injection vectors; chat messages capped at 2000 chars
- **App-Level Security**: Store owners control their own admin operations (roles, permissions, settings, locations, payroll, team, Shopify) via the existing role/permission system. AI-level protections guard against prompt injection and code-level hijacking.

### Admin & Management Pages
- **Admin Settings Hub** (`/admin`): Company profile config (name, timezone, business hours, overtime rules, geofence settings), work locations management (CRUD with geofencing radius), activity logging for admin actions, quick-link cards to Team/Roles/Payroll
- **Team Management** (`/team`): Searchable/filterable member table with role/status filters, profile slide-out panel (Sheet), inline role and pay rate editing, add member dialog, deactivate/remove with confirmation dialogs
- **Role Management** (`/hr/roles`): Visual permission matrix (roles as columns, permissions as rows grouped by category), role templates/presets (Basic Employee, Shift Lead, Manager, Full Admin), create role with clone-from-existing option
- **HR Dashboard** (`/hr`): Real computed metrics from API data (attendance rate, task completion, punctuality), dynamic week date range, recent activity from time entries
- **Permission System**: 7 categories (Time & Attendance, Scheduling, HR & People, Administration, Communication, Payroll, AI Features), `admin.manage_all` acts as superuser fallback for all permission checks

### Database Design
- **Primary Database**: PostgreSQL with Neon serverless driver
- **Schema Management**: Drizzle Kit for migrations and schema evolution
- **Key Entities**: Users, TimeEntries, Schedules, Tasks, Messages, WorkLocations, PayrollPeriods, AIInsights, CompanySettings, ActivityLogs
- **Session Storage**: Dedicated sessions table for authentication persistence

### AI Integration
- **Provider**: Anthropic Claude AI (claude-sonnet-4-20250514 model)
- **Use Cases**: 
  - Automated chore/task assignment based on employee schedules and workload
  - Schedule optimization and labor cost forecasting
  - Anomaly detection for time tracking irregularities
  - Payroll validation and error highlighting
  - Conversational AI chat for employee assistance

### Holiday Pay System
- **AI-Powered Setup**: Owner types natural language instructions (e.g., "pay time and a half on Christmas Eve, Memorial Day, Fourth of July") and Claude AI parses them into structured rules
- **Database Table**: `holiday_pay_rules` stores holiday name, month, day, pay multiplier, and active status
- **Automatic Payroll Integration**: Payroll export automatically detects hours worked on holidays and applies the correct pay multiplier bonus
- **API Routes**: `POST /api/ai/parse-holiday-pay` (AI parsing + save), `GET /api/holiday-pay-rules` (list), `DELETE /api/holiday-pay-rules/:id` (remove), `PATCH /api/holiday-pay-rules/:id` (update)
- **Frontend**: "Holiday Pay" tab in AdminSettings with AI text input, parsed rules display with month/day badges, multiplier labels, and delete controls
- **Key Files**: shared/schema.ts (holidayPayRules table), server/services/claudeService.ts (parseHolidayPayRules method), server/routes.ts (holiday pay + updated payroll export), client/src/pages/AdminSettings.tsx (Holiday Pay tab)

### Geolocation & Security
- **Geofencing**: Browser geolocation API with custom distance calculations using Haversine formula
- **Location Validation**: Work location boundaries enforcement for clock-in/out operations
- **Security**: CORS configuration, secure session cookies, input validation with Zod schemas

### Shopify Integration
- **OAuth Flow**: Full OAuth 2.0 with HMAC verification and CSRF state tokens for secure store connection
- **Token Storage**: Shopify access tokens stored directly in PostgreSQL
- **API**: Shopify GraphQL Admin API (version 2025-04) via ShopifyService class
- **Data Sync**: Historical order data fetched and aggregated into shopify_daily_sales table (date, order count, revenue)
- **AI Recommendations**: Claude AI analyzes sales patterns by day-of-week to generate staffing multiplier suggestions
- **Database Tables**: shops (store info + encrypted tokens), user_shops (user-store mapping), shopify_daily_sales (daily aggregates)
- **Key Files**: server/services/shopifyService.ts, server/routes.ts (contains sales sync and staffing recommendation logic inline)
- **API Routes**: /api/shopify/auth (initiate OAuth), /api/shopify/auth/callback (complete OAuth), /api/shopify/sync-sales (trigger sync), /api/shopify/sales-data (retrieve data), /api/shopify/staffing-recommendations (AI analysis), /api/shopify/shops (list connected stores)
- **Frontend**: Shopify tab in AdminSettings page with connect/disconnect flow, sync controls, sales analytics, and AI recommendations; Schedule page shows AI staffing insight cards
- **Required Env Vars**: SHOPIFY_API_KEY, SHOPIFY_API_SECRET

### Visual Analytics Dashboard
- **Page**: `/analytics` with permission guard (`hr.view_team`)
- **Charts**: Recharts-based labor cost trends, punctuality scores (SVG ring), task completion bars
- **API**: `GET /api/analytics/dashboard` computes 30-day labor costs, punctuality, task completion, team summary
- **Shopify Integration**: Optional ShopifyAnalytics section shows labor cost % vs revenue when shop connected
- **AI Anomaly Detection**: "Run Anomaly Scan" button triggers `POST /api/ai/detect-anomalies` for Claude-powered analysis

### Payroll Export
- **API**: `GET /api/payroll/export?startDate=X&endDate=Y` returns CSV with per-employee hours, overtime, and pay
- **UI**: Download button in each pay period row in PayPeriodManagement page

### In-App Messaging
- **Page**: `/communication` with three tabs: Team Chat (group conversations), Direct Messages, Announcements
- **Real-time**: WebSocket integration auto-invalidates message queries on `message_created` events
- **API**: POST /api/messages, GET /api/messages, POST/GET /api/groups, group member management

### Push Notifications
- **Technology**: Web Push API with VAPID keys
- **Service Worker**: Custom implementation for offline support and background notifications
- **Subscription UI**: NotificationSettings component in AdminSettings "Alerts" tab with enable/disable toggle, notification type preferences, test button
- **API**: `POST /api/push/subscribe` (register), `POST /api/push/test` (test notification)
- **Use Cases**: Clock-out reminders when leaving work location, schedule updates, task assignments

### Offline Mode
- **Service Worker**: IndexedDB-based offline storage for POST/PATCH to `/api/time-entries`
- **Background Sync**: Uses Background Sync API when available, manual sync fallback
- **UI**: OfflineIndicator component shows yellow banner when offline, green "syncing" banner on reconnect

### Development & Deployment
- **Development**: Hot module replacement with Vite, TypeScript compilation checking
- **Build Process**: Vite for client bundling, esbuild for server bundling
- **Environment**: Replit-optimized with development banners and error overlays

## External Dependencies

### Core Framework Dependencies
- **React Ecosystem**: React 18+ with DOM rendering, React Query for data fetching
- **TypeScript**: Full TypeScript support across client, server, and shared modules
- **Build Tools**: Vite for development and production builds, esbuild for server compilation

### Database & ORM
- **Neon Database**: Serverless PostgreSQL with WebSocket connections
- **Drizzle ORM**: Type-safe ORM with PostgreSQL dialect, automated migrations
- **Connection Pooling**: @neondatabase/serverless with connection pooling

### Authentication Services
- **Clerk**: @clerk/clerk-react (frontend) and @clerk/express (backend) for complete auth
- **JWT Verification**: Clerk middleware handles token validation on all API routes

### AI Services
- **Anthropic Claude**: Official SDK for AI-powered features and chat capabilities
- **Model**: claude-sonnet-4-20250514 for latest AI capabilities

### UI & Styling
- **Component Library**: Radix UI primitives for accessible components
- **Styling**: Tailwind CSS with custom configuration and design system
- **Icons**: Font Awesome for comprehensive icon coverage
- **Fonts**: Google Fonts (Inter) for modern typography

### Real-time & Communication
- **WebSockets**: Native WebSocket implementation for real-time updates
- **Push Notifications**: Web Push API with VAPID authentication
- **Service Workers**: Custom implementation for PWA functionality

### Development Tools
- **Linting & Formatting**: TypeScript compiler for type checking
- **Development Experience**: Replit-specific plugins for cartographer and error overlay
- **Hot Reload**: Vite HMR for rapid development iteration

### Utility Libraries
- **Date Handling**: date-fns for date manipulation and formatting
- **Form Validation**: Zod for runtime type validation and form schemas
- **Utility Functions**: clsx and tailwind-merge for conditional styling
- **Memoization**: memoizee for caching expensive operations