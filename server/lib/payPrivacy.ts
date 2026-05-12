import { resolveAnyPermission } from "../services/permissionResolver";
import type { IStorage } from "../storage";
import { db } from "../db";
import { users, roles } from "@shared/schema";
import { eq } from "drizzle-orm";

const PAY_FIELDS = ["hourlyRate", "federalWithholdingPct", "stateWithholdingPct", "otherDeductionsCents"] as const;

export function redactPayFields<T extends Record<string, any>>(user: T): Omit<T, typeof PAY_FIELDS[number]> {
  const copy = { ...user };
  for (const field of PAY_FIELDS) {
    delete copy[field];
  }
  return copy;
}

export function redactPayFieldsFromArray<T extends Record<string, any>>(
  users: T[],
): Omit<T, typeof PAY_FIELDS[number]>[] {
  return users.map(redactPayFields);
}

export async function canSeePayData(
  requestingUserId: string,
  storage: IStorage,
): Promise<boolean> {
  const [row] = await db
    .select({ roleName: roles.name })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, requestingUserId))
    .limit(1);

  if (row?.roleName === "owner" || row?.roleName === "admin") return true;

  return resolveAnyPermission(
    requestingUserId,
    ["hr.view_team", "hr.edit_pay_rates"],
    storage,
  );
}
