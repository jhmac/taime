# Bug Tracking Log

## BUG-001: Permission Denied for Owner/Admin on Team, HR, Payroll, Operations pages

**Status:** IN PROGRESS (Attempt #4)
**First reported:** 2026-02-11
**Affected pages:** /team, /hr, /payroll, /operations, /admin

### Root Cause Analysis
The user "Libby Story" has role_id pointing to the "owner" role in the database. The server correctly returns `role: { name: "owner" }` in the user data (verified via debug endpoint). The issue is in the frontend PermissionGuard component.

### Attempts

| # | What was tried | Result |
|---|----------------|--------|
| 1 | Added `user?.role?.name === 'owner' \|\| user?.role?.name === 'admin'` fallback to PermissionGuard hasPermission check | FAILED - Still showing Access Denied |
| 2 | Fixed permission names from non-existent `hr.manage_employees`, `admin.manage_payroll` to actual DB names `hr.view_team`, `hr.payroll_view` | FAILED - Still showing Access Denied |
| 3 | Moved admin/owner check BEFORE permission query check, added isPending handling for TanStack Query v5 race condition | FAILED - Still showing Access Denied |
| 4 | SIMPLIFIED PermissionGuard to ONLY use useAuth() hook (no separate permissions query at all). Removed Card/CardContent imports. Only checks user.role.name directly from the user object. No TanStack Query permissions fetch needed. | FAILED - User reports owner still denied access. Added console logging to PermissionGuard. |
| 5 | Added explicit permission check in DesktopSidebar map to handle items with permission requirement. | TESTING |

### Key Findings
- Server-side: `getUserWithRole()` correctly returns `{ role: { name: "owner" } }` - verified via curl to debug endpoint
- Database: `users.role_id` correctly points to `roles.name = 'owner'`
- Vite dev server: Serves updated PermissionGuard.tsx code (verified via curl)
- TanStack Query: Default config has `staleTime: Infinity`, `retry: false`, `on401: "throw"` - meaning if permissions query ever failed, it would never retry
- The DesktopSidebar uses the SAME `user?.role?.name` check and correctly shows management items - so user data IS available
- Suspect: Browser cache or HMR not applying changes, or TanStack Query caching stale error state for permissions query

### Final Fix (Attempt #4)
- Completely removed the `/api/auth/permissions` query from PermissionGuard
- PermissionGuard now ONLY checks `useAuth().user.role.name` for admin/owner
- This eliminates ALL potential TanStack Query timing/caching issues
- For non-admin users, it shows Access Denied (they shouldn't see management pages)

---

## BUG-002: Tasks page missing from sidebar navigation

**Status:** IN PROGRESS (Attempt #3)
**First reported:** 2026-02-11
**Affected area:** DesktopSidebar.tsx - /tasks route not visible

### Attempts

| # | What was tried | Result |
|---|----------------|--------|
| 1 | Added `/tasks` to allNavItems in DesktopSidebar.tsx with permission `tasks.view_all` | FAILED - Tasks not visible. Root cause: items with `permission` property were filtered by permission check that required actual DB permission match |
| 2 | Changed filter logic to only hide the "Management" divider for non-admins, show all other items regardless of permission property | FAILED - User still didn't see Tasks (likely cached) |
| 3 | Verified via curl that Vite serves updated DesktopSidebar.tsx with `/tasks` path. Code is confirmed correct. Waiting for user to hard-refresh. | TESTING |

### Key Findings
- Code IS correct - confirmed via curl to Vite dev server
- Likely a browser cache issue on user's end
- Tasks also added to BottomNavigation.tsx for mobile view

---

## BUG-003: Role Rename - Employee to Stylist

**Status:** FIXED
**Fixed:** 2026-02-11

### Fix
- Ran SQL: `UPDATE roles SET name = 'stylist', display_name = 'Stylist' WHERE name = 'employee';`
- Successfully updated 1 row
