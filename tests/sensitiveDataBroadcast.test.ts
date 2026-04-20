/**
 * Sensitive data broadcast privacy tests
 *
 * Two layers of protection:
 *
 * 1. Recipient-computation unit tests — verify that each helper function
 *    produces exactly the right set of recipient user IDs and no others.
 *    A bug in the logic (wrong permission name, missing dedup, etc.) will be
 *    caught here.
 *
 * 2. Route wiring audit — static analysis of each route source file confirming
 *    that sensitive event types are emitted via `sendToUsers` and NOT via
 *    `broadcastToAll`.  If a future refactor accidentally switches a
 *    `sendToUsers(recipients, { type: 'time_entry_created', … })` call to
 *    `broadcastToAll({ type: 'time_entry_created', … })`, the wiring tests
 *    will fail immediately — no database or Express context needed.
 *
 * Covered events
 * ──────────────
 *  • time_entry_created / time_entry_updated  → owner + time.view_all holders
 *  • debrief_submitted                        → submitter + hr.view_team + admin.manage_all
 *  • inbox_item_created / inbox_item_processed → captured-by user only
 *  • action_created / action_completed        → actor + assignee + (original creator)
 *  • new_message (schedule notify-week DM)    → admin + target employee only
 *  • issue_created / issue_updated            → reporter + assignee + admin.manage_all + hr.view_team
 *  • issue_comment_added                      → reporter + assignee + comment author + admin.manage_all + hr.view_team
 *  • huddle_updated                           → all same-store members
 *  • schedule_created / schedule_updated / schedule_deleted → all same-store members
 *  • shoutout_created / shoutout_reaction     → all same-store members
 *
 * Recipient-logic pattern follows tests/middayPulseBroadcast.test.ts — pure
 * functions with injected dependencies so no database or Express context is needed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi } from "vitest";
import {
  computeTimeEntryRecipients,
  computeDebriefRecipients,
  computeGtdInboxRecipients,
  computeGtdActionRecipients,
  computeScheduleDmRecipients,
  computeKudoRecipients,
  computeIssueRecipients,
  computeIssueCommentRecipients,
  computeHuddleRecipients,
  computeScheduleStoreRecipients,
  computeShoutoutRecipients,
} from "../server/lib/broadcastRecipients";

const ROOT = resolve(__dirname, "..");

function readRoute(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf-8");
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a mock `getPermittedIds` that returns a fixed list for every call. */
function makeGetPermittedIds(ids: string[]) {
  return vi.fn().mockResolvedValue(ids);
}

/** Build a mock `getPermittedIds` that returns different lists per permission. */
function makeGetPermittedIdsByPerm(map: Record<string, string[]>) {
  return vi.fn().mockImplementation((perm: string) =>
    Promise.resolve(map[perm] ?? []),
  );
}

// ─── time_entry_created / time_entry_updated ────────────────────────────────

describe("computeTimeEntryRecipients — time_entry_created / time_entry_updated", () => {
  it("always includes the entry owner", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeTimeEntryRecipients("owner-1", getPermittedIds);
    expect(recipients).toContain("owner-1");
  });

  it("includes users with time.view_all permission", async () => {
    const getPermittedIds = makeGetPermittedIds(["manager-1", "manager-2"]);
    const recipients = await computeTimeEntryRecipients("owner-1", getPermittedIds);
    expect(recipients).toContain("manager-1");
    expect(recipients).toContain("manager-2");
  });

  it("does NOT include users who lack time.view_all", async () => {
    const getPermittedIds = makeGetPermittedIds(["manager-1"]);
    const recipients = await computeTimeEntryRecipients("owner-1", getPermittedIds);
    expect(recipients).not.toContain("random-user");
    expect(recipients).not.toContain("other-employee");
  });

  it("calls getPermittedIds with the correct permission name", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    await computeTimeEntryRecipients("owner-1", getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("time.view_all");
  });

  it("de-duplicates when the owner also holds time.view_all", async () => {
    const getPermittedIds = makeGetPermittedIds(["owner-1", "manager-1"]);
    const recipients = await computeTimeEntryRecipients("owner-1", getPermittedIds);
    const ownerOccurrences = recipients.filter((id) => id === "owner-1");
    expect(ownerOccurrences).toHaveLength(1);
  });

  it("returns only the owner when no one else has time.view_all", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeTimeEntryRecipients("owner-1", getPermittedIds);
    expect(recipients).toStrictEqual(["owner-1"]);
  });

  it("includes all time.view_all holders alongside the owner", async () => {
    const viewers = ["mgr-a", "mgr-b", "mgr-c"];
    const getPermittedIds = makeGetPermittedIds(viewers);
    const recipients = await computeTimeEntryRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("emp-1");
    for (const v of viewers) expect(recipients).toContain(v);
    expect(recipients).toHaveLength(4);
  });
});

// ─── debrief_submitted ───────────────────────────────────────────────────────

describe("computeDebriefRecipients — debrief_submitted", () => {
  it("always includes the submitting employee", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("emp-1");
  });

  it("includes users with hr.view_team permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "hr.view_team": ["hr-mgr-1"],
      "admin.manage_all": [],
    });
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("hr-mgr-1");
  });

  it("includes users with admin.manage_all permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "hr.view_team": [],
      "admin.manage_all": ["admin-1"],
    });
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("admin-1");
  });

  it("includes both hr.view_team and admin.manage_all holders together", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "hr.view_team": ["hr-mgr-1", "hr-mgr-2"],
      "admin.manage_all": ["admin-1"],
    });
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("hr-mgr-1");
    expect(recipients).toContain("hr-mgr-2");
    expect(recipients).toContain("admin-1");
  });

  it("does NOT include users with neither hr.view_team nor admin.manage_all", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "hr.view_team": ["hr-mgr-1"],
      "admin.manage_all": ["admin-1"],
    });
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(recipients).not.toContain("random-employee");
    expect(recipients).not.toContain("sales-user");
  });

  it("calls getPermittedIds for both required permission names", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("hr.view_team");
    expect(getPermittedIds).toHaveBeenCalledWith("admin.manage_all");
  });

  it("de-duplicates when the submitter also holds admin.manage_all", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "hr.view_team": [],
      "admin.manage_all": ["emp-1", "admin-2"],
    });
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    const submitterOccurrences = recipients.filter((id) => id === "emp-1");
    expect(submitterOccurrences).toHaveLength(1);
  });

  it("returns only the submitter when no one holds hr.view_team or admin.manage_all", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeDebriefRecipients("emp-1", getPermittedIds);
    expect(recipients).toStrictEqual(["emp-1"]);
  });
});

// ─── inbox_item_created / inbox_item_processed ──────────────────────────────

describe("computeGtdInboxRecipients — inbox_item_created / inbox_item_processed", () => {
  it("returns only the user who captured the item", () => {
    const recipients = computeGtdInboxRecipients("user-a");
    expect(recipients).toStrictEqual(["user-a"]);
  });

  it("does NOT include any other user", () => {
    const recipients = computeGtdInboxRecipients("user-a");
    expect(recipients).not.toContain("user-b");
    expect(recipients).not.toContain("manager-1");
    expect(recipients).not.toContain("admin-1");
  });

  it("works for any user ID string", () => {
    const recipients = computeGtdInboxRecipients("clj7rghvc0002abc");
    expect(recipients).toStrictEqual(["clj7rghvc0002abc"]);
  });

  it("returns a list containing only string values", () => {
    const recipients = computeGtdInboxRecipients("user-a");
    expect(recipients.every((id) => typeof id === "string")).toBe(true);
  });
});

// ─── action_created / action_completed ──────────────────────────────────────

describe("computeGtdActionRecipients — action_created / action_completed", () => {
  it("includes the actor (current user)", () => {
    const recipients = computeGtdActionRecipients("actor-1", "assignee-1");
    expect(recipients).toContain("actor-1");
  });

  it("includes the assignee", () => {
    const recipients = computeGtdActionRecipients("actor-1", "assignee-1");
    expect(recipients).toContain("assignee-1");
  });

  it("includes the original creator when provided", () => {
    const recipients = computeGtdActionRecipients("actor-1", "assignee-1", "creator-1");
    expect(recipients).toContain("creator-1");
  });

  it("does NOT include users who are not actor/assignee/creator", () => {
    const recipients = computeGtdActionRecipients("actor-1", "assignee-1", "creator-1");
    expect(recipients).not.toContain("random-user");
    expect(recipients).not.toContain("hr-manager");
    expect(recipients).not.toContain("admin-1");
  });

  it("de-duplicates when actor and assignee are the same user", () => {
    const recipients = computeGtdActionRecipients("user-1", "user-1");
    const occurrences = recipients.filter((id) => id === "user-1");
    expect(occurrences).toHaveLength(1);
  });

  it("de-duplicates when actor, assignee and creator are the same user", () => {
    const recipients = computeGtdActionRecipients("user-1", "user-1", "user-1");
    expect(recipients).toStrictEqual(["user-1"]);
  });

  it("excludes null assignee — every element is a non-empty string", () => {
    const recipients = computeGtdActionRecipients("actor-1", null);
    expect(recipients).toStrictEqual(["actor-1"]);
    expect(recipients.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("excludes null createdBy — returns only actor and assignee", () => {
    const recipients = computeGtdActionRecipients("actor-1", "assignee-1", null);
    expect(recipients).toContain("actor-1");
    expect(recipients).toContain("assignee-1");
    expect(recipients).toHaveLength(2);
  });

  it("returns just the actor when assignee and creator are both null", () => {
    const recipients = computeGtdActionRecipients("actor-1", null, null);
    expect(recipients).toStrictEqual(["actor-1"]);
  });

  it("covers the self-assign case: action_created where actor IS the assignee", () => {
    const recipients = computeGtdActionRecipients("emp-1", "emp-1");
    expect(recipients).toStrictEqual(["emp-1"]);
  });
});

// ─── new_message (schedule notify-week DM) ──────────────────────────────────

describe("computeScheduleDmRecipients — schedule notify-week DM (new_message)", () => {
  it("includes the admin who triggered the send", () => {
    const recipients = computeScheduleDmRecipients("admin-1", "emp-1");
    expect(recipients).toContain("admin-1");
  });

  it("includes the target employee", () => {
    const recipients = computeScheduleDmRecipients("admin-1", "emp-1");
    expect(recipients).toContain("emp-1");
  });

  it("does NOT include any other user", () => {
    const recipients = computeScheduleDmRecipients("admin-1", "emp-1");
    expect(recipients).not.toContain("emp-2");
    expect(recipients).not.toContain("manager-99");
    expect(recipients).toHaveLength(2);
  });

  it("returns exactly [adminId, employeeId]", () => {
    const recipients = computeScheduleDmRecipients("admin-xyz", "emp-abc");
    expect(recipients).toStrictEqual(["admin-xyz", "emp-abc"]);
  });

  it("correctly identifies different admins and employees for each DM", () => {
    const recipientsA = computeScheduleDmRecipients("admin-1", "emp-a");
    const recipientsB = computeScheduleDmRecipients("admin-1", "emp-b");

    expect(recipientsA).toContain("emp-a");
    expect(recipientsA).not.toContain("emp-b");
    expect(recipientsB).toContain("emp-b");
    expect(recipientsB).not.toContain("emp-a");
  });
});

// ─── kudo_sent ───────────────────────────────────────────────────────────────

/**
 * Build a mock `getStoreUserIds` that returns a fixed list for a given storeId.
 * Simulates a store-aware lookup: only IDs in `memberMap[storeId]` are returned,
 * so out-of-store users are naturally absent from any other storeId call.
 */
function makeGetStoreUserIds(memberMap: Record<string, string[]>) {
  return vi.fn().mockImplementation((storeId: string) =>
    Promise.resolve(memberMap[storeId] ?? []),
  );
}

describe("computeKudoRecipients — kudo_sent", () => {
  it("always includes the sender (fromEmployeeId)", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": [] });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    expect(recipients).toContain("sender-1");
  });

  it("always includes the recognised employee (toEmployeeId)", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": [] });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    expect(recipients).toContain("recipient-1");
  });

  it("includes all active store members returned by getStoreUserIds", async () => {
    const storeMembers = ["sender-1", "recipient-1", "emp-3", "emp-4", "mgr-1"];
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": storeMembers });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    for (const m of storeMembers) expect(recipients).toContain(m);
  });

  it("calls getStoreUserIds with the correct storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-xyz": ["emp-1"] });
    await computeKudoRecipients("store-xyz", "sender-1", "recipient-1", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-xyz");
  });

  it("does NOT include users from a different store — store-boundary exclusion", async () => {
    const getStoreUserIds = makeGetStoreUserIds({
      "store-a": ["emp-a1", "emp-a2", "sender-1", "recipient-1"],
      "store-b": ["emp-b1", "emp-b2", "hr-other-store"],
    });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    expect(recipients).not.toContain("emp-b1");
    expect(recipients).not.toContain("emp-b2");
    expect(recipients).not.toContain("hr-other-store");
  });

  it("does NOT call getStoreUserIds with any storeId other than the kudo's storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1"] });
    await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledTimes(1);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-a");
    expect(getStoreUserIds).not.toHaveBeenCalledWith("store-b");
  });

  it("de-duplicates when sender and recipient are also in the store member list", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["sender-1", "recipient-1", "emp-3"] });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    const senderOccurrences = recipients.filter((id) => id === "sender-1");
    const recipientOccurrences = recipients.filter((id) => id === "recipient-1");
    expect(senderOccurrences).toHaveLength(1);
    expect(recipientOccurrences).toHaveLength(1);
  });

  it("returns only sender and recipient when the store has no other members", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": [] });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    expect(recipients).toStrictEqual(["sender-1", "recipient-1"]);
  });

  it("includes all store members alongside sender and recipient", async () => {
    const storeMembers = ["emp-a", "emp-b", "emp-c"];
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": storeMembers });
    const recipients = await computeKudoRecipients("store-a", "sender-1", "recipient-1", getStoreUserIds);
    expect(recipients).toContain("sender-1");
    expect(recipients).toContain("recipient-1");
    for (const m of storeMembers) expect(recipients).toContain(m);
    expect(recipients).toHaveLength(5);
  });
});

// ─── issue_created / issue_updated ──────────────────────────────────────────

describe("computeIssueRecipients — issue_created / issue_updated", () => {
  it("always includes the reporter", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueRecipients("reporter-1", null, getPermittedIds);
    expect(recipients).toContain("reporter-1");
  });

  it("includes the assignee when one is set", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueRecipients("reporter-1", "assignee-1", getPermittedIds);
    expect(recipients).toContain("assignee-1");
  });

  it("does NOT include an absent assignee (null)", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueRecipients("reporter-1", null, getPermittedIds);
    expect(recipients).toHaveLength(1);
    expect(recipients).toStrictEqual(["reporter-1"]);
  });

  it("includes users with admin.manage_all permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": [],
    });
    const recipients = await computeIssueRecipients("reporter-1", null, getPermittedIds);
    expect(recipients).toContain("admin-1");
  });

  it("includes users with hr.view_team permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": [],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeIssueRecipients("reporter-1", null, getPermittedIds);
    expect(recipients).toContain("hr-mgr-1");
  });

  it("includes both admin.manage_all and hr.view_team holders together", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeIssueRecipients("reporter-1", "assignee-1", getPermittedIds);
    expect(recipients).toContain("reporter-1");
    expect(recipients).toContain("assignee-1");
    expect(recipients).toContain("admin-1");
    expect(recipients).toContain("hr-mgr-1");
  });

  it("does NOT include users who hold neither permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeIssueRecipients("reporter-1", null, getPermittedIds);
    expect(recipients).not.toContain("random-employee");
    expect(recipients).not.toContain("sales-user");
  });

  it("calls getPermittedIds for both admin.manage_all and hr.view_team", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    await computeIssueRecipients("reporter-1", null, getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("admin.manage_all");
    expect(getPermittedIds).toHaveBeenCalledWith("hr.view_team");
  });

  it("de-duplicates when reporter is also an admin", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["reporter-1", "admin-2"],
      "hr.view_team": [],
    });
    const recipients = await computeIssueRecipients("reporter-1", null, getPermittedIds);
    const reporterOccurrences = recipients.filter((id) => id === "reporter-1");
    expect(reporterOccurrences).toHaveLength(1);
  });
});

// ─── issue_comment_added ─────────────────────────────────────────────────────

describe("computeIssueCommentRecipients — issue_comment_added", () => {
  it("always includes the issue reporter", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).toContain("reporter-1");
  });

  it("always includes the comment author", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).toContain("author-1");
  });

  it("includes the assignee when one is set", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("reporter-1", "assignee-1", "author-1", getPermittedIds);
    expect(recipients).toContain("assignee-1");
  });

  it("does NOT include an absent assignee (null)", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).not.toContain(null);
    expect(recipients.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("includes users with admin.manage_all permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": [],
    });
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).toContain("admin-1");
  });

  it("includes users with hr.view_team permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": [],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).toContain("hr-mgr-1");
  });

  it("does NOT include users who hold neither permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": [],
    });
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).not.toContain("random-user");
  });

  it("calls getPermittedIds for both admin.manage_all and hr.view_team", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("admin.manage_all");
    expect(getPermittedIds).toHaveBeenCalledWith("hr.view_team");
  });

  it("de-duplicates when reporter is also the comment author", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("user-1", null, "user-1", getPermittedIds);
    const occurrences = recipients.filter((id) => id === "user-1");
    expect(occurrences).toHaveLength(1);
  });

  it("de-duplicates when all three parties are the same user", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("user-1", "user-1", "user-1", getPermittedIds);
    expect(recipients).toStrictEqual(["user-1"]);
  });

  it("returns reporter + author when no assignee and no privileged users", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeIssueCommentRecipients("reporter-1", null, "author-1", getPermittedIds);
    expect(recipients).toStrictEqual(["reporter-1", "author-1"]);
  });
});

// ─── huddle_updated ──────────────────────────────────────────────────────────

describe("computeHuddleRecipients — huddle_updated", () => {
  it("returns all store members for the given storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1", "emp-2", "mgr-1"] });
    const recipients = await computeHuddleRecipients("store-a", getStoreUserIds);
    expect(recipients).toContain("emp-1");
    expect(recipients).toContain("emp-2");
    expect(recipients).toContain("mgr-1");
  });

  it("calls getStoreUserIds with the correct storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-xyz": ["emp-1"] });
    await computeHuddleRecipients("store-xyz", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-xyz");
  });

  it("does NOT include users from a different store", async () => {
    const getStoreUserIds = makeGetStoreUserIds({
      "store-a": ["emp-a1", "emp-a2"],
      "store-b": ["emp-b1", "emp-b2"],
    });
    const recipients = await computeHuddleRecipients("store-a", getStoreUserIds);
    expect(recipients).not.toContain("emp-b1");
    expect(recipients).not.toContain("emp-b2");
  });

  it("does NOT call getStoreUserIds with any storeId other than the huddle's storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1"] });
    await computeHuddleRecipients("store-a", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledTimes(1);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-a");
  });

  it("returns an empty list when the store has no members", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": [] });
    const recipients = await computeHuddleRecipients("store-a", getStoreUserIds);
    expect(recipients).toStrictEqual([]);
  });
});

// ─── schedule_created / schedule_updated / schedule_deleted ──────────────────

describe("computeScheduleStoreRecipients — schedule_created / schedule_updated / schedule_deleted", () => {
  it("returns all store members for the given storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1", "emp-2", "mgr-1"] });
    const recipients = await computeScheduleStoreRecipients("store-a", getStoreUserIds);
    expect(recipients).toContain("emp-1");
    expect(recipients).toContain("emp-2");
    expect(recipients).toContain("mgr-1");
  });

  it("calls getStoreUserIds with the correct storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-abc": ["emp-1"] });
    await computeScheduleStoreRecipients("store-abc", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-abc");
  });

  it("does NOT include users from a different store", async () => {
    const getStoreUserIds = makeGetStoreUserIds({
      "store-a": ["emp-a1", "emp-a2"],
      "store-b": ["emp-b1", "emp-b2"],
    });
    const recipients = await computeScheduleStoreRecipients("store-a", getStoreUserIds);
    expect(recipients).not.toContain("emp-b1");
    expect(recipients).not.toContain("emp-b2");
  });

  it("does NOT call getStoreUserIds more than once", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1"] });
    await computeScheduleStoreRecipients("store-a", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the store has no active members", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-empty": [] });
    const recipients = await computeScheduleStoreRecipients("store-empty", getStoreUserIds);
    expect(recipients).toStrictEqual([]);
  });
});

// ─── shoutout_created / shoutout_reaction ────────────────────────────────────

describe("computeShoutoutRecipients — shoutout_created / shoutout_reaction", () => {
  it("returns all store members for the given storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1", "emp-2", "emp-3"] });
    const recipients = await computeShoutoutRecipients("store-a", getStoreUserIds);
    expect(recipients).toContain("emp-1");
    expect(recipients).toContain("emp-2");
    expect(recipients).toContain("emp-3");
  });

  it("calls getStoreUserIds with the correct storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-x": ["emp-1"] });
    await computeShoutoutRecipients("store-x", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-x");
  });

  it("does NOT include users from a different store — store-boundary exclusion", async () => {
    const getStoreUserIds = makeGetStoreUserIds({
      "store-a": ["emp-a1", "emp-a2"],
      "store-b": ["emp-b1", "emp-b2"],
    });
    const recipients = await computeShoutoutRecipients("store-a", getStoreUserIds);
    expect(recipients).not.toContain("emp-b1");
    expect(recipients).not.toContain("emp-b2");
  });

  it("does NOT call getStoreUserIds with any storeId other than the shoutout's storeId", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": ["emp-1"] });
    await computeShoutoutRecipients("store-a", getStoreUserIds);
    expect(getStoreUserIds).toHaveBeenCalledTimes(1);
    expect(getStoreUserIds).toHaveBeenCalledWith("store-a");
  });

  it("returns an empty list when the store has no active members", async () => {
    const getStoreUserIds = makeGetStoreUserIds({ "store-empty": [] });
    const recipients = await computeShoutoutRecipients("store-empty", getStoreUserIds);
    expect(recipients).toStrictEqual([]);
  });

  it("returns the full member list including senders and reactors", async () => {
    const members = ["sender-1", "recipient-1", "emp-3", "mgr-1"];
    const getStoreUserIds = makeGetStoreUserIds({ "store-a": members });
    const recipients = await computeShoutoutRecipients("store-a", getStoreUserIds);
    for (const m of members) expect(recipients).toContain(m);
    expect(recipients).toHaveLength(4);
  });
});

// ─── Route wiring audit ───────────────────────────────────────────────────────
//
// For each sensitive event type, verify that the route file:
//   (a) calls sendToUsers with that event type string, AND
//   (b) does NOT call broadcastToAll with that event type string.
//
// This acts as a regression guard: if someone accidentally changes
// `sendToUsers(recipients, { type: 'time_entry_created', … })` to
// `broadcastToAll({ type: 'time_entry_created', … })`, the test fails.

interface WiringCase {
  label: string;
  file: string;
  eventType: string;
  /** Name of the compute*Recipients helper from broadcastRecipients.ts */
  helperFn: string;
}

const WIRING_CASES: WiringCase[] = [
  {
    label: "time_entry_created",
    file: "server/routes/timeEntries.ts",
    eventType: "time_entry_created",
    helperFn: "computeTimeEntryRecipients",
  },
  {
    label: "time_entry_updated",
    file: "server/routes/timeEntries.ts",
    eventType: "time_entry_updated",
    helperFn: "computeTimeEntryRecipients",
  },
  {
    label: "debrief_submitted",
    file: "server/routes/rituals.ts",
    eventType: "debrief_submitted",
    helperFn: "computeDebriefRecipients",
  },
  {
    label: "inbox_item_created",
    file: "server/routes/gtd.ts",
    eventType: "inbox_item_created",
    helperFn: "computeGtdInboxRecipients",
  },
  {
    label: "inbox_item_processed",
    file: "server/routes/gtd.ts",
    eventType: "inbox_item_processed",
    helperFn: "computeGtdInboxRecipients",
  },
  {
    label: "action_created",
    file: "server/routes/gtd.ts",
    eventType: "action_created",
    helperFn: "computeGtdActionRecipients",
  },
  {
    label: "action_completed",
    file: "server/routes/gtd.ts",
    eventType: "action_completed",
    helperFn: "computeGtdActionRecipients",
  },
  {
    label: "new_message (schedule DM)",
    file: "server/routes/schedules.ts",
    eventType: "new_message",
    helperFn: "computeScheduleDmRecipients",
  },
  {
    label: "kudo_sent",
    file: "server/routes/rituals.ts",
    eventType: "kudo_sent",
    helperFn: "computeKudoRecipients",
  },
  {
    label: "issue_created",
    file: "server/routes/issues.ts",
    eventType: "issue_created",
    helperFn: "computeIssueRecipients",
  },
  {
    label: "issue_updated",
    file: "server/routes/issues.ts",
    eventType: "issue_updated",
    helperFn: "computeIssueRecipients",
  },
  {
    label: "issue_comment_added",
    file: "server/routes/issues.ts",
    eventType: "issue_comment_added",
    helperFn: "computeIssueCommentRecipients",
  },
  {
    label: "huddle_updated",
    file: "server/routes/rituals.ts",
    eventType: "huddle_updated",
    helperFn: "computeHuddleRecipients",
  },
  {
    label: "schedule_created",
    file: "server/routes/schedules.ts",
    eventType: "schedule_created",
    helperFn: "computeScheduleStoreRecipients",
  },
  {
    label: "schedule_updated",
    file: "server/routes/schedules.ts",
    eventType: "schedule_updated",
    helperFn: "computeScheduleStoreRecipients",
  },
  {
    label: "schedule_deleted",
    file: "server/routes/schedules.ts",
    eventType: "schedule_deleted",
    helperFn: "computeScheduleStoreRecipients",
  },
  {
    label: "shoutout_created",
    file: "server/routes/communication.ts",
    eventType: "shoutout_created",
    helperFn: "computeShoutoutRecipients",
  },
  {
    label: "shoutout_reaction",
    file: "server/routes/communication.ts",
    eventType: "shoutout_reaction",
    helperFn: "computeShoutoutRecipients",
  },
];

describe("Route wiring audit — sensitive events use sendToUsers, never broadcastToAll", () => {
  for (const { label, file, eventType, helperFn } of WIRING_CASES) {
    it(`${label}: emitted via sendToUsers in ${file}`, () => {
      const source = readRoute(file);

      const sendToUsersPattern = new RegExp(
        `sendToUsers\\s*\\([\\s\\S]*?['"]${eventType}['"]`,
        "s",
      );
      expect(
        sendToUsersPattern.test(source),
        `Expected '${label}' to be broadcast via sendToUsers(...) in ${file}, ` +
          "but the pattern was not found. Has the call been removed or renamed?",
      ).toBe(true);
    });

    it(`${label}: NOT emitted via broadcastToAll in ${file}`, () => {
      const source = readRoute(file);

      // Require type: to appear as the first key inside the object so the
      // pattern does not accidentally span across multiple broadcastToAll calls.
      const broadcastToAllPattern = new RegExp(
        `broadcastToAll\\s*\\(\\s*\\{\\s*type:\\s*['"]${eventType}['"]`,
      );
      expect(
        broadcastToAllPattern.test(source),
        `'${label}' is emitted via broadcastToAll in ${file}. ` +
          "Sensitive events must use sendToUsers(recipients, …) with a filtered recipient list " +
          "(see server/lib/broadcastRecipients.ts for the helper functions).",
      ).toBe(false);
    });

    it(`${label}: recipient list computed via ${helperFn}() in ${file}`, () => {
      const source = readRoute(file);

      // Verify the route imports and calls the specific compute helper from
      // broadcastRecipients.ts.  This tightens coupling so removing the helper
      // (or inlining its logic) breaks the test immediately.
      const helperCallPattern = new RegExp(`\\b${helperFn}\\s*\\(`);
      expect(
        helperCallPattern.test(source),
        `Expected ${file} to call ${helperFn}() for '${label}' recipients, ` +
          "but the helper call was not found. Recipient logic must remain in " +
          "server/lib/broadcastRecipients.ts and called from the route.",
      ).toBe(true);
    });
  }
});
