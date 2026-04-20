/**
 * SOP execution WebSocket broadcast audit
 *
 * Task #218 replaced `broadcastToAll` with `sendToUsers` for SOP execution
 * events so that activity is only pushed to the relevant participants, not
 * every connected client. These tests statically audit `server/routes/sops.ts`
 * to make sure that constraint holds for each of the five execution events.
 *
 * If a developer accidentally reverts to broadcastToAll for any of these
 * events, the corresponding test will fail with an actionable message.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "..");

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf-8");
}

const SOPS_ROUTE_FILE = "server/routes/sops.ts";

/**
 * The five SOP execution events that must NEVER be broadcast to all clients.
 * Each entry also carries a regex that confirms the event is sent via
 * sendToUsers (so the test catches both the bad pattern and a missing send).
 */
const EXECUTION_EVENTS: Array<{
  event: string;
  broadcastPattern: RegExp;
  sendToUsersPattern: RegExp;
}> = [
  {
    event: "execution_started",
    broadcastPattern: /broadcastToAll\s*\([^)]*execution_started/,
    sendToUsersPattern: /sendToUsers\s*\([^)]*execution_started/,
  },
  {
    event: "step_completed",
    broadcastPattern: /broadcastToAll\s*\([^)]*step_completed/,
    sendToUsersPattern: /sendToUsers\s*\([^)]*step_completed/,
  },
  {
    event: "execution_completed",
    broadcastPattern: /broadcastToAll\s*\([^)]*execution_completed/,
    sendToUsersPattern: /sendToUsers\s*\([^)]*execution_completed/,
  },
  {
    event: "sign_off_requested",
    broadcastPattern: /broadcastToAll\s*\([^)]*sign_off_requested/,
    sendToUsersPattern: /sendToUsers\s*\([^)]*sign_off_requested/,
  },
  {
    event: "sign_off_completed",
    broadcastPattern: /broadcastToAll\s*\([^)]*sign_off_completed/,
    // Use [\s\S]*? (dotAll-style) because the recipient argument may itself
    // contain parentheses (e.g. computeSopSignOffCompletedRecipients(...)),
    // which would cause the simpler [^)]* pattern to stop too early.
    sendToUsersPattern: /sendToUsers\s*\([\s\S]*?sign_off_completed/,
  },
];

describe("SOP execution WebSocket broadcast audit", () => {
  const source = readFile(SOPS_ROUTE_FILE);

  for (const { event, broadcastPattern, sendToUsersPattern } of EXECUTION_EVENTS) {
    it(`"${event}" is not sent via broadcastToAll`, () => {
      const hasBroadcastToAll = broadcastPattern.test(source);
      expect(
        hasBroadcastToAll,
        `"${event}" in ${SOPS_ROUTE_FILE} is emitted via broadcastToAll, which leaks ` +
          "employee activity to every connected client. " +
          "Use sendToUsers() with a filtered list of recipient user IDs instead " +
          "(see the pattern already established in the same file for other SOP events).",
      ).toBe(false);
    });

    it(`"${event}" is sent via sendToUsers`, () => {
      const hasSendToUsers = sendToUsersPattern.test(source);
      expect(
        hasSendToUsers,
        `"${event}" in ${SOPS_ROUTE_FILE} does not appear to be sent via sendToUsers. ` +
          "All SOP execution events must be delivered only to the relevant participants " +
          "(employee, managers, sign-off-eligible users) using sendToUsers().",
      ).toBe(true);
    });
  }
});
