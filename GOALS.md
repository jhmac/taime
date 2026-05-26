# Taime

## Mission

Taime is an AI-powered boutique retail operations platform that replaces paper-based and manual processes with a single mobile-first PWA. It provides time clocking with GPS geofencing, AI-generated shift scheduling, task management, SOP execution, payroll review, and real-time business dashboards. Three user roles interact with tailored experiences: Associates clock in/out, complete tasks and SOPs, and see their own metrics; Managers run the floor, create schedules, approve time, and access AI briefings; Owners/Admins see the full financial and operational picture in real time. The stack is React/Vite + TypeScript on the frontend, Node/Express/TypeScript on the backend, PostgreSQL via Drizzle ORM, Clerk for auth, and Anthropic Claude for all AI features.

## Tech Stack

- Language: TypeScript (frontend and backend)
- Framework: React 18 + Vite (frontend)
- Backend: Node.js + Express
- Database: PostgreSQL (Neon) via Drizzle ORM
- Auth: Clerk (OAuth/SSO, session management, user sync)
- AI: Anthropic Claude (claude-sonnet-4, claude-haiku-4)
- Real-time: WebSockets (ws)
- Styling: Tailwind CSS + shadcn/ui (Radix primitives)
- Mobile: Capacitor (iOS/Android shell, geolocation, push, haptics, camera)
- Push: Web Push API (VAPID) + Capacitor Push Notifications
- Search: pgvector + @xenova/transformers (local 384-dim embeddings)
- Email: SendGrid
- Payments/POS: Shopify (webhooks + REST API)
- State: TanStack React Query v5
- Routing: Wouter

## Key Features

### Employee Account Hard-Delete Cascade

**Purpose:** Associates and managers can permanently delete their own account from Settings > Data & Privacy. Owners must transfer ownership first so a store is never left without an owner.

**Primary flow:**
1. User navigates to Settings > Data & Privacy and clicks "Delete account".
2. An `AlertDialog` asks them to type the word "DELETE" to confirm. The confirm button is disabled until the text matches exactly.
3. On confirm, the frontend calls `DELETE /api/account/self`.
4. The backend (in `server/routes/users.ts`) guards against last-owner deletion, then calls `storage.deleteUser(userId)` which runs `db.delete(users).where(eq(users.id, userId))`.
5. After success the frontend redirects to the landing page (`/`).

**Key data / entities:** `users` table is the root. Related records that reference `users.id` span: `user_permission_overrides`, `location_permissions`, `user_availability_templates`, `availability_overrides`, `time_off_requests`, `schedules`, `time_entries`, `shift_swap_requests`, `schedule_audit_logs`, `tasks` (assigned_to / created_by), `task_responses`, `gtd_inbox_items`, `gtd_projects`, `messages`, `thread_participants`, `kudos`, `employee_documents`, `sop_executions`, `training_progress`, `mileage_reimbursements`, `payroll_period_adjustments`, `native_push_tokens`, `push_subscriptions`.

**What already exists:** The UI confirmation dialog (type-to-confirm pattern) is complete and wired. The backend route exists and deletes `native_push_tokens`, `push_subscriptions`, runs `db.delete(users)`, and attempts a Clerk user deletion.

**What is missing:** The vast majority of FK columns referencing `users.id` have no `onDelete: 'cascade'` directive in the Drizzle schema, so Postgres will raise a foreign key violation on the final `db.delete(users)` for any user who has time entries, schedules, tasks, or other records — which is virtually every real user. The fix requires either adding `onDelete: 'cascade'` to each FK in `shared/schema/index.ts` (and running a migration), or adding an explicit ordered-delete sequence in the backend route that removes all dependent rows before deleting the user. The Clerk deletion (best-effort) is acceptable as-is.

**Done looks like:** Any user with a full history of time entries, schedules, tasks, and kudos can successfully self-delete without a 500 error. The Clerk account is removed. The user is redirected to `/` and cannot log back in.

### Uploaded Video File Cleanup on Delete

**Purpose:** When a manager or admin deletes a training video from the AI Content Studio or Learning Center, the backing file in cloud storage should also be removed so orphaned files do not accumulate and accrue storage costs.

**Primary flow:**
1. Manager opens a video record and clicks Delete.
2. Frontend calls `DELETE /api/content/videos/:id` (or equivalent route).
3. Backend deletes the database record and should also delete the file from the storage backend.

**Key data / entities:** The video record (in the content/knowledge-doc tables) stores an `s3Key` (the storage object key). The `server/services/videoUpload.ts` service handles upload; deletion of the object is the missing counterpart.

**What already exists:** The database record is deleted correctly. The `s3Key` is available on the record at deletion time. The upload service already has the S3/storage client configured for writing.

**What is missing:** `server/services/videoUpload.ts` line ~110 logs `"S3 deletion not implemented — file remains in bucket"` and returns without calling `deleteObject`. The actual `s3.deleteObject({ Bucket, Key: s3Key })` call (or equivalent for whatever storage provider is configured) needs to be implemented and awaited before or after the DB row deletion. Error handling should be non-fatal (log the failure but still return success if only the file delete fails, since the DB record is already gone).

**Done looks like:** Deleting a video removes both the database record and the backing file from storage. Re-uploading a new video with the same name does not resurrect ghost content.

## Roadmap

Core operations ship first (Phase 1), then the AI intelligence layer (Phase 2), then advanced engagement, analytics, and reporting (Phase 3).

### Phase 1: Core Operations

- [x] Authentication and RBAC — Clerk OAuth, role-based access (Associate/Manager/Owner/Admin), per-user permission overrides
- [x] Employee profiles — HR metadata, documents, availability, pay rates, location assignment
- [x] Time clocking with geofencing — GPS radius/polygon enforcement, grace periods, auto clock-out, stale-location checker
- [x] Schedule management — weekly timeline UI, shift creation dialog with resizable split pane, conflict detection, published vs draft states
- [x] Task management — recurring and one-off tasks, AI-assisted assignment, priority, due dates, completion tracking
- [x] SOP library and execution — template builder, versioning, mobile checklist runner, completion tracking
- [x] Timesheets and pay period review — per-employee hour summaries, edit history, overtime flagging, off-site allowance
- [x] Payroll export — date-range picker, format presets (QuickBooks/Gusto/ADP/custom), CSV download via /api/timesheets/export
- [x] Push notifications — Web Push (VAPID) and Capacitor native token registration, anomaly and shift alerts
- [x] Offline mode — service worker + IndexedDB caching, background sync on reconnect
- [ ] Employee account hard-delete cascade — self-delete UI and basic backend route exist; FK cascade cleanup missing (partial: most related tables lack onDelete cascade, hard delete will fail for users with any records)

### Phase 2: AI Intelligence Layer

- [x] AI auto-scheduling — Claude-powered schedule generation using Shopify sales history, staffing tiers, availability, and zone minimums
- [x] AI task assignment — proactive daily task prioritization surfaced per employee based on context and performance
- [x] AI Morning Briefing — daily AI-generated store briefing for managers on the AdminOwner dashboard
- [x] Ask MAinager conversational AI — in-app chat with Claude for operational questions and decision support
- [x] AI Content Studio — manager hub for generating training content from uploaded documents
- [x] AI Learning Center — quiz generation from uploaded docs, daily quizzes, manager analytics
- [x] Holiday pay system — natural-language rule parser for automatic pay multipliers, holiday calendar UI
- [x] Anomaly detection — payroll and clock-in anomaly detection with push notification delivery
- [x] Overtime Prevention Engine — real-time projected overtime warnings per employee in timesheet view
- [x] SOP Evolution System — AI revision proposals for SOPs based on employee feedback and execution analytics
- [x] AI Cash Investigation Engine — AI-assisted drawer reconciliation discrepancy analysis

### Phase 3: Advanced Features and Reporting

- [x] Shopify sales integration — order webhook ingestion, 30-min reconciliation cron, historical backfill, refund/void handling
- [x] Digital cash management — denomination wizard, deposit slip capture, AI verification, advanced drawer reconciliation
- [x] Supply and inventory Kanban — two-bin visual stock levels, reorder threshold alerts, auto-generated reorder tasks
- [x] Gamification and leaderboards — composite performance score (attendance, tasks, SOPs, learning, engagement), tiers, per-employee score panel
- [x] Daily ritual system — Morning Huddle, Daily Debrief, and Kudos with AI-generated content
- [x] Lean board — team improvement tracking, daily snapshots, weekly AI summaries
- [x] Analytics dashboards — weekly sales vs goal comparison, labor cost breakdown, AI anomaly overlays, Owner/Admin real-time collapsible panels
- [x] RAG semantic search — pgvector SOP and knowledge-doc search with local Xenova embeddings
- [x] GTD inbox system — personal inbox, projects, and weekly review for managers
- [x] Role-specific dashboards — tailored home screens for Associates, Managers, and Owners/Admins
- [ ] Uploaded video file cleanup on delete — DB record removed on delete but backing S3/storage file never deleted (partial: deleteObject call missing in server/services/videoUpload.ts)
