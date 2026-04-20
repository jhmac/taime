/**
 * SOP execution recipient-list guard
 *
 * Task #229: The existing static audit (sopExecutionWebSocketAudit.test.ts)
 * confirms that sendToUsers() is used instead of broadcastToAll() for SOP
 * execution events, but it cannot verify that the recipient list passed to
 * sendToUsers() is ever non-empty.  If getUserIdsWithPermission() silently
 * returned an empty array for every permission name, the events for
 * execution_started / step_completed / execution_completed would reach only
 * the employee (good), while sign_off_requested would silently disappear.
 *
 * These tests exercise the recipient-building helpers in
 * server/lib/broadcastRecipients.ts with a stubbed getPermittedIds callback
 * so no database or Express context is required.  They assert:
 *
 *  1. The recipient list is non-empty for every event under normal conditions.
 *  2. Events that include a fixed employee ID remain non-empty even if every
 *     permission lookup returns [].
 *  3. sign_off_requested recipients reflect all three sign-off-eligible
 *     permissions: admin.manage_all, admin.role_management, admin.manage_payroll.
 *  4. The sign_off_requested recipient list IS empty when all permission
 *     lookups return [] — documenting the risk the route-level guard was added
 *     to address.
 *  5. sign_off_completed always contains exactly the employee and the manager.
 *
 * If a future refactor causes getUserIdsWithPermission to always return [] and
 * the sign_off_requested guard is removed, test #4 will pass but the route
 * wiring test in sopExecutionWebSocketAudit.test.ts will expose the regression.
 */

import { describe, it, expect, vi } from "vitest";
import {
  computeSopManagerRecipients,
  computeSopSignOffEligibleRecipients,
  computeSopSignOffCompletedRecipients,
  type GetPermittedIds,
} from "../server/lib/broadcastRecipients";

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a mock getPermittedIds that returns a fixed list for every permission.
 */
function makeGetPermittedIds(ids: string[]): GetPermittedIds {
  return vi.fn().mockResolvedValue(ids);
}

/**
 * Builds a mock getPermittedIds that returns different lists per permission name.
 */
function makeGetPermittedIdsByPerm(map: Record<string, string[]>): GetPermittedIds {
  return vi.fn().mockImplementation((perm: string) =>
    Promise.resolve(map[perm] ?? []),
  );
}

// ─── execution_started ───────────────────────────────────────────────────────

describe("computeSopManagerRecipients — execution_started / step_completed / execution_completed", () => {
  it("always includes the employee even when no managers hold any permission", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("emp-1");
  });

  it("recipient list is non-empty when all permission lookups return []", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients.length).toBeGreaterThan(0);
  });

  it("includes admin.manage_all holders alongside the employee", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1", "admin-2"],
      "hr.view_team": [],
    });
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("emp-1");
    expect(recipients).toContain("admin-1");
    expect(recipients).toContain("admin-2");
  });

  it("includes hr.view_team holders alongside the employee", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": [],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("emp-1");
    expect(recipients).toContain("hr-mgr-1");
  });

  it("combines both permission groups into a single de-duplicated list", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1", "shared-mgr"],
      "hr.view_team": ["hr-mgr-1", "shared-mgr"],
    });
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients).toContain("emp-1");
    expect(recipients).toContain("admin-1");
    expect(recipients).toContain("hr-mgr-1");
    const sharedOccurrences = recipients.filter((id) => id === "shared-mgr");
    expect(sharedOccurrences).toHaveLength(1);
  });

  it("de-duplicates when the employee also holds admin.manage_all", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["emp-1", "admin-2"],
      "hr.view_team": [],
    });
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    const empOccurrences = recipients.filter((id) => id === "emp-1");
    expect(empOccurrences).toHaveLength(1);
  });

  it("calls getPermittedIds for admin.manage_all", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("admin.manage_all");
  });

  it("calls getPermittedIds for hr.view_team", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("hr.view_team");
  });

  it("does NOT include users who hold neither permission", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients).not.toContain("random-user");
    expect(recipients).not.toContain("sales-only-user");
  });

  it("recipient list is non-empty with a full manager set", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "hr.view_team": ["hr-mgr-1"],
    });
    const recipients = await computeSopManagerRecipients("emp-1", getPermittedIds);
    expect(recipients.length).toBeGreaterThan(0);
  });
});

// ─── sign_off_requested ──────────────────────────────────────────────────────

describe("computeSopSignOffEligibleRecipients — sign_off_requested", () => {
  it("includes admin.manage_all holders", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "admin.role_management": [],
      "admin.manage_payroll": [],
    });
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients).toContain("admin-1");
  });

  it("includes admin.role_management holders", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": [],
      "admin.role_management": ["role-mgr-1"],
      "admin.manage_payroll": [],
    });
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients).toContain("role-mgr-1");
  });

  it("includes admin.manage_payroll holders", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": [],
      "admin.role_management": [],
      "admin.manage_payroll": ["payroll-mgr-1"],
    });
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients).toContain("payroll-mgr-1");
  });

  it("combines all three permission groups into a single de-duplicated list", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1", "shared"],
      "admin.role_management": ["role-mgr-1", "shared"],
      "admin.manage_payroll": ["payroll-mgr-1"],
    });
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients).toContain("admin-1");
    expect(recipients).toContain("role-mgr-1");
    expect(recipients).toContain("payroll-mgr-1");
    const sharedOccurrences = recipients.filter((id) => id === "shared");
    expect(sharedOccurrences).toHaveLength(1);
  });

  it("is non-empty when at least one permission group has members", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "admin.role_management": [],
      "admin.manage_payroll": [],
    });
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients.length).toBeGreaterThan(0);
  });

  it("calls getPermittedIds for all three sign-off permission names", async () => {
    const getPermittedIds = makeGetPermittedIds(["admin-1"]);
    await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(getPermittedIds).toHaveBeenCalledWith("admin.manage_all");
    expect(getPermittedIds).toHaveBeenCalledWith("admin.role_management");
    expect(getPermittedIds).toHaveBeenCalledWith("admin.manage_payroll");
  });

  it("does NOT include users who hold none of the three permissions", async () => {
    const getPermittedIds = makeGetPermittedIdsByPerm({
      "admin.manage_all": ["admin-1"],
      "admin.role_management": [],
      "admin.manage_payroll": [],
    });
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients).not.toContain("random-employee");
    expect(recipients).not.toContain("hr-only-user");
  });

  /**
   * This test documents the known risk: if every permission lookup returns []
   * (e.g. due to a misconfigured permission table), the recipient list will be
   * empty and sign_off_requested would be silently dropped unless the caller
   * has a length guard.  The route handler in server/routes/sops.ts skips the
   * sendToUsers call and logs a warning when this happens.
   */
  it("returns an empty list when all permission lookups return [] — documents the silent-drop risk", async () => {
    const getPermittedIds = makeGetPermittedIds([]);
    const recipients = await computeSopSignOffEligibleRecipients(getPermittedIds);
    expect(recipients).toHaveLength(0);
  });
});

// ─── sign_off_completed ──────────────────────────────────────────────────────

describe("computeSopSignOffCompletedRecipients — sign_off_completed", () => {
  it("always includes the employee who ran the SOP", () => {
    const recipients = computeSopSignOffCompletedRecipients("emp-1", "mgr-1");
    expect(recipients).toContain("emp-1");
  });

  it("always includes the manager who approved the sign-off", () => {
    const recipients = computeSopSignOffCompletedRecipients("emp-1", "mgr-1");
    expect(recipients).toContain("mgr-1");
  });

  it("recipient list is non-empty — requires no permission lookup", () => {
    const recipients = computeSopSignOffCompletedRecipients("emp-1", "mgr-1");
    expect(recipients.length).toBeGreaterThan(0);
  });

  it("returns exactly [employeeId, managerId] when they are different users", () => {
    const recipients = computeSopSignOffCompletedRecipients("emp-1", "mgr-1");
    expect(recipients).toStrictEqual(["emp-1", "mgr-1"]);
  });

  it("de-duplicates when the employee is also the manager (self-sign-off edge case)", () => {
    const recipients = computeSopSignOffCompletedRecipients("user-1", "user-1");
    expect(recipients).toStrictEqual(["user-1"]);
  });

  it("does NOT include any other user", () => {
    const recipients = computeSopSignOffCompletedRecipients("emp-1", "mgr-1");
    expect(recipients).not.toContain("other-emp");
    expect(recipients).not.toContain("admin-99");
    expect(recipients).toHaveLength(2);
  });
});

// ─── Route wiring audit (complements sopExecutionWebSocketAudit.test.ts) ────
//
// Verify that sops.ts now calls the three compute helpers instead of the
// removed private getManagerUserIds / getSignOffEligibleUserIds functions.

import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const SOPS_SOURCE = readFileSync(resolve(ROOT, "server/routes/sops.ts"), "utf-8");

describe("SOP route helper wiring audit", () => {
  it("calls computeSopManagerRecipients for execution_started", () => {
    expect(/computeSopManagerRecipients\s*\(/.test(SOPS_SOURCE)).toBe(true);
  });

  it("calls computeSopSignOffEligibleRecipients for sign_off_requested", () => {
    expect(/computeSopSignOffEligibleRecipients\s*\(/.test(SOPS_SOURCE)).toBe(true);
  });

  it("calls computeSopSignOffCompletedRecipients for sign_off_completed", () => {
    expect(/computeSopSignOffCompletedRecipients\s*\(/.test(SOPS_SOURCE)).toBe(true);
  });

  it("no longer uses the removed private getManagerUserIds helper", () => {
    expect(/\bgetManagerUserIds\s*\(/.test(SOPS_SOURCE)).toBe(false);
  });

  it("no longer uses the removed private getSignOffEligibleUserIds helper", () => {
    expect(/\bgetSignOffEligibleUserIds\s*\(/.test(SOPS_SOURCE)).toBe(false);
  });

  it("guards sign_off_requested against an empty recipient list before calling sendToUsers", () => {
    expect(/signOffEligibleIds\.length\s*>\s*0/.test(SOPS_SOURCE)).toBe(true);
  });
});
