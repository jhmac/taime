import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertRoleSchema } from "@shared/schema";
import { cache } from "../services/cache";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { invalidatePermissionCache } from "../lib/permissionUtils";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

async function requireRoleManagement(storageParam: IStorage, userId: string): Promise<void> {
  const allowed = await resolveAnyPermission(userId, ['admin.role_management', 'admin.manage_all'], storageParam);
  if (!allowed) {
    throw new AppError(403, "Permission denied: Role management access required", "FORBIDDEN");
  }
}

export function registerRoleRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/roles', isAuthenticated, asyncHandler(async (_req: any, res) => {
    const cached = cache.get<Awaited<ReturnType<typeof storage.getAllRoles>>>('roles:all');
    if (cached) return res.json(cached);
    const roles = await storage.getAllRoles();
    cache.set('roles:all', roles);
    res.json(roles);
  }));

  app.post('/api/roles', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const data = insertRoleSchema.parse(req.body);
    const role = await storage.createRole(data);
    cache.invalidatePrefix('roles:');
    res.json(role);
  }));

  app.patch('/api/roles/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    const allowedFields = ['name', 'description', 'isDefault'];
    const safeUpdates: Record<string, any> = {};
    for (const key of allowedFields) {
      if (Object.hasOwn(req.body, key) && req.body[key] !== undefined) {
        safeUpdates[key] = req.body[key];
      }
    }
    const role = await storage.updateRole(id, safeUpdates);
    cache.invalidatePrefix('roles:');
    res.json(role);
  }));

  app.delete('/api/roles/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    await storage.deleteRole(id);
    cache.invalidatePrefix('roles:');
    invalidatePermissionCache();
    res.json({ success: true });
  }));

  app.get('/api/permissions', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const cached = cache.get('permissions:by-category');
    if (cached) return res.json(cached);
    const permissions = await storage.getPermissionsByCategory();
    cache.set('permissions:by-category', permissions);
    res.json(permissions);
  }));

  app.get('/api/roles/all-permissions', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const cacheKey = 'roles:all-permissions';
    const cached = cache.get<Record<string, string[]>>(cacheKey);
    if (cached) return res.json(cached);

    const allRoles = await storage.getAllRoles();
    const permResults = await Promise.all(allRoles.map(role => storage.getRolePermissions(role.id)));
    const result: Record<string, string[]> = {};
    allRoles.forEach((role, i) => {
      result[role.id] = permResults[i].map(p => p.id);
    });
    cache.set(cacheKey, result);
    res.json(result);
  }));

  app.get('/api/roles/:id/members', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    const members = await storage.getUsersByRole(id);
    res.json(members.map(u => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email })));
  }));

  app.get('/api/roles/:id/permissions', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    const rolePermissions = await storage.getRolePermissions(id);
    res.json(rolePermissions);
  }));

  app.put('/api/roles/:id/permissions', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds)) {
      throw new AppError(400, "permissionIds must be an array", "VALIDATION_ERROR");
    }

    // Capture current state before updating to detect sales.view_all changes
    const allPermsByCategory = await storage.getPermissionsByCategory();
    const allPerms = Object.values(allPermsByCategory).flat();
    const salesViewPerm = allPerms.find(p => p.name === 'sales.view_all');

    const [prevPermissions, role, affectedEmployees] = await Promise.all([
      storage.getRolePermissions(id),
      storage.getRole(id),
      storage.getUsersByRole(id),
    ]);
    const hadSalesView = prevPermissions.some(p => p.name === 'sales.view_all');
    const newHasSalesView = salesViewPerm ? permissionIds.includes(salesViewPerm.id) : false;

    await storage.updateRolePermissions(id, permissionIds);
    cache.invalidatePrefix('roles:');
    invalidatePermissionCache();

    // Log if sales.view_all access changed for this role
    if (salesViewPerm && hadSalesView !== newHasSalesView) {
      const action = newHasSalesView ? 'grant' : 'revoke';
      const roleName = role?.displayName || role?.name || id;
      const employeeCount = affectedEmployees.length;
      await storage.createActivityLog({
        userId: req.user.id,
        action,
        targetType: 'sales_access',
        targetId: id,
        details: newHasSalesView
          ? `Granted sales data access to the ${roleName} role (${employeeCount} employee${employeeCount !== 1 ? 's' : ''} affected)`
          : `Revoked sales data access from the ${roleName} role (${employeeCount} employee${employeeCount !== 1 ? 's' : ''} affected)`,
        metadata: {
          roleId: id,
          roleName,
          employeeCount,
          accessGranted: newHasSalesView,
          changeType: 'role_permission',
        },
      });
    }

    const updatedPermissions = await storage.getRolePermissions(id);
    res.json(updatedPermissions);
  }));

  // User-level sales access override endpoints
  app.get('/api/users/:id/sales-access', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    // Get effective sales access: role default + override
    const [override, hasSalesAccess] = await Promise.all([
      storage.getUserSalesAccessOverride(id),
      resolvePermission(id, 'sales.view_all', storage),
    ]);
    res.json({
      hasSalesAccess,
      isOverride: override !== null,
      overrideValue: override ? override.grant : null,
    });
  }));

  app.put('/api/users/:id/sales-access', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    const { grant } = req.body;
    if (typeof grant !== 'boolean' && grant !== null) {
      throw new AppError(400, "grant must be true, false, or null", "VALIDATION_ERROR");
    }

    // Fetch current override and target user before making changes
    const [currentOverride, targetUser] = await Promise.all([
      storage.getUserSalesAccessOverride(id),
      storage.getUser(id),
    ]);
    const targetName = targetUser
      ? `${targetUser.firstName} ${targetUser.lastName}`.trim()
      : id;

    // Determine if the override is actually changing to avoid noisy duplicate log entries
    const currentGrantValue = currentOverride ? currentOverride.grant : null;
    const isNoOp = currentGrantValue === grant;

    await storage.setUserSalesAccessOverride(id, grant);
    invalidatePermissionCache('sales.view_all');

    // Log the individual override change only when the value actually changed
    if (!isNoOp) {
      let action: string;
      let details: string;
      if (grant === null) {
        action = 'clear';
        details = `Cleared individual sales data access override for ${targetName} (reverted to role default)`;
      } else if (grant) {
        action = 'grant';
        details = `Granted individual sales data access to ${targetName}`;
      } else {
        action = 'revoke';
        details = `Revoked individual sales data access from ${targetName}`;
      }

      await storage.createActivityLog({
        userId: req.user.id,
        action,
        targetType: 'sales_access',
        targetId: id,
        details,
        metadata: {
          targetUserId: id,
          targetUserName: targetName,
          accessGranted: grant,
          changeType: 'user_override',
        },
      });
    }

    const [override, hasSalesAccess] = await Promise.all([
      storage.getUserSalesAccessOverride(id),
      resolvePermission(id, 'sales.view_all', storage),
    ]);
    res.json({
      hasSalesAccess,
      isOverride: override !== null,
      overrideValue: override ? override.grant : null,
    });
  }));
}
