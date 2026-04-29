# Taime Domain Context

The shared vocabulary for Taime — the AI boutique manager PWA. This file is the single source of truth for what we name things and what those names mean. Read it before naming a new feature, table, column, route, or UI string. When the code uses an old name, the glossary still wins for new work; the cleanup sweep tracks the renames.

## Language

### Tenancy & Place

**Store**:
The boutique business / brand. Has exactly one **ShopifyConnection** and 1..N **Locations**.
_Avoid_: Shop, Brand, Site, Branch.

**Location**:
A physical place where work happens. Mirrors a Shopify Location — inventory, POS, and team are all per-Location in Shopify. Has address, geofence, hours, timezone.
_Avoid_: Store, WorkLocation, Site, Branch.

**ShopifyConnection**:
The Shopify integration credential. 1:1 with **Store**.

**Company**:
Today, a 1:1 envelope around **Store**. Treated as the same domain entity in language; a future split is captured in ADR-0001.

### Identity & Roles

**User**:
The technical / auth identity row. Used in code, FKs, logs, and permission checks.
_Avoid_: Account, Login.

**Employee**:
The domain / HR identity. Same row as **User**, viewed through the lens of "person who works here." Use this in product copy, manager UI, scheduling UI, and HR features.
_Avoid_: Team Member, Staff, Associate (as a noun for a person).

**StoreMembership**:
The auth boundary. A **User** belongs to one or more **Stores** via this. Without it, no access to that Store's data.

**LocationAssignment**:
Explicit join row between **User** and **Location**. Defines where an **Employee** can clock in, be scheduled, and be reported on. Independent of **SchedulingTags**.
_Avoid_: location tag, location membership.

**Role**:
A single value per **User** that drives permissions. System roles are `owner | admin | manager | employee` plus runtime-defined custom roles. Flat — no inheritance.
_Avoid_: User Type, Permission Role.

**AccountOwner**:
The **Employee** who is the Stripe billing payer for a **Store**. Exactly one per Store. Distinct from `role=owner` (multiple Users can have role owner; only one is AccountOwner). Reassignable.

**CareerLevel**:
Strictly an HR / display tier (e.g. New Associate, Lead, Manager). Not auth and not scheduling. (Rename target for the existing `companySettings.teamRoles` jsonb.)

**SchedulingTag**:
Pure scheduler input (Opener, Closer, Key Holder, Trainer, New Hire, custom skill tags). Not auth. (Rename target for `users.schedulingClassifications`.)

### Permissions

**Permission**:
A code-defined capability key (e.g. `sales.view_all`). Closed registry — adding a new one requires a code change. Naming convention: `<category>.<action>[_<scope>]`.

**PermissionOverride**:
A per-User row in `userPermissionOverrides` that grants or revokes a **Permission**, winning over the User's **Role** default.
_Avoid_: "individual override," "sales access override," "user permission."

**Permission resolution rule**:
`userPermissionOverrides` row → `rolePermissions` for the User's **Role** → deny.

**Permission scope**:
Permissions are User-global, not per-Store or per-Location. Scope is enforced at the data layer by joining through **StoreMembership** and **LocationAssignment**.

### Time & Schedule

**Shift**:
One planned slot of work for one **Employee**, at one **Location**, with start and end. Rows of the `schedules` table.
_Avoid_: Schedule (singular), ScheduleEntry, Block, Slot.

**Schedule**:
The collection of **Shifts** for a **Store** + **Location** + week. A read-side concept; not a row.

**TimeEntry**:
What actually happened — a clock-in/clock-out record.

**ClockEvent**:
A granular event (clock-in, clock-out, break-start, break-end, geofence-in, geofence-out). Many ClockEvents compose one **TimeEntry**.

**GeofenceEvent**:
A special-case **ClockEvent** for entering or leaving a geofence. Long-term, this should fold into ClockEvent; deferred.

**PayrollPeriod**:
An instance of a pay cycle with workflow state.

**PayPeriodSettings**:
Company-level cadence configuration that produces **PayrollPeriod** instances.

**PayrollWorkflow**:
The state machine that walks a **PayrollPeriod** from `created` to `processed`. The word "workflow" is reserved for this — do not reuse it for SOP or ritual flows.

### Availability

Resolution is top-down — the highest-precedence layer that applies wins:

1. **TimeOffRequest** approved and covering the date → unavailable.
2. **AvailabilityOverride** — **ManagerOverride** (`setByManagerId IS NOT NULL`) → use its hours / unavailable flag.
3. **AvailabilityOverride** — **EmployeeOverride** (`setByManagerId IS NULL`) → use its hours / unavailable flag.
4. **AvailabilityTemplate** (recurring weekly default) → use its hours / unavailable flag.
5. **Default** → unavailable. Do not auto-assume the **Employee** is free.

**TimeOffRequest**:
An approved request blocking work on a date range.

**AvailabilityOverride**:
A per-(User, date) row in `userAvailabilityOverrides`. Two flavors live in the same table, distinguished by `setByManagerId`: **ManagerOverride** and **EmployeeOverride**.

**AvailabilityTemplate**:
The recurring weekly default for one **User**. One row per User in `availabilityTemplates`.

### Notifications & Logs

**Notification**:
A single message sent to one recipient. Has a type, fans out across configured channels.

**NotificationType**:
Closed code-defined registry (e.g. `shift.created`, `shift.deleted`, `availability.manager_override`, `report.scheduled_delivery`). Each type has a stable key, label, default channel set, and category.

**NotificationChannel**:
Closed enum: `in_app`, `email`, `web_push`, `native_push`. SMS is explicitly out of scope.

**NotificationPreference**:
Per-(User, NotificationType, NotificationChannel) opt-in/out. Resolution: row exists → use it; no row → fall back to the **NotificationType** default for that channel.

**NotificationDeliveryLog**:
One row per (Notification, Channel) attempt. Status: `queued | sent | delivered | failed | bounced`.

**InboxItem**:
The persistence of a **Notification** on the `in_app` channel. The bell / inbox UI reads from this. (Rename target for `commuteAlerts` / `overtimeAlerts`.)

**ActivityLog**:
Admin / audit trail — who did what to what. Strictly NOT a user-facing inbox.

**ScheduledReport**:
Automated report delivery on a configured cadence. A separate concept from **Notification**, even though it uses the email channel.
_Avoid_: calling a scheduled report a "notification."

**`notify(userId, typeKey, payload)`**:
The single service every code path calls to send notifications. No direct push or email calls from feature code.

### Billing

**Subscription**:
One row per **Store**. References Stripe customer / subscription IDs. Status: `trialing | active | past_due | canceled | unpaid`.

**Plan**:
A code-defined tier — Starter / Growth / Pro. Each Plan has a feature-key array and a Stripe price ID. Adding a Plan is a code change.

**Entitlement**:
A read-side cache mapping a **Store** to the feature keys its current **Plan** grants. The app checks Entitlements; only the webhook handler talks to Stripe.

**Permissions vs Entitlements**:
Independent layers. A feature is accessible only if the **Store** has the **Entitlement** AND the **User** has the **Permission**. Don't collapse them.

**Trial**:
14 days, full feature access, no credit card required at signup. After day 14, clock-in/out still works (compliance); admin features lock until a **Plan** is chosen.

## Relationships

- A **Company** is (today) 1:1 with a **Store**.
- A **Store** has 1..N **Locations** and exactly one **ShopifyConnection**.
- A **User** has one **Role**, 0..N **PermissionOverrides**, 1..N **StoreMemberships**, and 0..N **LocationAssignments** (within Stores they are a member of).
- A **Shift** belongs to one **User** and one **Location**.
- An **AvailabilityTemplate** has one **User**; **AvailabilityOverrides** are (User, date).
- A **Subscription** belongs to one **Store**, billed via the **AccountOwner** **Employee**.
- A **Notification** targets one **User** and may produce 1..N **NotificationDeliveryLog** rows and 0..1 **InboxItem** (when `in_app` is in the channel set).

## Example dialogue

> **Dev:** "When a Manager edits Alex's **Shift** to a different **Location**, do we send a notification?"
>
> **Domain expert:** "Yes — `shift.changed` to Alex on whatever channels Alex has enabled for that **NotificationType**. Also write an **ActivityLog** entry for the manager's action. The new **Location** must be one Alex is **LocationAssigned** to or the edit is rejected."

## Flagged ambiguities

- The `shops` table is the **Store**; the `workLocations` table is the **Location**. Both names are kept in code for now; the cleanup sweep will rename.
- `users.locationName` (text) and `users.locationId` (FK) coexist. `locationId` is the source of truth; `locationName` will be dropped in the cleanup sweep.
- `commuteAlerts` and `overtimeAlerts` will become **InboxItem**.
- `userAvailability` (per-payroll-period submissions) is deprecated in favor of templates + overrides.
- The Permission registry previously had a duplicate `sales.view` / `sales.view_all` — consolidated to `sales.view_all` (see ADR-0002).
- `comm.*` and `communication.*` permission prefixes coexist — being unified in the cleanup sweep.
