# Taime

## Mission

Taime is an AI-powered boutique retail operations platform that replaces paper-based and manual processes with a single mobile-first PWA. It provides time clocking with GPS geofencing, AI-generated shift scheduling, task management, SOP execution, payroll review, and real-time business dashboards for independent boutiques (1–5 locations, 3–15 employees). Three user roles interact with tailored experiences: Associates clock in/out, complete tasks and SOPs, and see their own metrics; Managers run the floor, create schedules, approve time, and access AI briefings; Owners/Admins see the full financial and operational picture in real time. The stack is React/Vite + TypeScript on the frontend, Node/Express/TypeScript on the backend, PostgreSQL via Drizzle ORM, Clerk for auth, and Anthropic Claude for all AI features.

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

### Employee account hard-delete cascade

**Purpose:** Associates and managers can permanently delete their own account from Settings > Data & Privacy. Owners must transfer ownership first so a store is never left without an owner.

**Primary flow:**
1. User navigates to Settings > Data & Privacy and clicks "Delete account".
2. An AlertDialog asks them to type the word DELETE to confirm; the button is disabled until input matches exactly.
3. On confirm, the frontend calls `DELETE /api/account/self`.
4. The backend guards against last-owner deletion, then deletes dependent rows and finally the user row.
5. On success the frontend redirects to `/`.

**Key data / entities:** `users` is the root record. All tables with a `user_id` or `assigned_to` or `created_by` FK to `users.id` must be cleaned before the delete: `user_permission_overrides`, `location_permissions`, `user_availability_templates`, `user_availability_overrides`, `time_off_requests`, `schedules`, `time_entries`, `shift_swap_requests`, `schedule_audit_logs`, `tasks` (assigned_to / created_by), `task_responses`, `task_assignees`, `gtd_inbox_items`, `gtd_next_actions`, `gtd_projects`, `messages`, `thread_participants`, `kudos`, `employee_documents`, `sop_executions`, `employee_training_progress`, `mileage_reimbursements`, `payroll_period_adjustments`, `native_push_tokens`, `push_subscriptions`, `score_history`, `user_achievements`.

**Rules & edge cases:** If the deleting user is the sole owner of a store, return HTTP 409 and message "Transfer ownership before deleting your account." Clerk deletion is best-effort — if Clerk fails, the local user row is still removed and the response is still 200. Do not expose other users' data in the error message if a FK constraint fires. The operation should be wrapped in a DB transaction so a partial failure leaves nothing deleted.

**API shape:** `DELETE /api/account/self` — no request body. Responds `{ success: true }` or `{ error: "last-owner" }` (HTTP 409). Route already registered in `server/routes/users.ts`.

**Files to create or modify:**
- `server/routes/users.ts` — replace the current `db.delete(users)` call with a transaction that deletes all dependent rows in FK-safe order before deleting the user.
- `server/storage/identity.ts` — update `deleteUser()` to accept a DB transaction handle.
- `shared/schema/` — optionally add `onDelete: 'cascade'` to FK columns as an alternative approach (requires a migration).

**Current state:** The UI type-to-confirm dialog is complete and wired (`client/src/pages/EmployeeSettings.tsx`). The backend route exists in `server/routes/users.ts` and already deletes `native_push_tokens` and `push_subscriptions`, then calls `db.delete(users)`. The Clerk deletion attempt is also present.

**What is missing:** Dependent-row cleanup for the ~20 other tables listed above. Without it, `db.delete(users)` raises a Postgres FK violation for any user who has time entries, schedules, tasks, or kudos — which is every real user.

**Done looks like:**
1. A user with time entries, schedules, tasks, and kudos can self-delete without a 500 error.
2. After deletion, the user cannot log back in (Clerk account removed).
3. No orphan rows remain in any of the dependent tables listed above.
4. A user who is the sole owner receives a 409 with a clear message, not a crash.
5. The operation is atomic — no partial-delete state is possible.

---

### Multi-location employee assignment

**Purpose:** A single employee can be assigned to multiple store locations (e.g., a key holder who covers two stores). Currently every user has exactly one `location_id` FK on the `users` table; the domain model in `CONTEXT.md` explicitly calls `LocationAssignment` a target-state N:N join that is not yet implemented.

**Primary flow:**
1. Admin opens an employee profile and clicks "Assign to location" to add a second location.
2. The profile shows a list of assigned locations with the ability to remove any (except the last).
3. On the schedule page, the employee appears as a schedulable candidate for any of their assigned locations.
4. At clock-in, geofencing succeeds if the employee is within range of any assigned location; the matched location is recorded on the time entry.
5. Analytics and payroll remain scoped per-location using the location recorded on each time entry.

**Key data / entities (to be created):**
- `location_assignments` table: `id uuid PK`, `user_id uuid FK users.id`, `location_id uuid FK work_locations.id`, `assigned_by uuid FK users.id`, `assigned_at timestamptz`. Unique constraint on `(user_id, location_id)`.
- `users.location_id` FK is deprecated but kept for the migration seed and soft fallback.

**Rules & edge cases:** An employee must have at least one `location_assignment` to be schedulable or clock in. Removing the last assignment must require explicit confirmation. On migration, seed one `location_assignments` row per existing user from `users.location_id`. All route handlers that currently filter by `users.location_id` must be updated to JOIN through `location_assignments` instead. The geofencing check must iterate all assigned locations and accept the closest one within radius.

**API shape:**
- `GET /api/users/:id/locations` → `{ locations: WorkLocation[] }`
- `POST /api/users/:id/locations` body `{ locationId: string }` → 201 created assignment
- `DELETE /api/users/:id/locations/:locationId` → 200 or 409 (last location)

**Files to create or modify:**
- `shared/schema/locationAssignments.ts` — new Drizzle table definition.
- `server/routes/users.ts` — new assignment CRUD endpoints.
- `server/services/geofencingService.ts` — update geofence check to query all assigned locations.
- `server/routes/schedules.ts` / `server/routes/aiScheduling.ts` — update employee availability queries to use `location_assignments`.
- `client/src/pages/TeamMember.tsx` — add location assignment list and add/remove UI.
- Migration SQL file seeding `location_assignments` from `users.location_id`.

**Current state:** `users.location_id` is the only association. No `location_assignments` table. All scheduling, geofencing, and analytics code references `user.locationId` directly. CONTEXT.md explicitly notes this as a single-column limitation.

**What is missing:** The schema table, migration, updated queries across ~10 route files, and the profile UI for managing assignments.

**Done looks like:**
1. An employee can be assigned to two locations in the UI.
2. The schedule page shows them as a candidate for shifts at both locations.
3. Clock-in geofencing accepts them at either location and records the correct location on the time entry.
4. Removing the last location is blocked with a confirmation prompt.
5. Existing data is intact after the migration (no users lose their location association).

---

### AI scheduling drop reason tracking

**Purpose:** When the AI scheduling algorithm discards a candidate employee from a shift, the reason (unavailability, overtime risk, rest violation, etc.) is recorded per candidate so managers can understand why the schedule came out the way it did and trust AI-generated schedules.

**Primary flow:**
1. Manager triggers AI schedule generation for a week.
2. The scheduling engine evaluates each active schedulable employee against each open shift slot.
3. For every employee-slot combination that is rejected, a structured drop reason is added to the `drop_log` in the schedule output JSON.
4. The schedule is saved to `ai_suggested_schedules` with `drop_log` embedded in `schedule_data`.
5. Manager opens the schedule, clicks "Why wasn't [employee] scheduled Tuesday?" and sees the explainability panel.

**Key data / entities:** `ai_suggested_schedules.schedule_data` (jsonb) already stores the generated schedule. Add a top-level `drop_log` array to this JSON: each entry has `{ employee_id: string, date: string, start_time: string, end_time: string, reasons: DropReason[] }` where `DropReason` is an enum: `unavailable | overtime_risk | min_rest_violation | no_coverage_needed | role_mismatch | custom_rule`.

**Rules & edge cases:** `no_coverage_needed` (slot already filled) must be distinguished from `unavailable` (genuine conflict). If an employee is dropped for multiple reasons, record all of them — not just the first. Drop log must be manager-only; never expose it to Associates. Render the drop log lazily (load on demand) because it can be large for big rosters. Store employee IDs, not names, in the log.

**API shape:** No new routes needed. The drop log is embedded in the existing `ai_suggested_schedules` row. Add a GET query parameter to the existing schedule fetch: `GET /api/ai-scheduling/suggested/:id?include=drop_log` to opt in to the expanded payload.

**Files to create or modify:**
- `server/routes/aiScheduling.ts` — populate `drop_log` during the candidate evaluation loop (around line 1743 where the TODO comment exists).
- `shared/types/scheduling.ts` (or equivalent) — add `DropReason` enum and `DropLogEntry` type.
- `client/src/components/ScheduleTimelineView.tsx` or `CreateShiftSplitPanel.tsx` — add manager-only explainability panel that renders drop reasons per slot.

**Current state:** `server/routes/aiScheduling.ts` line ~1743 has a `// TODO: remove after task #420. Track per-row drop reasons so a` comment. No drop reasons are persisted anywhere. The schedule data JSON has no `drop_log` field.

**What is missing:** The drop reason collection loop inside the AI schedule generation function, and the frontend panel that reads and displays it.

**Done looks like:**
1. After generating a schedule, `ai_suggested_schedules.schedule_data` contains a `drop_log` array.
2. Managers can click any shift slot and see which employees were considered and why each was skipped.
3. Associates cannot see the drop log.
4. The data persists after the schedule is published and is still readable.
5. `no_coverage_needed` and `unavailable` are recorded as distinct reasons.

---

### Automation availability collection

**Purpose:** The payroll period automation workflow checks whether all schedulable employees have submitted availability before advancing to schedule generation. The current check uses a hardcoded stub instead of real database state.

**Primary flow:**
1. Automation service triggers at the `availability_collection` phase of a `PayrollPeriod`.
2. Service queries `availability_templates` and `user_availability_overrides` to determine which active, schedulable employees have submitted availability for the period's date range.
3. If all employees have submitted, advance the workflow state to `schedule_generation`.
4. If the deadline has passed with gaps, advance anyway and log the missing employee IDs as a warning.

**Key data / entities:** `payroll_periods` (`availability_deadline`, `workflow_state`), `availability_templates` (per-user recurring default availability), `user_availability_overrides` (per-user per-date overrides), `users` (`show_in_schedule`, `is_active`, `eligible_for_auto_scheduling`, `location_id` for store scoping).

**Rules & edge cases:** An employee is considered to have submitted if they have (a) an `availability_templates` row OR (b) at least one `user_availability_overrides` row for each day in the pay period. Employees with `show_in_schedule = false` or `eligible_for_auto_scheduling = false` must be excluded from the check. The check must be scoped by store (`location_id` / `company_id`) so multi-store deployments don't cross-contaminate. Never block the workflow indefinitely — always advance at deadline even with gaps.

**API shape:** No new routes. This is a change to the internal automation service method that evaluates the `availability_collection` phase.

**Files to create or modify:**
- `server/services/automationService.ts` — replace the stub `allUsers` array and "simplified check for demo" comment (~line 123) with a real query: `SELECT DISTINCT user_id FROM availability_templates WHERE store_id = ?` UNION `SELECT DISTINCT user_id FROM user_availability_overrides WHERE date BETWEEN ? AND ?` compared against the active schedulable users for the store.

**Current state:** `server/services/automationService.ts` line ~123 constructs a placeholder `allUsers` array and runs a "simplified check for demo" that does not query the database.

**What is missing:** Replace the stub with a real DB query using Drizzle that fetches the set of schedulable users for the store and compares against those who have submitted availability. Log missing user IDs when advancing past deadline.

**Done looks like:**
1. When all schedulable employees have an availability template or per-date overrides, the workflow automatically advances to `schedule_generation`.
2. When the deadline passes with gaps, the workflow advances and the server log includes a warning listing the missing employee IDs.
3. Employees with `show_in_schedule = false` are not counted in the check.
4. The check is scoped to the correct store and does not affect other stores.

---

### Uploaded video file cleanup

**Purpose:** When a manager or admin deletes a training video, the backing file in cloud storage should also be removed so orphaned files do not accumulate and accrue costs.

**Primary flow:**
1. Manager opens a video record and clicks Delete.
2. Frontend calls `DELETE /api/videos/:id`.
3. Backend reads `s3_key` and `storage_type` from the record, deletes the DB row, then calls the storage provider's delete API.
4. Returns 200 regardless of whether the storage delete succeeded (non-fatal error path).

**Key data / entities:** `improvement_videos` table stores `s3_key` (storage object key), `storage_type` (local | s3 | youtube), and `youtube_video_id`. The `server/services/videoUpload.ts` service already handles upload and local file deletion.

**Rules & edge cases:** Storage delete failure must be non-fatal — log the error but return 200 since the DB record is already gone. When `storage_type = 'youtube'`, call `youtube.videos.delete({ id: youtube_video_id })` via the YouTube Data API instead of S3. When `storage_type = 'local'`, `fs.unlinkSync` already works (this path is complete). Guard against null/empty `s3_key`.

**API shape:** `DELETE /api/videos/:id` — already exists. No shape change needed; only the implementation body changes.

**Files to create or modify:**
- `server/services/videoUpload.ts` — in the `deleteVideoFile(s3Key)` function, replace the `logger.warn("S3 deletion not implemented")` (line ~110) with `await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }))`. Add a parallel YouTube deletion branch for `storage_type = 'youtube'`.
- `server/routes/videos.ts` (or equivalent) — ensure the route reads `storage_type` and `youtube_video_id` before deleting the row, then passes them to `deleteVideoFile`.

**Current state:** The DB record is deleted correctly. `server/services/videoUpload.ts` has a `deleteVideoFile` function that handles the `local` storage path via `fs.unlinkSync` but logs `"S3 deletion not implemented — file remains in bucket"` and returns for the S3 path. No YouTube deletion exists.

**What is missing:** The `s3Client.send(new DeleteObjectCommand(...))` call in the S3 branch and a YouTube API delete call for the YouTube branch.

**Done looks like:**
1. Deleting a video removes both the DB record and the S3 object.
2. Deleting a YouTube-hosted video triggers a YouTube Data API delete call.
3. If the storage delete fails (e.g., object already gone), the route still returns 200 and logs a warning.
4. Deleting a local-storage video continues to work as before.

---

### Dashboard recovery notification

**Purpose:** When a dashboard widget that was showing an error (failed API call / network outage) successfully reconnects and reloads live data, the user sees a brief success toast confirming the card is back online. Currently cards recover silently.

**Primary flow:**
1. A dashboard card's TanStack Query fetch fails; the card shows its error state.
2. Network recovers; TanStack Query retries and the fetch succeeds.
3. The card transitions from error to showing live data.
4. A green toast fires: "[Card name] is back online."

**Key data / entities:** No new tables. Uses the existing `useToast` hook from `@/hooks/use-toast`. The recovery event is a TanStack Query `isError → false` transition detected via a `useEffect` that tracks previous `isError` state.

**Rules & edge cases:** The toast must fire only when `isError` transitions from `true` to `false` — not on every successful re-fetch. Use a `usePrevious` pattern or a `useRef` to track the previous value. If multiple cards recover simultaneously, each fires its own toast (no batching). The toast is dismissible and auto-closes after 3 seconds. The hook must be reusable so future dashboard cards get the behavior by adding one line.

**API shape:** No backend changes. Frontend-only hook.

**Files to create or modify:**
- `client/src/hooks/use-recovery-toast.ts` — create a `useRecoveryToast(isError: boolean, cardName: string)` hook that watches for the `isError → false` transition and calls `toast({ title: \`${cardName} is back online\`, variant: "success" })`.
- Every error-capable dashboard panel component (AdminOwnerDashboard panels, etc.) — add `useRecoveryToast(query.isError, "Floor Status")` (or relevant card name) call.

**Current state:** Dashboard cards show error states when queries fail and recover silently. No hook or effect detects the `isError → false` transition. The `useToast` hook is available at `@/hooks/use-toast`.

**What is missing:** The `useRecoveryToast` hook and its application to each dashboard panel.

**Done looks like:**
1. A card that was showing an error briefly displays "[Card name] is back online" as a green toast when data successfully reloads.
2. The toast does not fire on a normal page load or a successful re-fetch that was never in an error state.
3. Future cards can add recovery notification with a single `useRecoveryToast(query.isError, "My Card")` call.

---

### Stripe billing and subscriptions

**Purpose:** Enable the platform to charge boutique owners for access. Each Store has a Subscription with a 14-day free trial; after trial, clock-in/out continues working (regulatory compliance) while admin features lock until a plan is chosen. Three plans (Starter / Growth / Pro) grant different feature entitlements.

**Primary flow:**
1. New store completes onboarding; a Stripe Customer is created server-side and a `subscriptions` row is inserted with `status: trialing`.
2. AccountOwner opens Settings > Billing, picks a plan, and clicks Subscribe; frontend is redirected to a Stripe Checkout Session URL.
3. On success, Stripe fires `checkout.session.completed`; backend upserts the `subscriptions` row with `status: active` and writes `store_entitlements` rows for every feature key the plan grants.
4. All feature-gated routes and UI components check `store_entitlements` before rendering.
5. If payment fails, Stripe fires `invoice.payment_failed`; backend sets `status: past_due` and triggers in-app and email notifications.
6. AccountOwner can open the Stripe Customer Portal to update payment method, view invoices, or cancel.

**Key data / entities (to be created):**
- `subscriptions` table: `id uuid PK`, `store_id uuid FK work_locations.id UNIQUE`, `stripe_customer_id text`, `stripe_subscription_id text`, `plan text` (enum: starter | growth | pro), `status text` (enum: trialing | active | past_due | canceled | unpaid), `trial_ends_at timestamptz`, `current_period_end timestamptz`, `created_at timestamptz`, `updated_at timestamptz`.
- `store_entitlements` table already exists in `shared/schema/billing.ts` with `(store_id, feature_key, granted_at, updated_at)`.
- Plans config (not a DB table): a constant mapping plan keys to Stripe price IDs and feature-key arrays, e.g., `{ starter: { priceId: 'price_xxx', features: ['scheduling', 'timeclock'] } }`.

**Rules & edge cases:** `clock_in` and `clock_out` routes must remain unblocked regardless of subscription status (regulatory compliance). Entitlement check is separate from RBAC permission check — both must pass for a gated action. AccountOwner transfer must re-associate billing email in Stripe. After `canceled`, a 7-day grace period before locking features. Stripe webhook handler must verify the `Stripe-Signature` header before processing. The `subscriptions.store_id` is unique — one subscription per store.

**API shape:**
- `POST /api/billing/checkout` body `{ planId: string }` → `{ url: string }` (Stripe Checkout Session URL)
- `POST /api/billing/portal` → `{ url: string }` (Stripe Customer Portal URL)
- `POST /api/billing/webhook` — Stripe webhook receiver (raw body, `Stripe-Signature` header)
- `GET /api/billing/subscription` → current subscription state for the authenticated store
- Middleware: `requireEntitlement(featureKey: string)` applied to gated routes

**Files to create or modify:**
- `server/routes/billing.ts` — new file with all four routes above.
- `server/services/stripeService.ts` — new file wrapping Stripe SDK (customer create, checkout session, portal session, webhook event verification, entitlement sync).
- `shared/schema/billing.ts` — add `subscriptions` table definition.
- `server/index.ts` — register billing routes; add raw-body middleware for the webhook path before JSON parser.
- `client/src/pages/Billing.tsx` — new page: plan picker cards, current plan display, trial countdown, upgrade prompt.
- `client/src/components/EntitlementGate.tsx` — wrapper component that reads store entitlements and renders an upgrade prompt if the feature key is not granted.
- `package.json` — install `stripe` npm package.

**Current state:** CONTEXT.md defines the full domain model (Subscription, Plan, Entitlement, AccountOwner, Trial). `store_entitlements` table exists and can be read. No `subscriptions` table. No Stripe routes. No Stripe SDK installed. No webhook handler. No entitlement enforcement on any route.

**What is missing:** Everything listed under "Files to create or modify" above.

**Done looks like:**
1. A new store enters a 14-day trial automatically on signup.
2. After trial, the owner sees a billing prompt and can pick a plan, being redirected to Stripe Checkout.
3. After payment, the plan is active and all features unlock.
4. `invoice.payment_failed` transitions the subscription to `past_due` and shows a banner.
5. Clock-in/out works even when the subscription is `past_due` or `canceled`.

---

### Customer profiles and Style DNA

**Purpose:** Enable boutique staff to build rich customer profiles with purchase history, style preferences, sizes, and notes from real interactions. AI clusters customers by style archetype and surfaces win-back alerts for inactive customers. VIP alerts notify staff when a high-value customer is looked up.

**Primary flow:**
1. Staff opens customer search, finds or creates a customer record.
2. They log style preferences, sizes, and notes from the interaction.
3. Claude assigns a style archetype (bohemian, minimalist, statement, classic, etc.) based on notes and Shopify purchase history — run as a background job, not inline.
4. Manager dashboard surfaces win-back alerts for customers inactive 45+ days.
5. When a known VIP is looked up or checked in via Shopify POS, the on-duty associate receives a push notification.

**Key data / entities (to be created):**
- `customer_profiles`: `id uuid PK`, `store_id uuid FK work_locations.id`, `shopify_customer_id text` (nullable, dedup key), `first_name text`, `last_name text`, `email text`, `phone text`, `notes text`, `style_archetype text`, `sizes jsonb`, `last_visit_date date`, `total_spend_cents int`, `visit_count int`, `is_vip bool DEFAULT false`, `vip_threshold_cents int` (store-configurable), `birthday date`, `anniversary date`, `created_at timestamptz`, `updated_at timestamptz`.
- `customer_interactions`: `id uuid PK`, `customer_id uuid FK customer_profiles.id`, `employee_id uuid FK users.id`, `store_id uuid FK work_locations.id`, `interaction_date timestamptz`, `notes text`, `preference_tags text[]`, `created_at timestamptz`.

**Rules & edge cases:** `shopify_customer_id` is the dedup key when syncing from Shopify — upsert on that column. Style archetype is recomputed by Claude whenever `preference_tags` or Shopify purchase history changes (background job, not inline). Win-back alert fires once per customer per 45-day window. VIP status can be set manually or auto-promoted when `total_spend_cents` exceeds `vip_threshold_cents`. Customer data is per-Store; employees cannot access customer records from another store. Profile data is visible to Associates and above (not public).

**API shape:**
- `GET /api/customers?q=search&page=1` → paginated customer list
- `GET /api/customers/:id` → full customer profile with interaction history
- `POST /api/customers` body `{ firstName, lastName, email?, phone?, notes? }` → created profile
- `PATCH /api/customers/:id` → update profile fields
- `POST /api/customers/:id/interactions` body `{ notes, preferenceTags }` → log interaction
- `GET /api/customers/win-back-alerts` → customers inactive 45+ days (manager/owner only)
- `POST /api/customers/:id/vip` → toggle VIP status (manager/owner only)

**Files to create or modify:**
- `shared/schema/customers.ts` — new Drizzle table definitions for `customer_profiles` and `customer_interactions`.
- `server/routes/customers.ts` — new file with all routes listed above.
- `server/services/customerArchetypeService.ts` — new file: Claude prompt that takes purchase history + preference tags and returns a style archetype string.
- `server/services/shopifyService.ts` — add customer spend aggregation from `shopify_orders`.
- `client/src/pages/Customers.tsx` — new page: search/list view and profile detail view.
- `client/src/components/WinBackAlerts.tsx` — dashboard card surfacing inactive customers.

**Current state:** No schema tables. No routes. No UI. `shopify_orders` table exists and can provide Shopify customer IDs and purchase data as a basis for spend aggregation.

**What is missing:** Everything listed under "Files to create or modify" above.

**Done looks like:**
1. Staff can search, create, and update customer profiles.
2. Claude assigns a style archetype visible on the profile.
3. Manager dashboard shows win-back candidates (inactive 45+ days).
4. VIP push notification fires when a known VIP is looked up.
5. Shopify customer data syncs to profiles on the first interaction lookup.

---

### Report delivery time configuration

**Purpose:** Admins can choose what hour of day their scheduled analytics report is delivered rather than relying on a hardcoded time. The setting lives on `shopify_report_schedules` per store.

**Primary flow:**
1. Admin opens Admin Settings > Analytics Reports.
2. They see the current frequency, recipient, and a new "Delivery time" hour/minute picker.
3. They update the delivery time and save.
4. The report scheduler reads `delivery_hour` on each tick and fires when the current UTC hour matches.

**Key data / entities:** `shopify_report_schedules` table (`shop_domain`, `frequency`, `recipient_email`, `enabled`, `last_sent_at`). Missing column: `delivery_hour integer DEFAULT 8` (0–23, stored in UTC).

**Rules & edge cases:** `delivery_hour` is stored in UTC but displayed in the store's configured timezone from `company_settings.timezone`. If today's delivery hour has already passed when the admin saves a new value, the next run is the same hour tomorrow (no immediate fire). An `enabled = false` schedule can still have `delivery_hour` updated. Values outside 0–23 are rejected with a 422.

**API shape:**
- `PATCH /api/analytics/report-schedule` body `{ deliveryHour: number }` → updated schedule row

**Files to create or modify:**
- `shared/schema/analytics.ts` (or wherever `shopify_report_schedules` is defined) — add `delivery_hour integer DEFAULT 8 NOT NULL`.
- Migration SQL file.
- `server/routes/analytics.ts` — update the PATCH handler to accept and validate `deliveryHour`.
- `server/services/reportScheduler.ts` (or equivalent cron) — replace hardcoded hour constant with `schedule.delivery_hour` from the DB row.
- `client/src/pages/AdminSettings.tsx` (or analytics settings section) — add a time picker field for delivery hour.

**Current state:** The `shopify_report_schedules` table and scheduler service exist. The scheduler fires at a hardcoded hour. The settings UI shows frequency and recipient but not delivery time.

**What is missing:** The `delivery_hour` column, migration, UI picker, and scheduler reading from the DB value.

**Done looks like:**
1. Admin sets delivery time to 7 AM local time. The report arrives at 7 AM.
2. Changing the time takes effect on the next scheduled run (no immediate fire).
3. Values outside 0–23 are rejected.

---

### Multiple report recipients

**Purpose:** Admins can add multiple email addresses to receive the scheduled analytics report instead of being limited to one per store.

**Primary flow:**
1. Admin opens Analytics Report Settings and sees a list of current recipients (initially one).
2. They click "Add recipient", enter an email, and it is appended to the list.
3. They can remove any address. The list is saved.
4. When the report fires, it is sent to all configured addresses.

**Key data / entities:** `shopify_report_schedules.recipient_email` is a single `text` column. Change to `recipient_emails text[]` (Postgres array) OR add a `report_schedule_recipients` join table. The array approach is simpler given the small expected count (< 10 per store).

**Rules & edge cases:** Each email must pass Zod `.email()` validation on both frontend and backend. Duplicate addresses in the list are rejected with a 422. An enabled schedule with an empty recipients list is blocked (must have at least one address). The existing `recipient_email` value must be migrated as the first element of the new `recipient_emails` array. The mailer iterates the array and sends one email per recipient.

**API shape:**
- `PATCH /api/analytics/report-schedule` body `{ recipientEmails: string[] }` → updated schedule (extend existing endpoint)

**Files to create or modify:**
- `shared/schema/analytics.ts` — rename `recipient_email text` to `recipient_emails text[]`.
- Migration SQL: `ALTER TABLE shopify_report_schedules ADD COLUMN recipient_emails text[] DEFAULT '{}'; UPDATE shopify_report_schedules SET recipient_emails = ARRAY[recipient_email] WHERE recipient_email IS NOT NULL;`
- `server/routes/analytics.ts` — update validation and handler.
- `server/services/reportMailer.ts` — iterate `recipient_emails` and send one email per address.
- `client/src/pages/AdminSettings.tsx` — replace single email input with a list: add/remove fields.

**Current state:** Report scheduler sends to exactly one `recipient_email`. Settings form has a single email input.

**What is missing:** Schema column change, migration, updated mailer loop, and list UI.

**Done looks like:**
1. Admin adds three email addresses; all three receive the report when it fires.
2. Removing a recipient from the list stops delivery to that address.
3. Duplicate addresses are rejected in the form.
4. An empty recipient list blocks enabling the schedule.

---

### Clock-in snooze configuration

**Purpose:** Managers can configure how long the clock-in prompt snooze lasts (currently hardcoded) so the re-prompt interval can be tuned per store.

**Primary flow:**
1. Admin opens Admin Settings > Time Clock.
2. They see a "Clock-in snooze duration" field (minutes, 1–60, default 5).
3. They save the value; it is written to `company_settings.clock_in_snooze_minutes`.
4. When an employee snoozes the clock-in prompt, the re-prompt fires after the configured duration.

**Key data / entities:** `company_settings` table — add `clock_in_snooze_minutes integer DEFAULT 5 NOT NULL`.

**Rules & edge cases:** Min 1, max 60; values outside this range are rejected with a 422. The setting is store-wide. The snooze timer starts from the moment the employee taps Snooze, not from when the notification was delivered. If the employee manually clocks in during the snooze window, the pending re-prompt must be cancelled.

**API shape:**
- `PATCH /api/settings/company` body `{ clockInSnoozeMinutes: number }` → updated settings (extend existing endpoint)

**Files to create or modify:**
- `shared/schema/companySettings.ts` (or wherever the table is defined) — add `clock_in_snooze_minutes integer DEFAULT 5 NOT NULL`.
- Migration SQL file.
- `server/routes/settings.ts` — validate and persist the new field.
- Clock-in notification/prompt service (whichever module schedules the re-prompt) — replace hardcoded snooze constant with `settings.clock_in_snooze_minutes` fetched from DB.
- `client/src/pages/AdminSettings.tsx` (Time Clock section) — add a number input for snooze duration.

**Current state:** Snooze duration is hardcoded in the clock-in prompt logic. `company_settings` has many configurable time clock fields and is the correct home for this setting.

**What is missing:** The schema column, migration, settings UI field, and the prompt logic reading from DB.

**Done looks like:**
1. Admin sets snooze to 15 minutes. Employees who snooze are re-prompted 15 minutes later.
2. The old hardcoded default is replaced and existing stores default to 5 minutes.
3. Values outside 1–60 are rejected.

---

### Background snooze location check

**Purpose:** While a clock-in prompt is snoozed, the app re-verifies the employee's location before re-showing the prompt. If they have left the geofence, the re-prompt is suppressed and a geofence-exit event is logged.

**Primary flow:**
1. Employee is within geofence and snoozes the clock-in prompt.
2. At snooze expiry, before re-showing the prompt, the app checks the employee's current location via Capacitor Geolocation.
3. If still within geofence: prompt re-appears.
4. If outside geofence: prompt is suppressed; a `geofence_out` event is written to `geofence_events`.
5. If location is unavailable (permission denied / hardware off): assume still at store and show prompt.

**Key data / entities:** `geofence_events` table (`event_type: geofence_in | geofence_out`, `user_id`, `location_id`, `latitude`, `longitude`, `timestamp`). `work_locations` (`latitude`, `longitude`, `radius`). Uses `@capacitor/geolocation`.

**Rules & edge cases:** Requires `always` location permission on iOS for background check; fall back to foreground check on next app resume if only `whenInUse` is granted, and show a one-time prompt explaining why background access improves the experience. Perform exactly one location check at snooze expiry — do not poll continuously during the snooze. Use the same Haversine distance formula as the regular clock-in check. The geofence check must handle the case where the employee is assigned to multiple locations (see Multi-location feature) — succeed if within range of any assigned location.

**API shape:** No new backend routes needed. The location check runs client-side via Capacitor Geolocation. The `geofence_out` event is logged via the existing `POST /api/geofence/event` endpoint (or equivalent).

**Files to create or modify:**
- `client/src/hooks/useClockInSnooze.ts` (or equivalent snooze logic) — at snooze expiry, call `Geolocation.getCurrentPosition()` and run the Haversine check before re-displaying the prompt.
- `client/src/lib/geofence.ts` (or wherever the Haversine check lives) — export the distance function so it can be reused by the snooze check without duplicating logic.

**Current state:** The clock-in snooze fires a re-prompt after the configured interval without re-checking location.

**What is missing:** A location re-check call at snooze expiry before re-showing the prompt, and a geofence-exit event log if the employee has moved outside.

**Done looks like:**
1. Employee snoozes, walks to their car, and is still outside when snooze expires — prompt does not re-appear.
2. Employee snoozes, stays on-site — prompt re-appears correctly.
3. A `geofence_out` event is written when the re-check detects the employee is outside.
4. Location unavailability (denied permission) results in the prompt being shown, not silently suppressed.

---

### Native app branding assets

**Purpose:** Replace the placeholder icon and splash screen images with final branded assets so the Taime app can be submitted to the Apple App Store and Google Play Store without asset-rejection failures.

**Primary flow:**
1. Designer provides a 1024×1024 PNG icon (no transparency, no rounded corners) and a 2732×2732 PNG splash screen.
2. Files are placed at `resources/icon.png` and `resources/splash.png` in the repo root.
3. Run `npx @capacitor/assets generate` to produce all platform-specific variants.
4. Rebuild the iOS and Android Capacitor shells and verify in simulators before store submission.

**Key data / entities:** No database changes. Filesystem paths: `resources/icon.png` (1024×1024), `resources/splash.png` (2732×2732), `ios/App/App/Assets.xcassets/AppIcon.appiconset/`, `android/app/src/main/res/mipmap-*/ic_launcher*.png`.

**Rules & edge cases:** The icon must have no transparency (App Store rejects transparent icons). The splash background color must match the app's CSS `--background` variable and `capacitor.config.ts SplashScreen.backgroundColor` so there is no color flash during launch. The `@capacitor/assets` CLI generates all resolution variants from the single source files.

**API shape:** No routes. This is a build-time asset task.

**Files to create or modify:**
- `resources/icon.png` — replace placeholder with final 1024×1024 brand icon.
- `resources/splash.png` — replace placeholder with final 2732×2732 splash image.
- Run `npx @capacitor/assets generate` to populate `ios/` and `android/` asset directories.

**Current state:** `resources/icon.png` and `resources/splash.png` exist as placeholder files (noted in `CAPACITOR_NOTES.md` and `submit.md`). The Capacitor shell is otherwise configured and functional.

**What is missing:** The final branded asset files from a designer. Once placed, `npx @capacitor/assets generate` takes ~30 seconds and produces all variants.

**Done looks like:**
1. `npx @capacitor/assets generate` completes without errors.
2. The app icon shows the Taime brand on the device home screen.
3. The splash screen shows the correct branded background during launch.
4. Both iOS and Android builds pass asset validation in their store submission tools.

---

## Roadmap

Phases ordered to ship a working product first, then layer AI intelligence, engagement, and enterprise billing.

### Phase 1: Core Operations

- [x] User authentication — Clerk OAuth, role-based access, 30+ granular permissions, per-user overrides
- [x] Employee profiles — HR metadata, documents, availability, pay rates, location assignment
- [x] Time clocking with geofencing — GPS radius/polygon enforcement, grace periods, auto clock-out
- [x] Schedule management — weekly timeline UI, shift creation, conflict detection, mobile pinch-zoom
- [x] Task management — recurring and one-off tasks, multi-assignee support, priority, due dates
- [x] SOP library and execution — template builder, versioning, mobile checklist runner
- [x] Timesheets and pay period review — hour summaries, edit history, overtime flagging, off-site allowance
- [x] Payroll export — date-range picker, format presets (QuickBooks/Gusto/ADP/custom), CSV download
- [x] Push notifications — Web Push VAPID and Capacitor native tokens, anomaly and shift alerts
- [x] Offline mode — service worker and IndexedDB caching, background sync on reconnect
- [ ] Employee account hard-delete cascade — self-delete UI exists but FK violations crash the delete for users with history. (partial: dependent tables lack cascade or ordered cleanup)
- [ ] Multi-location employee assignment — single location_id FK; N:N location_assignments join table needed. (partial: domain model in CONTEXT.md, no schema table yet)

### Phase 2: AI Assistants and Scheduling

- [x] AI auto-scheduling — Claude schedule generation from Shopify sales history, staffing tiers, availability
- [x] Smart task suggestions — proactive daily task prioritization via ARA assistant per employee
- [x] Morning Whisper briefing — Claude-generated manager briefing on yesterday's performance and today's priorities
- [x] Ask MAinager conversational AI — in-app chat with Claude for operational questions
- [x] AI Content Studio — manager hub for generating SOPs and training content from documents
- [x] AI Learning Center — quiz generation from docs, daily quizzes, spaced repetition, manager analytics
- [x] Holiday pay system — natural-language rule parser for pay multipliers, holiday calendar UI
- [ ] AI scheduling drop reason tracking — candidate evaluation loop records no drop reasons; explainability panel missing. (partial: TODO at aiScheduling.ts:1743)

### Phase 3: AI Monitoring and Analysis

- [x] Anomaly detection — payroll and clock-in anomaly detection with push notification delivery
- [x] Overtime Prevention Engine — real-time projected overtime warnings per employee in timesheet view
- [x] SOP Evolution System — AI revision proposals for SOPs based on execution feedback and analytics
- [x] AI Cash Investigation Engine — AI-assisted drawer reconciliation discrepancy analysis
- [x] Background insights engine — continuous background analysis with proactive dashboard cards
- [x] Operational insights — AI recommendations with dismissal, acknowledgment, and task-link actions
- [ ] Automation availability collection — uses a stub instead of real DB query to check employee submissions. (partial: simplified demo check in automationService.ts:~123)

### Phase 4: Advanced Operations

- [x] Shopify sales integration — order webhooks, 30-min reconciliation cron, historical backfill, refund handling
- [x] Digital cash management — denomination wizard, deposit slip AI capture, drawer reconciliation
- [x] Supply and inventory Kanban — two-bin stock levels, reorder alerts, auto-generated reorder tasks
- [x] Gamification and leaderboards — composite performance score, tiers, achievements, score panel
- [x] Daily ritual system — Morning Huddle, Daily Debrief, Kudos, Daily Quote, Midday Pulse
- [x] Lean board — team improvement tracking, daily snapshots, weekly AI summaries
- [x] Analytics dashboards — weekly sales vs goal, labor cost breakdown, AI anomaly overlays
- [x] RAG semantic search — pgvector SOP and knowledge-doc search with local Xenova embeddings
- [x] Mileage reimbursement — route tracking, deviation detection, per-session reimbursement, admin review
- [x] Payroll intelligence — AI pay period analysis, discrepancy flagging, overtime prevention
- [ ] Uploaded video file cleanup — DB record removed on delete but S3 file is never deleted; deleteObject missing. (partial: local delete works, S3 branch logs "not implemented" at videoUpload.ts:110)

### Phase 5: Communication and Engagement

- [x] In-app messaging — real-time thread-based messaging, DMs, group chats, emoji reactions
- [x] Kudos wall — peer-to-peer recognition feed, kudo categories, integrated into messaging
- [x] Improvement video platform — 60-second improvement videos with likes, comments, featured status
- [x] Issue tracker — one-tap issue logging, assignment workflow, comments, AI SOP auto-link
- [x] Meetings with AI synopsis — audio transcript, AI summary, action items into GTD inbox
- [x] GTD workflow engine — universal inbox, AI clarification, projects, next actions, weekly review
- [x] Store QA knowledge assistant — employees ask questions answered by Claude from SOPs and docs
- [ ] Dashboard recovery notification — cards recover silently after network outage; recovery toast missing. (partial: error states work, success transition has no notification hook)

### Phase 6: Enterprise and Billing

- [x] Training Hub and Training Player — video lessons, progress tracking, quiz scoring, spaced repetition
- [x] Morning Learning Moments — daily AI tip and quiz delivered to all staff with answer tracking
- [x] AI spend tracking and budgets — per-store cost metering, budget limits, alert thresholds, hard-block
- [x] Role-specific dashboards — tailored home screens for Associates, Managers, and Owners/Admins
- [ ] Stripe billing and subscriptions — no Stripe SDK, no subscriptions table, no webhook handler; complete greenfield build. (not started)
- [ ] Customer profiles and Style DNA — no schema, no routes, no UI; full product spec in SPECIFICATION.md. (not started)
- [ ] Report delivery time configuration — delivery hour hardcoded; shopify_report_schedules needs delivery_hour column and UI. (partial)
- [ ] Multiple report recipients — recipient_email is single-value; schema and UI need array support. (partial)
- [ ] Clock-in snooze configuration — snooze duration hardcoded; company_settings needs clock_in_snooze_minutes column. (partial)
- [ ] Background snooze location check — snooze re-prompt fires without geofence re-verification. (partial)
- [ ] Native app branding assets — placeholder icon and splash images need final branded assets for store submission. (not started)
