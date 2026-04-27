# End-to-End Tests (Playwright)

These tests exercise the scheduling UI through a real browser. They bypass Clerk
interactive login via a dev-only, opt-in HMAC-signed cookie set by
`/api/dev/test-login`.

## Required environment

Both must be set in the development environment for the bypass to activate:

| Variable                       | Where to set        | Purpose                                                                  |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------ |
| `ENABLE_E2E_AUTH_BYPASS`       | env var (`true`)    | Server-side feature flag; bypass is fully disabled without it.           |
| `VITE_ENABLE_E2E_AUTH_BYPASS`  | env var (`true`)    | Client-side mirror so the React app honors the bypass cookie.            |
| `E2E_TEST_SECRET`              | Replit secret       | HMAC signing secret for the test-login token. Any long random string.    |

Without **both**, the `/api/dev/test-login` and `/api/dev/test-setup` routes are
not registered (requests return 404), the bypass cookie is rejected by the
auth middleware, and the tests fail fast in `beforeAll` with a clear error.

The bypass is additionally restricted to:
- non-production builds (`NODE_ENV !== "production"`)
- requests originating from localhost (`127.0.0.1` / `::1`)

## Running the tests

```bash
ENABLE_E2E_AUTH_BYPASS=true VITE_ENABLE_E2E_AUTH_BYPASS=true \
  npx playwright test tests/e2e/availability-pills.spec.ts
```

`playwright.config.ts` reuses an already-running dev server on port 5000;
otherwise it boots `npm run dev` automatically.

## Files

- `availability-pills.spec.ts` — covers the "Who's Available Today" section in
  the Create Shift dialog: appearance, pill click adds a shift, date change
  refreshes pills.
- `save-undo-flow.spec.ts` — exercises the bulk save → toast Undo round-trip
  (POST `/api/ai-scheduling/apply` → DELETE `/api/schedules/bulk`) and the
  unsaved-changes confirmation dialog when closing the panel with pending
  shifts (Discard closes without saving).
