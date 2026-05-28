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

### Employee Account Hard-Delete Cascade

**Purpose:** Associates and managers can permanently delete their own account from Settings > Data & Privacy. Owners must transfer ownership first so a store is never left without an owner.

**Primary flow:**
1. User navigates to Settings > Data & Privacy and clicks "Delete account".
2. An `AlertDialog` asks them to type the word "DELETE" to confirm. The confirm button is disabled until the text matches exactly.
3. On confirm, the frontend calls `DELETE /api/account/self`.
4. The backend (in `server/routes/users.ts`) guards against last-owner deletion, then calls `storage.deleteUser(userId)` which runs `db.delete(users).where(eq(users.id, userId))`.
5. After success the frontend redirects to the landing page (`/`).

**Key data / entities:** `users` table is the root. Related records referencing `users.id` span: `user_permission_overrides`, `location_permissions`, `availability_templates`, `user_availability_overrides`, `time_off_requests`, `schedules`, `time_entries`, `task_assignees`, `tasks` (assigned_to / created_by), `gtd_inbox_items`, `gtd_projects`, `gtd_next_actions`, `messages`, `thread_participants`, `kudos`, `employee_documents`, `sop_executions`, `employee_training_progress`, `mileage_reimbursements`, `native_push_tokens`, `push_subscriptions`, `score_history`, `user_achievements`.

**Rules & edge cases:** If the deleting user is the sole owner of a store, the route must reject with HTTP 409 and prompt them to transfer ownership first. Clerk deletion (best-effort) is acceptable as-is — if Clerk fails, the local user row is still removed.

**Current state:** The UI confirmation dialog (type-to-confirm pattern) is complete and wired. The backend route exists, deletes `native_push_tokens` and `push_subscriptions`, runs `db.delete(users)`, and attempts a Clerk user deletion.

**What is missing:** The vast majority of FK columns referencing `users.id` in `shared/schema/` have no `onDelete: 'cascade'` directive in the Drizzle schema, so Postgres raises a foreign key violation on the final `db.delete(users)` for any user who has time entries, schedules, tasks, or other records — which is virtually every real user. Fix requires either adding `onDelete: 'cascade'` to each FK in the relevant schema files and running a migration, or adding an explicit ordered-delete sequence in the backend route that removes all dependent rows before deleting the user.

**Done looks like:** Any user with a full history of time entries, schedules, tasks, and kudos can successfully self-delete without a 500 error. The Clerk account is removed. The user is redirected to `/` and cannot log back in.

---

### Uploaded Video File Cleanup on Delete

**Purpose:** When a manager or admin deletes a training video from the Improvement Video platform or AI Content Studio, the backing file in storage should also be removed so orphaned files do not accumulate and accrue storage costs.

**Primary flow:**
1. Manager opens a video record and clicks Delete.
2. Frontend calls `DELETE /api/videos/:id` (or equivalent route).
3. Backend deletes the database record and should also delete the file from storage.

**Key data / entities:** `improvement_videos` table stores `s3_key` (the storage object key) and `storage_type` (local vs S3). The `server/services/videoUpload.ts` service handles upload; deletion of the object is the missing counterpart.

**Rules & edge cases:** Error handling for the file delete should be non-fatal — log the failure but still return HTTP 200 if only the file delete fails, since the DB record is already gone. When `storage_type` is `youtube`, the YouTube Data API `videos.delete` call should be made instead.

**Current state:** The database record is deleted correctly. The `s3_key` is available on the record at deletion time. `server/services/videoUpload.ts` already has `deleteVideoFile(s3Key)` which handles the local-file path correctly (`fs.unlinkSync`). However, line 110 logs `"S3 deletion not implemented — file remains in bucket"` and returns without calling `deleteObject`.

**What is missing:** The actual `s3.deleteObject({ Bucket, Key: s3Key })` call (using the same AWS SDK client the upload path uses) in the `deleteVideoFile` function's S3 branch. Also, YouTube video deletion via `youtube.videos.delete({ id: youtubeVideoId })` when `storage_type === 'youtube'`.

**Done looks like:** Deleting a video removes both the database record and the backing file from storage (S3 or YouTube). Re-uploading a video with the same name does not resurrect ghost content. Deletion failure on the storage side is logged but does not cause the endpoint to return an error.

---

### Stripe Billing and Subscription Management

**Purpose:** Enable the platform to charge boutique owners for access. Each Store has a Subscription with status `trialing | active | past_due | canceled | unpaid`. A 14-day free trial gives full feature access; after that, clock-in/out continues to work (compliance) while admin features lock until a Plan is chosen. There are three Plans (Starter / Growth / Pro) with different feature-key arrays. An AccountOwner is the Stripe billing payer — exactly one per Store and reassignable.

**Primary flow:**
1. New store completes onboarding; a Stripe Customer is created server-side and a `subscriptions` row is inserted with `status: trialing`.
2. On the Onboarding / Settings > Billing page the AccountOwner picks a Plan and clicks Subscribe; the frontend is redirected to a Stripe Checkout Session URL.
3. On success, Stripe fires a `checkout.session.completed` webhook; the backend upserts the `subscriptions` row with `status: active` and writes `store_entitlements` rows for every feature key the Plan grants.
4. All feature-gated routes and UI components check `store_entitlements` before rendering (Entitlement check is separate from RBAC Permission check — both must pass).
5. Shopify store domain is pre-filled in the onboarding form if a Shopify connection already exists.
6. If payment fails, Stripe fires `invoice.payment_failed`; the backend sets `status: past_due` and triggers in-app and email notifications.

**Key data / entities:** Needs a `subscriptions` table: `id`, `store_id` (FK work_locations.id), `stripe_customer_id`, `stripe_subscription_id`, `plan` (enum: starter/growth/pro), `status` (enum), `trial_ends_at`, `current_period_end`, `created_at`, `updated_at`. `store_entitlements` already exists (`store_id`, `feature_key`, `granted_at`, `updated_at`). Needs a `plans` constant/config (not a DB table) mapping plan keys to feature-key arrays and Stripe price IDs.

**Rules & edge cases:** Permission resolution rule from CONTEXT.md: `PermissionOverride` row → role default → deny. Entitlement resolution is separate: `store_entitlements` row for `(store_id, feature_key)` → deny. A feature is accessible only when the Store has the Entitlement AND the User has the Permission. After trial expires, `clock_in` and `clock_out` routes must remain unblocked regardless of entitlement status. AccountOwner transfer must re-associate the Stripe Customer's billing email.

**Current state:** CONTEXT.md defines the full domain model (Subscription, Plan, Entitlement, AccountOwner, Trial). `store_entitlements` table exists in `shared/schema/billing.ts` and can be read. No `subscriptions` table exists in the schema. No Stripe routes exist in `server/routes/`. No Stripe SDK is installed. No Stripe webhook handler exists.

**What is missing:** Everything: Stripe SDK installation, `subscriptions` schema table and migration, `server/routes/billing.ts` (create checkout session, customer portal, webhook handler), entitlement enforcement middleware or hook that reads `store_entitlements` on every gated request, and frontend billing UI (plan picker, current plan display, upgrade prompts, trial countdown).

**Done looks like:** A new store enters a 14-day trial automatically. After trial, the owner sees a billing prompt, can pick a plan, and is redirected to Stripe Checkout. After payment, feature access resumes. Stripe webhooks correctly transition subscription status. Feature-gated pages show an upgrade prompt instead of the feature when the Store lacks the entitlement.

---

### Customer Profiles / Style DNA

**Purpose:** Enable boutique staff to build rich customer profiles with purchase history, style preferences, sizes, and notes captured from real interactions. AI clusters customers by style archetype and surfaces win-back alerts for customers who haven't visited recently. VIP alerts notify staff when a high-value customer enters. This module is entirely absent from the current codebase — it exists only in the product specification.

**Primary flow:**
1. Staff member opens a customer record (or creates one from the customer search screen) during or after an interaction.
2. They log style preferences ("Loves bold prints, size 8"), note the customer's purchase, and save.
3. AI clusters the customer into a style archetype (bohemian, minimalist, statement, classic, etc.) based on purchase history and notes.
4. Manager dashboard surfaces win-back alerts for customers inactive 45+ days and birthday/anniversary reminders.
5. If a recognized customer with VIP status enters, staff receive a real-time push notification.

**Key data / entities (to be created):**
- `customer_profiles`: `id`, `store_id` (FK work_locations.id), `shopify_customer_id` (nullable), `first_name`, `last_name`, `email`, `phone`, `notes`, `style_archetype`, `sizes`, `last_visit_date`, `total_spend_cents`, `visit_count`, `is_vip`, `birthday`, `anniversary`, `created_at`, `updated_at`.
- `customer_interactions`: `id`, `customer_id` (FK customer_profiles.id), `employee_id` (FK users.id), `store_id`, `interaction_date`, `notes`, `preference_tags`, `created_at`.
- `customer_purchase_items`: summarized from Shopify purchase history, joined to `shopify_orders`.

**Rules & edge cases:** Profile data is per-Store. Shopify customer ID is the deduplication key when syncing from Shopify. Style archetype must be re-computed by Claude whenever purchase history or preference tags change (background job, not inline). Win-back alerts fire once per customer per 45-day window, not on every load. VIP status is set manually by staff or automatically when `total_spend_cents` exceeds a configurable threshold.

**Current state:** No schema tables. No routes. No UI. Shopify orders are synced (`shopify_orders` table exists) and can provide purchase data as a basis for customer spend aggregation.

**What is missing:** Everything: schema tables, migration, `server/routes/customers.ts`, AI archetype-clustering service, frontend customer profile page and search, win-back alert cron job, VIP push notification trigger.

**Done looks like:** Staff can search, create, and update customer profiles. Claude assigns a style archetype visible on the profile. Manager dashboard shows win-back candidates. When a known VIP is looked up (e.g., from Shopify POS check-in), the on-duty associate receives a push notification.

---

### Multi-Location Employee Assignment

**Purpose:** A single employee should be assignable to multiple Locations (e.g., a key holder who covers two stores). Currently a User is tied to exactly one Location via `users.locationId`. All scheduling, geofencing, clock-in, and reporting logic assumes this single-location model. The domain model in CONTEXT.md explicitly calls this "target-state vocabulary" (LocationAssignment) and flags it as a future N:N join table.

**Primary flow:**
1. Admin opens an employee profile and assigns them to one or more Locations.
2. The schedule page shows the employee as available to be placed in shifts at any assigned Location.
3. Clock-in geofencing checks against all of the employee's assigned Locations and succeeds if the employee is within range of any of them.
4. Time entries, payroll, and analytics continue to be scoped per-Location (the Location is recorded on the time entry at clock-in).

**Key data / entities (to be created):**
- `location_assignments`: `id`, `user_id` (FK users.id), `location_id` (FK work_locations.id), `assigned_by` (FK users.id), `assigned_at`. Unique on `(user_id, location_id)`.
- Deprecate `users.locationId` FK in favor of reading from `location_assignments`.

**Rules & edge cases:** An employee must have at least one LocationAssignment to be schedulable or to clock in. Removing the last LocationAssignment should require confirmation. When LocationAssignment is introduced, all existing `users.locationId` values should be migrated to seed `location_assignments` rows. Features that currently `JOIN` through `users.locationId` need to be updated to use the new table.

**Current state:** `users.location_id` FK to `work_locations.id` is the only association. No `location_assignments` table exists. All scheduling, geofencing, and analytics code references `user.locationId` directly. CONTEXT.md explicitly notes this is a single-column limitation to be resolved.

**What is missing:** `location_assignments` schema table, migration seeding from `users.location_id`, updates to all routes and storage methods that filter by location, and frontend UI to display and edit multiple location assignments on the employee profile.

**Done looks like:** An employee can be assigned to two Locations. The schedule page shows them as a candidate for shifts at both Locations. Clock-in geofencing accepts them at either Location. Analytics correctly attributes hours to the Location where they clocked in.

---

### Scheduled Analytics Report Delivery Time Configuration

**Purpose:** Admins can choose what time of day (hour) their scheduled analytics report is delivered, rather than having a hardcoded delivery time. This affects the `shopify_report_schedules` row for the store.

**Primary flow:**
1. Admin navigates to Admin Settings > Analytics Reports.
2. They see the current frequency, recipient email, and delivery time.
3. They update the delivery time with an hour/minute picker.
4. The backend updates `shopify_report_schedules.delivery_hour` (column to be added) and the cron scheduler re-evaluates the next run.

**Key data / entities:** `shopify_report_schedules` table (`shop_domain`, `frequency`, `recipient_email`, `enabled`, `last_sent_at`). Missing column: `delivery_hour` (integer 0–23, default 8).

**Rules & edge cases:** Only one schedule row exists per store (`shop_domain` is unique). `delivery_hour` should be stored in UTC at the server but displayed in the store's configured timezone (`company_settings.timezone`) in the UI. If the store's next scheduled run has already passed today's delivery time, the next run should be the same hour on the next scheduled day — not immediate. An `enabled = false` schedule should still allow updating `delivery_hour` so the setting is ready when re-enabled.

**Current state:** The `shopify_report_schedules` table and report scheduler exist. The report fires at a hardcoded hour in the scheduler service. The settings UI shows frequency and recipient but not delivery time.

**What is missing:** `delivery_hour` column on `shopify_report_schedules`, migration, UI picker in the analytics report settings form, and scheduler logic that reads `delivery_hour` instead of a constant.

**Done looks like:** Admin sets delivery time to 7 AM. The scheduled report arrives at 7 AM on the configured day. Changing the time takes effect on the next scheduled run.

---

### Multiple Analytics Report Recipients

**Purpose:** Admins can add multiple email addresses to receive the scheduled analytics report, rather than being limited to one recipient per store.

**Primary flow:**
1. Admin opens Analytics Report Settings and sees a list of current recipients (initially one).
2. They click "Add recipient" and enter an email address.
3. Each address is validated. The list is saved.
4. When the report fires, it is sent to all configured recipients.

**Key data / entities:** Currently `shopify_report_schedules.recipient_email` is a single `text` column. This needs to become `recipient_emails text[]` (array) or a separate `report_schedule_recipients` join table.

**Rules & edge cases:** Each email address must be validated as a proper email format before saving (Zod `.email()` on the frontend and backend). Duplicate addresses in the list should be rejected. The list may be empty only if `enabled = false`; an enabled schedule with no recipients should be blocked. The existing `recipient_email` column value must be migrated as the first element of the new array during the schema migration.

**Current state:** The report scheduler sends to exactly one `recipient_email`. The settings form has a single email input field.

**What is missing:** Schema change to support multiple recipients (array column or join table), migration, updated UI for the recipient list (add/remove), and updated mailer logic to iterate over all recipients.

**Done looks like:** Admin adds three email addresses. All three receive the report when it fires. Removing a recipient from the list stops future delivery to that address.

---

### Dashboard Card Network Recovery Notification

**Purpose:** When a dashboard widget that had gone offline (e.g., Floor Status, Sales vs. Goal) successfully reconnects and re-fetches live data, the user sees a brief, non-intrusive success toast confirming the card is back online. Currently, cards silently recover without any acknowledgment.

**Primary flow:**
1. Network drops or API call fails; the dashboard card shows an error/offline state.
2. Network recovers; TanStack Query retries and succeeds.
3. The card transitions from error state to showing live data.
4. A toast notification fires: "Floor Status is back online."

**Key data / entities:** No new tables. Uses the existing `useToast` hook from `@/hooks/use-toast`. The recovery trigger is the TanStack Query `onSuccess` callback (or `isError → false` transition).

**Rules & edge cases:** The toast should only fire when a card transitions from an error state to a success state — not on every successful re-fetch. This means the hook must track the previous `isError` value and only trigger when it transitions from `true` to `false`. The toast should be a brief success (green) notification, not a full dialog. If multiple cards recover simultaneously (e.g., network outage resolves), they should each show their own toast rather than being batched — this keeps the recovery signal per-card and specific.

**Current state:** Dashboard cards show error states when queries fail and recover silently. There is no hook or pattern that fires a notification when a failed query transitions back to success. The existing tasks list has "Notify users when their dashboard cards recover after coming back online" and "Make network recovery automatic for any new dashboard cards added in the future."

**What is missing:** A reusable `useRecoveryToast(queryResult, cardName)` hook that watches for `isError → false` transitions and fires a toast. The hook must be applied to every error-capable dashboard panel, and a pattern or provider must make it easy to apply to future cards automatically.

**Done looks like:** A card that was showing an error briefly shows "Floor Status is back online" as a green toast when data successfully reloads. Future cards added to the dashboard pick up the recovery notification automatically without per-card wiring.

---

### Clock-In Snooze Duration Configuration

**Purpose:** Managers can configure how long the clock-in prompt snooze lasts (currently hardcoded). The snooze is the grace period after an employee dismisses the clock-in push notification before being re-prompted.

**Primary flow:**
1. Admin/Manager opens Admin Settings > Time Clock.
2. They see a "Clock-in snooze duration" setting with a number input (minutes, 1–60).
3. They save the value; it is stored in `company_settings`.
4. When an employee snoozes the clock-in prompt, the re-prompt fires after the configured duration instead of a hardcoded value.

**Key data / entities:** `company_settings` table (column `clock_in_snooze_minutes` integer, default 5, to be added).

**Rules & edge cases:** The minimum snooze value should be 1 minute and the maximum 60 minutes; values outside that range should be rejected with a validation error. The setting applies store-wide (all employees at the location inherit the same snooze duration). The snooze timer starts from the moment the employee taps "Snooze", not from when the notification was originally delivered. If the employee manually opens the app and clocks in during the snooze window, the pending re-prompt must be cancelled.

**Current state:** The snooze duration is hardcoded in the clock-in notification or prompt logic. `company_settings` already has many configurable time clock fields and is the correct home for this setting.

**What is missing:** `clock_in_snooze_minutes` column in `company_settings` schema, migration, UI field in the Time Clock settings section, and backend/frontend clock-in prompt logic reading the configurable value.

**Done looks like:** Admin sets snooze to 15 minutes. When an employee snoozes the clock-in prompt, they are re-prompted 15 minutes later instead of the old default.

---

### Background Location Re-check During Clock-In Snooze

**Purpose:** While a clock-in prompt is snoozed, the app should continue checking the employee's location in the background. If the employee leaves the geofence during the snooze window, the re-prompt should be suppressed or adjusted accordingly.

**Primary flow:**
1. Employee is within geofence, snoozes clock-in prompt.
2. During the snooze window, the app (via Capacitor background geolocation or a periodic foreground check on app resume) re-verifies location.
3. If employee is still in geofence when snooze expires, the prompt re-appears.
4. If employee has left the geofence, the prompt is not shown and the geofence-exit event is logged.

**Key data / entities:** `geofence_events` table (event_type: `geofence_in | geofence_out`). `location_permissions` table for tracking permission state. Uses Capacitor `@capacitor/geolocation` for native location.

**Rules & edge cases:** Location permission must be `always` (background) on iOS for the background check to work; if only `whenInUse` is granted, fall back to a foreground check on next app resume and inform the user. If location services are unavailable (permission denied, hardware off), assume the employee is still at the store and show the re-prompt anyway — do not silently suppress it. The background check should use the same Haversine geofence logic as the regular clock-in check (`work_locations.radius`, `work_locations.latitude`, `work_locations.longitude`). Only one background location check per snooze window — do not poll continuously during the snooze, just once at expiry.

**Current state:** The clock-in snooze fires a re-prompt after the configured interval without re-checking location. There is no background location polling during the snooze window.

**What is missing:** A snooze-aware location-check routine (either a Capacitor background task or a periodic check on app foreground resume) that validates geofence status before re-showing the clock-in prompt, and logs a `geofence_out` event if the employee has left.

**Done looks like:** Employee snoozes, walks to their car, and is still outside when the snooze expires — the prompt does not re-appear. Employee snoozes, stays on-site, and the prompt re-appears correctly when the snooze expires.

---

### Automation Service Availability Collection

**Purpose:** The payroll period automation workflow checks whether all employees have submitted their availability before advancing the workflow to the scheduling phase. The current check uses a placeholder "simplified check for demo" that operates on a stub user array rather than real database state.

**Primary flow:**
1. Automation service triggers at the `availability_collection` phase of a `PayrollPeriod`.
2. Service queries `user_availability_overrides` and `availability_templates` to determine which active, schedulable employees have submitted availability for the period's date range.
3. If all employees have submitted, advance the workflow to `schedule_generation`.
4. If deadline has passed without all submissions, advance anyway and log missing users.

**Key data / entities:** `payroll_periods` (`availability_deadline`, `workflow_state`), `availability_templates` (per-user recurring default), `user_availability_overrides` (per-user per-date), `users` (`show_in_schedule`, `is_active`, `eligible_for_auto_scheduling`).

**Rules & edge cases:** An employee is considered to have submitted availability if they have either (a) an `availability_templates` row (recurring default) or (b) at least one `user_availability_overrides` row for each day of the pay period. Employees with `show_in_schedule = false` or `eligible_for_auto_scheduling = false` must be excluded from the check — their availability is irrelevant. The check must be scoped to the store (`company_id` / `work_locations` context) so multi-store deployments do not cross-contaminate. When the deadline passes with incomplete submissions, the workflow should advance with a warning log listing affected employee IDs — never block indefinitely.

**Current state:** `server/services/automationService.ts` line ~123 has a placeholder `allUsers` array and a "simplified check for demo" comment. The availability check does not query the database.

**What is missing:** Replace the stub with a real query: `SELECT DISTINCT user_id FROM availability_templates WHERE ...` UNION `SELECT DISTINCT user_id FROM user_availability_overrides WHERE date BETWEEN period_start AND period_end` compared against the list of active, schedulable users for the store. Log any missing users.

**Done looks like:** When all active, schedulable employees have either an availability template or date-specific overrides covering the period, the automation workflow advances to scheduling automatically. When the deadline passes with gaps, the workflow advances with a warning logged naming the missing employees.

---

### AI Scheduling Per-Row Drop Reason Tracking

**Purpose:** When the AI scheduling algorithm discards a candidate employee from a shift (due to availability conflict, overtime risk, minimum rest violation, etc.), the reason should be recorded per drop so managers can understand why the schedule came out the way it did and build trust in AI-generated schedules.

**Primary flow:**
1. Manager triggers AI schedule generation for a week.
2. The scheduling engine evaluates each active, schedulable employee against each open shift slot.
3. For every employee-shift combination that is rejected, a structured drop reason is written alongside the schedule output.
4. The generated schedule is saved to `ai_suggested_schedules` with the drop reasons embedded in the `schedule_data` JSON.
5. Manager opens the generated schedule and clicks "Why wasn't [employee] scheduled on Tuesday?" to see the explainability panel listing the drop reason(s) for that employee-day.

**Key data / entities:** `ai_suggested_schedules` stores the final schedule as JSON in `schedule_data`. The drop reasons should be added as a top-level `drop_log` array within `schedule_data`, where each entry contains `employee_id`, `shift_slot` (date + start/end time), and `reason` (enum: `unavailable`, `overtime_risk`, `min_rest_violation`, `no_coverage_needed`, `custom_rule`, `role_mismatch`).

**Rules & edge cases:** Drop reasons must be recorded even when the employee was not selected because there simply was not a slot to fill — distinguish `no_coverage_needed` (enough staff already) from `unavailable` (employee conflict). If an employee is dropped for multiple reasons (e.g., both `unavailable` and `overtime_risk`), all reasons must be recorded, not just the first. Drop log data must never be surfaced to Associates — it is manager-only explainability data. The drop log may be large for stores with many employees; it should be stored compactly (IDs, not names) and rendered lazily in the UI.

**Current state:** `server/routes/aiScheduling.ts` line 1743 has a `TODO` comment referencing task #420: tracking per-row drop reasons. No drop reasons are currently persisted anywhere.

**What is missing:** A `drop_reasons` field in the schedule generation output JSON, populated during the Claude-based schedule generation loop for every employee-shift combination that was considered and rejected. A frontend explainability panel (manager-only) that reads the `drop_log` from the saved `schedule_data`.

**Done looks like:** After generating a schedule, managers can click on any shift slot and see which employees were evaluated and why each was not selected. The explainability data persists with the saved schedule and is still readable after the schedule is published.

### Native App Branding Assets

**Purpose:** Replace the placeholder icon and splash screen images with final branded assets so the Taime app can be submitted to the Apple App Store and Google Play Store. Without real assets, the Capacitor build produces an app with generic placeholder graphics that would be rejected by both stores.

**Primary flow:**
1. Designer provides a 1024×1024 PNG icon file (no transparency, no rounded corners — the stores apply their own rounding) and a 2732×2732 PNG splash screen.
2. Files are placed at `resources/icon.png` and `resources/splash.png` in the repository root.
3. Run `npx @capacitor/assets generate` (or the equivalent Capacitor CLI command) to generate all platform-specific icon and splash variants into `ios/App/App/Assets.xcassets/` and `android/app/src/main/res/`.
4. Rebuild the iOS and Android Capacitor shells and verify the icon and splash appear correctly in the simulator and on a physical device before store submission.

**Key data / entities:** No database changes. Files: `resources/icon.png` (1024×1024), `resources/splash.png` (2732×2732), `ios/App/App/Assets.xcassets/AppIcon.appiconset/`, `android/app/src/main/res/mipmap-*/ic_launcher*.png`.

**Rules & edge cases:** The icon must have no transparency (App Store rejects transparent icons). The splash background color must match the app's `--background` CSS variable so there is no flash during launch. The `capacitor.config.ts` `SplashScreen.backgroundColor` must match the image background. Both stores require multiple resolution variants — the `@capacitor/assets` CLI generates them all from the single source file.

**Current state:** `resources/icon.png` and `resources/splash.png` exist as placeholder files noted in `CAPACITOR_NOTES.md` and `submit.md`. The Capacitor shell for iOS and Android is otherwise configured and functional.

**What is missing:** Final branded 1024×1024 icon PNG and 2732×2732 splash PNG assets from a designer. Once files are placed, the asset generation command takes ~30 seconds and produces all variants.

**Done looks like:** Running `npx @capacitor/assets generate` completes without errors. The app icon shows the Taime brand in the device home screen. The splash screen shows the correct branded background during launch. Both iOS and Android builds pass asset validation in their respective store submission tools.

---

## Roadmap

Phases ordered to ship a working, revenue-generating product first, then layer intelligence, engagement, and enterprise features.

### Phase 1: Core Operations

- [x] Authentication and RBAC — Clerk OAuth, role-based access (Associate/Manager/Owner/Admin), 30+ granular permissions, per-user permission overrides
- [x] Employee profiles — HR metadata, documents, availability, pay rates, scheduling tags, emergency contacts, single-location assignment
- [x] Time clocking with geofencing — GPS radius/polygon enforcement, grace periods, auto clock-out, stale-location checker, photo verification
- [x] Schedule management — weekly timeline UI, shift creation, published vs draft states, conflict detection, mobile pinch-zoom, AI-generate button
- [x] Task management — recurring and one-off tasks, multi-assignee support, priority, due dates, completion tracking with photo/signature
- [x] SOP library and execution — template builder with decision branching, versioning, mobile checklist runner, completion tracking
- [x] Timesheets and pay period review — per-employee hour summaries, edit history, overtime flagging, discrepancy resolution, off-site allowance
- [x] Payroll export — date-range picker, format presets (QuickBooks/Gusto/ADP/custom), CSV download
- [x] Push notifications — Web Push (VAPID) and Capacitor native token registration, anomaly and shift alerts, delivery logs
- [x] Offline mode — service worker + IndexedDB caching, background sync on reconnect
- [ ] Employee account hard-delete cascade — self-delete UI and basic backend route exist; FK cascade cleanup missing across all dependent tables (partial: most related tables lack onDelete cascade, hard delete will fail for users with any records)
- [ ] Multi-location employee assignment — currently single `users.locationId` FK; N:N `location_assignments` join table and migration needed (partial: domain model defined in CONTEXT.md, no schema table yet)

### Phase 2: AI Assistants and Scheduling

- [x] AI auto-scheduling — Claude-powered schedule generation using Shopify sales history, staffing tiers, availability, zone minimums, and custom AI rules
- [x] Smart task suggestions (ARA) — proactive daily task prioritization surfaced per employee based on context, schedule, and performance
- [x] Morning Whisper (AI daily briefing) — Claude-generated text briefing for managers summarizing yesterday's performance and today's priorities
- [x] Ask MAinager conversational AI — in-app chat with Claude for operational questions and decision support with SOP context
- [x] AI Content Studio — manager hub for generating SOPs and training content from uploaded knowledge documents
- [x] AI Learning Center — quiz generation from uploaded docs, daily quizzes, spaced-repetition practice schedule, manager analytics
- [x] Holiday pay system — natural-language rule parser for automatic pay multipliers, holiday calendar UI
- [ ] AI scheduling per-row drop reason tracking — schedule generation loop discards candidates without recording why; explainability data missing (partial: TODO at aiScheduling.ts:1743, task #420)

### Phase 3: AI Monitoring and Analysis

- [x] Anomaly detection — payroll and clock-in anomaly detection with push notification delivery
- [x] Overtime Prevention Engine — real-time projected overtime warnings per employee in timesheet view
- [x] SOP Evolution System — AI revision proposals for SOPs based on employee feedback and execution analytics
- [x] AI Cash Investigation Engine — AI-assisted drawer reconciliation discrepancy analysis
- [x] Background insights engine — continuous background analysis of scheduling, payroll, and SOP data with proactive dashboard cards
- [x] Operational insights — AI-generated operational recommendations with dismissal, acknowledgment, and task-link actions
- [ ] Automation service availability collection — uses stub placeholder instead of real DB query to check whether all employees have submitted availability (partial: simplified demo check in server/services/automationService.ts:~123)

### Phase 4: Advanced Operations

- [x] Shopify sales integration — order webhook ingestion, 30-min reconciliation cron, historical backfill, refund/void handling, IANA timezone bucketing
- [x] Digital cash management — denomination wizard, deposit slip AI capture and verification, advanced drawer reconciliation
- [x] Supply and inventory Kanban — two-bin visual stock levels, reorder threshold alerts, auto-generated reorder tasks, count sessions
- [x] Gamification and leaderboards — composite performance score (attendance, tasks, SOPs, learning, engagement), tiers, achievements, per-employee score panel
- [x] Daily ritual system — Morning Huddle (AI-generated agenda), Daily Debrief, Kudos, Daily Quote, Midday Pulse
- [x] Lean board — team improvement tracking, daily snapshots, weekly AI summaries
- [x] Analytics dashboards — weekly sales vs goal comparison, labor cost breakdown, AI anomaly overlays, Owner/Admin real-time collapsible panels
- [x] RAG semantic search — pgvector SOP and knowledge-doc search with local Xenova 384-dim embeddings
- [x] Mileage reimbursement and offsite sessions — route tracking, deviation detection, per-session reimbursement calculation, admin review
- [x] Payroll intelligence — AI-powered pay period analysis, discrepancy flagging, overtime prevention, off-site allowance enforcement
- [ ] Uploaded video file cleanup on delete — DB record is removed on delete but backing S3 storage file is never deleted; deleteObject call missing in server/services/videoUpload.ts:110 (partial: local file delete works, S3 branch logs "not implemented")

### Phase 5: Communication and Engagement

- [x] In-app messaging — real-time thread-based messaging, direct messages, group chats, emoji reactions, announcements
- [x] Kudos wall — peer-to-peer recognition feed integrated into messaging threads, kudo categories
- [x] Improvement video platform — 60-second improvement videos with likes, comments, and featured status
- [x] Issue tracker — one-tap issue logging, priority levels, assignment workflow (Open → Acknowledged → In Progress → Resolved), comments, AI SOP auto-link
- [x] Meetings with AI synopsis — audio transcript, AI-generated summary, action item extraction into GTD inbox
- [x] GTD workflow engine — Universal inbox, AI clarification, projects, next actions, waiting-for, someday/maybe, weekly review with AI prompts
- [x] Store QA (AI knowledge Q&A) — employees ask free-form questions answered by Claude from SOPs and knowledge documents
- [ ] Dashboard card network recovery notification — cards recover silently after network outage with no user acknowledgment; recovery toast missing (partial: error states work, success transition has no notification hook)

### Phase 6: Enterprise and Billing

- [x] Training Hub and Training Player — video-based lessons, lesson progress tracking, quiz scoring, spaced repetition, manager flags
- [x] Morning Learning Moments — daily AI-generated tip + quiz question delivered to all staff, answer tracking
- [x] AI spend tracking and budgets — per-store and global AI cost metering, monthly budget limits, alert thresholds, hard-block enforcement
- [x] Role-specific dashboards — tailored home screens for Associates (my tasks, schedule, score), Managers (team status, issues, ops), Owners/Admins (~11 collapsible real-time panels)
- [ ] Stripe billing and subscription management — no Stripe SDK, no subscriptions table, no webhook handler, no entitlement enforcement; complete greenfield build required (not started: domain model only in CONTEXT.md)
- [ ] Customer profiles / Style DNA — no schema tables, no routes, no UI; product spec exists in SPECIFICATION.md with full data model and AI archetype clustering design (not started)
- [ ] Scheduled report delivery time configuration — delivery hour is hardcoded; shopify_report_schedules needs delivery_hour column and UI picker (partial: schedule infrastructure exists, time config missing)
- [ ] Multiple analytics report recipients — shopify_report_schedules.recipient_email is single-value; schema and UI change needed to support array of recipients (partial: single recipient works end-to-end)
- [ ] Clock-in snooze duration configuration — hardcoded snooze interval; company_settings needs clock_in_snooze_minutes column and UI field (partial: snooze exists, duration is not configurable)
- [ ] Background location re-check during clock-in snooze — snooze re-prompt fires without verifying employee is still in geofence; Capacitor background check needed (partial: snooze prompt works, location re-check missing)
- [ ] Native app branding assets — resources/icon.png and resources/splash.png are placeholder images; final branded assets needed for App Store / Google Play submission (not started)
