# ClockSync AI - Team Time Tracker

## Overview

ClockSync AI is a comprehensive workforce management platform that combines time tracking, scheduling, task management, and AI-powered insights for teams. The application provides smart time tracking with geofencing, automated task assignment using Claude AI, real-time team communication, and payroll management capabilities. Built as a Progressive Web App (PWA), it offers mobile-first design with features like push notifications, offline support, and location-based clock-in validation.

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

### Authentication & Authorization
- **Provider**: Replit Auth using OpenID Connect (OIDC)
- **Strategy**: Passport.js with custom OpenID Connect strategy
- **Session Storage**: PostgreSQL-backed sessions with configurable TTL
- **Role-based Access**: Admin and Employee roles with different permissions

### Database Design
- **Primary Database**: PostgreSQL with Neon serverless driver
- **Schema Management**: Drizzle Kit for migrations and schema evolution
- **Key Entities**: Users, TimeEntries, Schedules, Tasks, Messages, WorkLocations, PayrollPeriods, AIInsights
- **Session Storage**: Dedicated sessions table for authentication persistence

### AI Integration
- **Provider**: Anthropic Claude AI (claude-sonnet-4-20250514 model)
- **Use Cases**: 
  - Automated chore/task assignment based on employee schedules and workload
  - Schedule optimization and labor cost forecasting
  - Anomaly detection for time tracking irregularities
  - Payroll validation and error highlighting
  - Conversational AI chat for employee assistance

### Geolocation & Security
- **Geofencing**: Browser geolocation API with custom distance calculations using Haversine formula
- **Location Validation**: Work location boundaries enforcement for clock-in/out operations
- **Security**: CORS configuration, secure session cookies, input validation with Zod schemas

### Push Notifications
- **Technology**: Web Push API with VAPID keys
- **Service Worker**: Custom implementation for offline support and background notifications
- **Use Cases**: Clock-out reminders when leaving work location, schedule updates, task assignments

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
- **Replit Auth**: OpenID Connect integration with passport strategies
- **Session Management**: PostgreSQL session storage with connect-pg-simple

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