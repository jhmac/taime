import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_PATH = resolve(__dirname, '..', 'server', 'lib', 'migrations.ts');
const STORAGE_PATH = resolve(__dirname, '..', 'server', 'storage', 'identity.ts');

const CONSOLIDATION_HINT = [
  '',
  'Task #445 consolidated the legacy `sales.view` permission into the canonical',
  '`sales.view_all`. Both keys overlapped semantically and were granted to the',
  'same roles. The legacy key has been removed from the seeded permission',
  'registry, all runtime permission checks were migrated, and an idempotent',
  'data migration in `consolidateLegacySalesPermission()` rewrites any leftover',
  'override / role-permission / permission rows on every boot.',
  '',
  'If you see this test failing, you have either re-introduced the legacy key,',
  'changed the canonical key without updating the migration, or moved the',
  'consolidation step somewhere it can no longer find the table. See',
  '`.local/tasks/task-445.md` for the full mapping rules.',
].join('\n');

/**
 * Slice out the regions of migrations.ts that are *expected* to mention the
 * literal 'sales.view' string (the consolidation helper itself plus the short
 * comment block above the call to it). What remains should contain no
 * references to the legacy key.
 */
function migrationsSrcWithoutMigrationBlock(src: string): string {
  // 1) Strip the JSDoc + function body for consolidateLegacySalesPermission.
  //    Match from the JSDoc opener through the function's closing brace at
  //    column 0.
  const jsdocMarker = '/**\n * Consolidates the legacy';
  const fnSignature = 'export async function consolidateLegacySalesPermission';
  const jsdocStart = src.indexOf(jsdocMarker);
  const fnStart = src.indexOf(fnSignature);
  const blockStart = jsdocStart >= 0 ? jsdocStart : fnStart;
  if (blockStart < 0) return src;
  // Find the function's closing brace: the first `\n}\n` after the opening `{`.
  const fnOpen = src.indexOf('{', fnStart);
  let depth = 0;
  let blockEnd = -1;
  for (let i = fnOpen; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        blockEnd = i + 1;
        break;
      }
    }
  }
  if (blockEnd < 0) return src;
  let cleaned = src.slice(0, blockStart) + src.slice(blockEnd);

  // 2) Strip the short comment + call site that references the helper, which
  //    intentionally mentions 'sales.view' in prose.
  cleaned = cleaned.replace(
    /\/\/ Now that user_permission_overrides[\s\S]*?await consolidateLegacySalesPermission\(\);/,
    '',
  );
  return cleaned;
}

describe('sales permission consolidation (task #445)', () => {
  const migrationsSrc = readFileSync(MIGRATIONS_PATH, 'utf8');
  const storageSrc = readFileSync(STORAGE_PATH, 'utf8');

  describe('seeded permission registry', () => {
    it('does NOT define the legacy `sales.view` permission anywhere outside the migration helper', () => {
      const cleaned = migrationsSrcWithoutMigrationBlock(migrationsSrc);
      expect(
        cleaned.includes("'sales.view'"),
        `server/lib/migrations.ts still references the legacy 'sales.view' permission outside the consolidation helper.${CONSOLIDATION_HINT}`,
      ).toBe(false);
    });

    it("does define the canonical `sales.view_all` permission with 'Employees' wording", () => {
      // Single source-of-truth check: the seed line for sales.view_all exists
      // and uses the cleaned-up "Employees" wording from task #445 step 2.
      const seedLineMatch = /name:\s*'sales\.view_all'[\s\S]*?description:\s*'([^']+)'/m.exec(migrationsSrc);
      expect(
        seedLineMatch,
        `server/lib/migrations.ts is missing the seed entry for 'sales.view_all'.${CONSOLIDATION_HINT}`,
      ).not.toBeNull();
      const description = seedLineMatch![1];
      expect(
        /team\s*member/i.test(description),
        `The seeded description for 'sales.view_all' still says 'team member' — task #445 step 2 asked for 'Employee' wording. Current value: ${JSON.stringify(description)}.${CONSOLIDATION_HINT}`,
      ).toBe(false);
      expect(
        /employee/i.test(description),
        `The seeded description for 'sales.view_all' should mention Employees. Current value: ${JSON.stringify(description)}.${CONSOLIDATION_HINT}`,
      ).toBe(true);
    });

    it('grants `sales.view_all` to the admin and manager role defaults (and owner inherits via permissionDefs.map)', () => {
      // Owner is special: it grants everything in `permissionDefs` via
      // `permissionDefs.map(p => p.name)`. Therefore as long as
      // 'sales.view_all' is in permissionDefs (asserted in the previous test)
      // and 'sales.view' is NOT (asserted in the first test), owner is
      // automatically correct. We only need to assert admin and manager
      // explicitly because their grants are hand-listed.
      for (const role of ['adminPerms', 'managerPerms']) {
        const blockRegex = new RegExp(`const ${role}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
        const match = blockRegex.exec(migrationsSrc);
        expect(
          match,
          `Could not locate the '${role}' grant array in server/lib/migrations.ts.${CONSOLIDATION_HINT}`,
        ).not.toBeNull();
        const grants = match![1];
        expect(
          grants.includes("'sales.view_all'"),
          `'${role}' is missing the canonical 'sales.view_all' grant.${CONSOLIDATION_HINT}`,
        ).toBe(true);
        expect(
          grants.includes("'sales.view'"),
          `'${role}' still grants the legacy 'sales.view' — should be 'sales.view_all' only.${CONSOLIDATION_HINT}`,
        ).toBe(false);
      }
    });
  });

  describe('consolidation migration helper', () => {
    it('exports `consolidateLegacySalesPermission` and is invoked AFTER `user_permission_overrides` is created', () => {
      // The helper MUST be invoked after the table exists, otherwise the very
      // first SQL statement throws and the cleanup is skipped silently on a
      // fresh boot. This invariant is what the architect review of task #445
      // flagged as severity-elevated.
      const tableCreateIdx = migrationsSrc.indexOf('CREATE TABLE IF NOT EXISTS user_permission_overrides');
      const callIdx = migrationsSrc.indexOf('await consolidateLegacySalesPermission(');
      expect(
        tableCreateIdx,
        `Missing CREATE TABLE for user_permission_overrides.${CONSOLIDATION_HINT}`,
      ).toBeGreaterThan(0);
      expect(
        callIdx,
        `Missing call to consolidateLegacySalesPermission() in runSchemaMigrations.${CONSOLIDATION_HINT}`,
      ).toBeGreaterThan(0);
      expect(
        callIdx > tableCreateIdx,
        `consolidateLegacySalesPermission() must be called AFTER user_permission_overrides is created. Otherwise the migration silently no-ops on a fresh boot.${CONSOLIDATION_HINT}`,
      ).toBe(true);
    });

    it('contains all four idempotent SQL statements (override rename, override cleanup, role_permissions delete, permissions delete)', () => {
      // (a) Rename overrides 'sales.view' -> 'sales.view_all' with NOT EXISTS
      // guard so a user already holding the canonical override is preserved.
      // This is the statement that keeps a User-with-migrated-override on the
      // same access level after the consolidation runs.
      expect(
        /UPDATE user_permission_overrides[\s\S]*?SET permission_name = 'sales\.view_all'[\s\S]*?WHERE permission_name = 'sales\.view'[\s\S]*?NOT EXISTS/i.test(migrationsSrc),
        `Migration is missing the NOT EXISTS-guarded UPDATE that renames 'sales.view' overrides to 'sales.view_all'. This is what preserves access for users with a migrated override.${CONSOLIDATION_HINT}`,
      ).toBe(true);
      // (b) Drop leftover legacy override rows.
      expect(
        /DELETE FROM user_permission_overrides WHERE permission_name = 'sales\.view'/i.test(migrationsSrc),
        `Migration is missing the cleanup DELETE for leftover 'sales.view' overrides.${CONSOLIDATION_HINT}`,
      ).toBe(true);
      // (c) Drop role_permissions referencing the legacy permission.
      expect(
        /DELETE FROM role_permissions[\s\S]*?WHERE name = 'sales\.view'/i.test(migrationsSrc),
        `Migration is missing the DELETE for role_permissions referencing the legacy 'sales.view' permission.${CONSOLIDATION_HINT}`,
      ).toBe(true);
      // (d) Drop the legacy permissions row.
      expect(
        /DELETE FROM permissions WHERE name = 'sales\.view'/i.test(migrationsSrc),
        `Migration is missing the DELETE for the legacy 'sales.view' permissions row.${CONSOLIDATION_HINT}`,
      ).toBe(true);
    });
  });

  describe('storage helpers', () => {
    it('getUserSalesAccessOverride / setUserSalesAccessOverride only reference `sales.view_all`', () => {
      // These two helpers are the canonical read/write path for the per-user
      // sales access override. They must use ONLY the canonical key — the
      // migration handles the rename of any legacy rows on boot, so the
      // helpers never need to fall back to 'sales.view'. (This is the
      // mechanism behind the "denied-without-either" acceptance scenario:
      // with no override row at this key and no role grant, getUserPermissions
      // returns no sales.view_all permission for the user.)
      const start = storageSrc.indexOf('async getUserSalesAccessOverride');
      const end = storageSrc.indexOf('async getCompanySettings');
      const helperBlock = start >= 0 && end > start ? storageSrc.slice(start, end) : '';
      expect(
        helperBlock.length > 0,
        `Could not locate getUserSalesAccessOverride / setUserSalesAccessOverride in server/storage/identity.ts.${CONSOLIDATION_HINT}`,
      ).toBe(true);
      expect(
        helperBlock.includes("'sales.view'"),
        `getUserSalesAccessOverride / setUserSalesAccessOverride still reference the legacy 'sales.view' key. The migration renames legacy rows on boot, so the helpers should use 'sales.view_all' only.${CONSOLIDATION_HINT}`,
      ).toBe(false);
      expect(
        (helperBlock.match(/'sales\.view_all'/g) ?? []).length >= 2,
        `getUserSalesAccessOverride / setUserSalesAccessOverride must reference 'sales.view_all' (read + write paths).${CONSOLIDATION_HINT}`,
      ).toBe(true);
    });
  });
});
