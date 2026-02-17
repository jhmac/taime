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
- **Geofencing & Security**: Employs browser geolocation for work location validation, smart clock-in prompts, and an innovative "Clock Out on Focus Loss" feature. Security measures include CORS, secure session cookies, and Zod for input validation. AI prompt injection defense is implemented using system prompts and input sanitization.
- **Holiday Pay System**: AI-powered parsing of natural language rules to automatically apply holiday pay multipliers, integrated into payroll exports.
- **Performance Scoring**: Tracks and scores employee clock events across various categories to provide performance insights, configurable via admin settings.
- **Shopify Integration**: Provides OAuth-based integration with Shopify to sync sales data, analyze patterns, and offer AI-driven staffing recommendations.
- **Visual Analytics Dashboard**: Offers Recharts-based visualizations for labor cost trends, punctuality, and task completion, with optional Shopify integration for labor cost vs. revenue analysis. Includes AI anomaly detection.
- **Payroll Export**: Generates CSV exports of detailed payroll information per employee, including hours, overtime, and pay.
- **In-App Messaging**: Supports real-time team chat, direct messages, and announcements via WebSockets.
- **Push Notifications**: Implements Web Push API for critical alerts like clock-out reminders, schedule updates, and task assignments.
- **Offline Mode**: Utilizes a service worker with IndexedDB for offline data storage and background synchronization for time entries.

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