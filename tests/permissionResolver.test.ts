import { describe, it, expect, vi } from 'vitest';
import {
  buildPermissionResolver,
  resolvePermission,
  resolveAnyPermission,
} from '../server/services/permissionResolver';

// ---------------------------------------------------------------------------
// buildPermissionResolver — pure unit tests (no DB)
// ---------------------------------------------------------------------------

describe('buildPermissionResolver (pure helper)', () => {
  describe('explicit deny override (override=false)', () => {
    it('returns false even when the role grants the permission', () => {
      const overrides = [{ permissionName: 'sales.view_all', grant: false }];
      const rolePerms = [{ name: 'sales.view_all' }];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('sales.view_all')).toBe(false);
    });

    it('returns false even when isOwnerOrAdmin is false and role has the permission', () => {
      const overrides = [{ permissionName: 'admin.manage_all', grant: false }];
      const rolePerms = [{ name: 'admin.manage_all' }];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('admin.manage_all')).toBe(false);
    });
  });

  describe('explicit grant override (override=true)', () => {
    it('returns true even when the role does NOT grant the permission', () => {
      const overrides = [{ permissionName: 'sales.view_all', grant: true }];
      const rolePerms: { name: string }[] = [];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('sales.view_all')).toBe(true);
    });

    it('returns true for the granted permission while unrelated keys still deny', () => {
      const overrides = [{ permissionName: 'sales.view_all', grant: true }];
      const rolePerms: { name: string }[] = [];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('sales.view_all')).toBe(true);
      expect(resolve('hr.edit_team')).toBe(false);
    });
  });

  describe('no override — falls through to role default', () => {
    it('returns true when the role grants the permission and there is no override', () => {
      const overrides: { permissionName: string; grant: boolean }[] = [];
      const rolePerms = [{ name: 'sales.view_all' }];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('sales.view_all')).toBe(true);
    });

    it('returns false (implicit deny) when no override and the role does not grant the permission', () => {
      const overrides: { permissionName: string; grant: boolean }[] = [];
      const rolePerms = [{ name: 'hr.edit_team' }];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('sales.view_all')).toBe(false);
    });

    it('returns false when both overrides and rolePerms are empty', () => {
      const resolve = buildPermissionResolver([], [], false);

      expect(resolve('sales.view_all')).toBe(false);
      expect(resolve('admin.manage_all')).toBe(false);
    });
  });

  describe('owner/admin short-circuit (isOwnerOrAdmin=true)', () => {
    it('returns true for any permission key when isOwnerOrAdmin is true', () => {
      const resolve = buildPermissionResolver([], [], true);

      expect(resolve('sales.view_all')).toBe(true);
      expect(resolve('admin.manage_all')).toBe(true);
      expect(resolve('hr.edit_team')).toBe(true);
    });

    it('returns true even when rolePerms is empty', () => {
      const resolve = buildPermissionResolver([], [], true);

      expect(resolve('some.obscure.permission')).toBe(true);
    });

    it('returns true even when an explicit deny override exists', () => {
      // Owner/admin short-circuit fires before any override check,
      // so deny overrides do not apply to owners or admins.
      const overrides = [{ permissionName: 'sales.view_all', grant: false }];
      const resolve = buildPermissionResolver(overrides, [], true);

      expect(resolve('sales.view_all')).toBe(true);
    });

    it('returns true for an explicit grant override when isOwnerOrAdmin is true', () => {
      const overrides = [{ permissionName: 'sales.view_all', grant: true }];
      const resolve = buildPermissionResolver(overrides, [], true);

      expect(resolve('sales.view_all')).toBe(true);
    });
  });

  describe('multiple overrides and role permissions', () => {
    it('resolves each key independently', () => {
      const overrides = [
        { permissionName: 'sales.view_all', grant: false },
        { permissionName: 'hr.edit_team', grant: true },
      ];
      const rolePerms = [{ name: 'sales.view_all' }, { name: 'reports.view' }];
      const resolve = buildPermissionResolver(overrides, rolePerms, false);

      expect(resolve('sales.view_all')).toBe(false); // override deny beats role grant
      expect(resolve('hr.edit_team')).toBe(true);    // override grant beats no role grant
      expect(resolve('reports.view')).toBe(true);    // no override, role grants it
      expect(resolve('admin.manage_all')).toBe(false); // no override, no role grant
    });
  });
});

// ---------------------------------------------------------------------------
// resolvePermission — DB-backed resolver (mock storage injection)
// ---------------------------------------------------------------------------

describe('resolvePermission (DB-backed)', () => {
  it('returns true when storage.getUserPermissions includes the permission', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'sales.view_all' },
        { name: 'hr.edit_team' },
      ]),
    };

    const result = await resolvePermission('user-1', 'sales.view_all', mockStorage);

    expect(result).toBe(true);
    expect(mockStorage.getUserPermissions).toHaveBeenCalledWith('user-1');
  });

  it('returns false when storage.getUserPermissions does not include the permission', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'hr.edit_team' },
      ]),
    };

    const result = await resolvePermission('user-1', 'sales.view_all', mockStorage);

    expect(result).toBe(false);
  });

  it('returns false when storage.getUserPermissions returns an empty array', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([]),
    };

    const result = await resolvePermission('user-1', 'admin.manage_all', mockStorage);

    expect(result).toBe(false);
  });

  it('delegates to storage with the correct userId', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([{ name: 'sales.view_all' }]),
    };

    await resolvePermission('user-abc-123', 'sales.view_all', mockStorage);

    expect(mockStorage.getUserPermissions).toHaveBeenCalledOnce();
    expect(mockStorage.getUserPermissions).toHaveBeenCalledWith('user-abc-123');
  });
});

// ---------------------------------------------------------------------------
// resolveAnyPermission — DB-backed convenience helper
// ---------------------------------------------------------------------------

describe('resolveAnyPermission (DB-backed)', () => {
  it('returns true when at least one of the keys is present', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([{ name: 'hr.edit_team' }]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['sales.view_all', 'hr.edit_team'],
      mockStorage,
    );

    expect(result).toBe(true);
  });

  it('returns false when none of the keys are present', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([{ name: 'reports.view' }]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['sales.view_all', 'hr.edit_team'],
      mockStorage,
    );

    expect(result).toBe(false);
  });

  it('calls getUserPermissions exactly once regardless of how many keys are checked', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([{ name: 'sales.view_all' }]),
    };

    await resolveAnyPermission(
      'user-1',
      ['sales.view_all', 'hr.edit_team', 'admin.manage_all'],
      mockStorage,
    );

    expect(mockStorage.getUserPermissions).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Edge cases — empty key lists, single-element lists, large sets, and
  // ordering of matches inside the requested key list.
  // -------------------------------------------------------------------------

  it('returns false for an empty permissionKeys array', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'sales.view_all' },
        { name: 'hr.edit_team' },
      ]),
    };

    const result = await resolveAnyPermission('user-1', [], mockStorage);

    expect(result).toBe(false);
  });

  it('returns false for an empty permissionKeys array even when the user has no permissions', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([]),
    };

    const result = await resolveAnyPermission('user-1', [], mockStorage);

    expect(result).toBe(false);
  });

  it('returns true for a single-element list when the key is present', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'sales.view_all' },
      ]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['sales.view_all'],
      mockStorage,
    );

    expect(result).toBe(true);
  });

  it('returns false for a single-element list when the key is absent', async () => {
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'reports.view' },
      ]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['sales.view_all'],
      mockStorage,
    );

    expect(result).toBe(false);
  });

  it('returns true when the first key is absent but a later key is present (no false short-circuit)', async () => {
    // Guards against a regression where `.some()` would be replaced by an
    // early `return false` on the first miss. The user only has the third
    // requested key, so the helper must scan past the first two misses.
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'admin.manage_all' },
      ]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['sales.view_all', 'hr.edit_team', 'admin.manage_all'],
      mockStorage,
    );

    expect(result).toBe(true);
  });

  it('returns true when only the last key in a long list matches', async () => {
    const requestedKeys = Array.from({ length: 50 }, (_, i) => `perm.key_${i}`);
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([
        { name: 'perm.key_49' },
      ]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      requestedKeys,
      mockStorage,
    );

    expect(result).toBe(true);
  });

  it('returns true with a large permission set (1000 perms) when one key matches', async () => {
    const userPerms = Array.from({ length: 1000 }, (_, i) => ({
      name: `perm.key_${i}`,
    }));
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue(userPerms),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['perm.key_999', 'unrelated.key'],
      mockStorage,
    );

    expect(result).toBe(true);
    expect(mockStorage.getUserPermissions).toHaveBeenCalledOnce();
  });

  it('returns false with a large permission set (1000 perms) when no requested key matches', async () => {
    const userPerms = Array.from({ length: 1000 }, (_, i) => ({
      name: `perm.key_${i}`,
    }));
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue(userPerms),
    };

    const result = await resolveAnyPermission(
      'user-1',
      ['missing.one', 'missing.two', 'missing.three'],
      mockStorage,
    );

    expect(result).toBe(false);
  });

  it('returns true with a large requested key list (1000 keys) when one matches', async () => {
    const requestedKeys = Array.from({ length: 1000 }, (_, i) => `req.key_${i}`);
    const mockStorage = {
      getUserPermissions: vi.fn().mockResolvedValue([{ name: 'req.key_500' }]),
    };

    const result = await resolveAnyPermission(
      'user-1',
      requestedKeys,
      mockStorage,
    );

    expect(result).toBe(true);
  });
});
