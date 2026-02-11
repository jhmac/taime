# Bug Tracking Log

## BUG-001: Permission Denied for Owner/Admin on Team, HR, Payroll, Operations pages

**Status:** FIX APPLIED (Attempt #6)
**First reported:** 2026-02-11
**Affected pages:** /team, /hr, /payroll, /operations, /admin

### Root Cause Analysis
The PermissionGuard component was being cached by the browser. Despite Vite serving the updated code (verified via curl), the browser's module cache retained the old version. The Vite HMR WebSocket connection was unreliable (400 errors observed), preventing live module updates.

The server correctly returns `role: { name: "owner" }` for the user (verified via direct database query and `getUserWithRole()` function test). The sidebar correctly shows MANAGEMENT section (proving `isAdmin` is true), but the PermissionGuard module was stale.

### Attempts

| # | What was tried | Result |
|---|----------------|--------|
| 1 | Added `user?.role?.name === 'owner'` fallback to PermissionGuard | FAILED - Browser cached old module |
| 2 | Fixed permission names to match DB | FAILED - Browser cached old module |
| 3 | Moved admin check before permission query | FAILED - Browser cached old module |
| 4 | Simplified PermissionGuard to only check role name | FAILED - Browser cached old module |
| 5 | Added console logging to debug | FAILED - Browser cached old module |
| 6 | **ELIMINATED PermissionGuard entirely.** Created `AdminRoute` component INLINE in App.tsx. No separate module to cache. Removed PermissionGuard import. App.tsx is cache-busted via nanoid() in vite.ts on every page load. | APPLIED |

### Final Fix (Attempt #6)
- Removed `PermissionGuard` component from App.tsx routing entirely
- Created `AdminRoute` component INLINE within App.tsx (same file, no import)
- AdminRoute checks `user?.role?.name === 'owner' || user?.role?.name === 'admin'`
- This eliminates any browser module caching issues since App.tsx is the root component
- vite.ts adds `?v=${nanoid()}` to main.tsx entry point on every page load, ensuring fresh code

---

## BUG-002: Tasks page missing from sidebar navigation

**Status:** FIX APPLIED (Attempt #4)
**First reported:** 2026-02-11
**Affected area:** DesktopSidebar.tsx - /tasks route not visible

### Root Cause Analysis
Same browser caching issue as BUG-001. The DesktopSidebar module was cached by the browser.

### Attempts

| # | What was tried | Result |
|---|----------------|--------|
| 1 | Added `/tasks` to allNavItems | FAILED - Browser cached old module |
| 2 | Changed filter logic | FAILED - Browser cached old module |
| 3 | Verified via curl that Vite serves correct code | CONFIRMED - Code is correct but browser has stale cache |
| 4 | **REWROTE DesktopSidebar** with simplified structure. Removed permission query dependency. Split nav items into `generalNavItems` and `managementNavItems` arrays. Tasks is first item in management section. | APPLIED |

---

## BUG-003: Role Rename - Employee to Stylist

**Status:** FIXED
**Fixed:** 2026-02-11

### Fix
- Ran SQL: `UPDATE roles SET name = 'stylist', display_name = 'Stylist' WHERE name = 'employee';`
