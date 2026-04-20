/**
 * Background cron WebSocket leak audit
 *
 * These tests verify that background cron services which are NOT passed a
 * broadcast callback do not contain any internal WebSocket broadcast calls.
 * Each service in the staggered cron list (routes.ts ~line 261-277) that
 * receives no broadcast parameter is covered here.
 *
 * A broader repo-level scan also checks every file under server/services/
 * (except the explicit allow-list) to catch any new file that starts
 * broadcasting without going through the permission-filtered helper.
 *
 * Route handlers (server/routes/*.ts) are intentionally excluded from the
 * repo-level scan because they legitimately receive and call a broadcastToAll
 * callback injected by routes.ts — that is the approved pattern for
 * user-triggered events. Only service-layer files are audited here because
 * they run autonomously (without a user request context) and must never
 * initiate broadcasts on their own.
 *
 * If a service needs to start pushing data to clients, it must follow the
 * established patterns:
 *   - Accept a typed broadcast/sendToUsers callback (never import wsConnections
 *     directly or call ws.send internally)
 *   - Filter recipients by role/permission before sending
 *     (see server/services/middayPulseBroadcast.ts for the pattern)
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "..");

/**
 * Patterns that indicate a service file is sending data directly over WebSocket
 * or importing WebSocket primitives for internal use.
 */
const WS_PATTERNS: RegExp[] = [
  /broadcastToAll\s*\(/,
  /\.send\s*\(\s*(?:payload|JSON\.stringify)/,
  /wss\.(clients|send|broadcast)/,
  /new\s+WebSocket\s*\(/,
  /require\(['"]ws['"]\)/,
  /import\s+.*\bWebSocket\b.*from\s+['"]ws['"]/,
];

/**
 * Files that are explicitly allowed to reference "broadcastToAll" because they
 * either implement a permission-filtered broadcast helper OR accept broadcastToAll
 * as an injected callback parameter (the approved pattern). They are NOT making
 * their own raw WebSocket connections.
 */
const ALLOWLISTED_FILES = new Set([
  // Implements the permission-filtered midday pulse broadcast helper itself.
  "server/services/middayPulseBroadcast.ts",
  // Receives broadcastToAll as a cron callback; routes.ts passes the
  // permission-filtered broadcastMiddayPulse wrapper.
  "server/services/middayPulse.ts",
  // Receives broadcastToAll as a callback from user-triggered route handlers
  // (gtd.ts, issues.ts, rituals.ts, sops.ts). User-action context, not a cron.
  "server/services/gtdClarificationAI.ts",
]);

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf-8");
}

function hasWebSocketCall(source: string): string | null {
  for (const pattern of WS_PATTERNS) {
    const match = source.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function listTsFiles(dir: string): string[] {
  const absDir = resolve(ROOT, dir);
  try {
    return readdirSync(absDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

const CRON_SERVICES_UNDER_AUDIT: Array<{ label: string; path: string }> = [
  { label: "Weekly Review cron",       path: "server/routes/weeklyReview.ts" },
  { label: "Lean Board cron",          path: "server/services/leanBoard.ts" },
  { label: "SOP Insights cron",        path: "server/services/sopIntelligence.ts" },
  { label: "SOP Evolution cron",       path: "server/services/sopEvolution.ts" },
  { label: "Background Insights cron", path: "server/services/backgroundInsights.ts" },
  { label: "Gamification cron",        path: "server/services/gamificationCron.ts" },
  { label: "Location Cleanup cron",    path: "server/services/locationCleanupCron.ts" },
];

describe("Background cron WebSocket leak audit — named cron services", () => {
  for (const { label, path } of CRON_SERVICES_UNDER_AUDIT) {
    it(`${label} does not contain any internal WebSocket broadcast calls`, () => {
      const source = readFile(path);
      const found = hasWebSocketCall(source);
      expect(
        found,
        `${label} (${path}) contains a WebSocket pattern "${found}". ` +
          "Background cron services must not broadcast internally. " +
          "Accept a typed broadcast callback and filter by permission instead " +
          "(see server/services/middayPulseBroadcast.ts for the pattern).",
      ).toBeNull();
    });
  }
});

/**
 * Sensitive event types defined in server/lib/broadcastRecipients.ts.
 * These events carry per-user data (time entries, debriefs, GTD inbox/actions,
 * DMs) and MUST only be sent via sendToUsers() with appropriate recipient
 * filtering. Accidentally routing them through broadcastToAll() would leak
 * private data to every connected client.
 */
const SENSITIVE_EVENT_TYPES: string[] = [
  "time_entry_created",
  "time_entry_updated",
  "debrief_submitted",
  "inbox_item_created",
  "inbox_item_processed",
  "action_created",
  "action_completed",
  "new_message",
];

/**
 * Build a regex that matches a broadcastToAll call whose `type:` literal is
 * one of the sensitive event types. The pattern handles both single and double
 * quotes and allows optional whitespace around the colon.
 *
 * Example it matches:
 *   broadcastToAll({ type: 'time_entry_created', ... })
 *   broadcastToAll({ type: "new_message", ... })
 */
function buildSensitiveEventPattern(eventType: string): RegExp {
  return new RegExp(
    `broadcastToAll\\s*\\([^)]*type\\s*:\\s*['"]${eventType}['"]`,
    "s",
  );
}

describe("Route handler sensitive-event broadcast audit", () => {
  /**
   * Scan every route file for broadcastToAll calls that use a known sensitive
   * event type. Route handlers are allowed to use broadcastToAll for public
   * events (e.g. huddle_updated, schedule_created) but must never use it for
   * events that carry per-user private data.
   */
  const routeFiles = listTsFiles("server/routes");

  for (const eventType of SENSITIVE_EVENT_TYPES) {
    const pattern = buildSensitiveEventPattern(eventType);

    it(`no route handler calls broadcastToAll with sensitive event type "${eventType}"`, () => {
      const violations: string[] = [];

      for (const filePath of routeFiles) {
        const source = readFile(filePath);
        if (pattern.test(source)) {
          violations.push(filePath);
        }
      }

      expect(
        violations,
        `The following route files call broadcastToAll with the sensitive event type "${eventType}":\n` +
          violations.map((v) => `  - ${v}`).join("\n") +
          `\n\nFix: use sendToUsers() with the appropriate recipient filter from ` +
          `server/lib/broadcastRecipients.ts instead of broadcastToAll() for ` +
          `"${eventType}" events. broadcastToAll() sends to every connected ` +
          `client and must not be used for per-user private data.`,
      ).toHaveLength(0);
    });
  }
});

describe("Background cron WebSocket leak audit — service-layer repo scan", () => {
  /**
   * Scan all service files. Route handlers (server/routes/*.ts) are excluded
   * because they legitimately call a broadcastToAll callback injected by
   * routes.ts; that callback is defined there and is the correct pattern.
   * Service files run autonomously and must never initiate WebSocket sends
   * on their own.
   */
  const allServiceFiles = listTsFiles("server/services").filter(
    (p) => !ALLOWLISTED_FILES.has(p),
  );

  it("no service file outside the allow-list contains a raw WebSocket send", () => {
    const violations: string[] = [];

    for (const filePath of allServiceFiles) {
      const source = readFile(filePath);
      const found = hasWebSocketCall(source);
      if (found) {
        violations.push(`${filePath}: matched pattern "${found}"`);
      }
    }

    expect(
      violations,
      "The following service files contain raw WebSocket sends outside the permission-filtered allow-list:\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\nFix: route WebSocket output through broadcastMiddayPulse() or sendToUsers() with " +
        "appropriate permission checks (see server/services/middayPulseBroadcast.ts).",
    ).toHaveLength(0);
  });
});
