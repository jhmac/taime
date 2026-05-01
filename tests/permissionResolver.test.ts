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
});
