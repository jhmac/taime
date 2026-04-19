import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { insertRoleSchema } from "@shared/schema";
import { cache } from "../lib/cache";
import { asyncHandler, AppError } from "../lib/routeWrapper";

async function requireRoleManagement(storage: IStorage, userId: string): Promise<void> {
  const perms = await storage.getUserPermissions(userId);
  const allowed = perms.some(p => p.name === 'admin.role_management' || p.name === 'admin.manage_all');
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
    await storage.updateRolePermissions(id, permissionIds);
    cache.invalidatePrefix('roles:');
    const updatedPermissions = await storage.getRolePermissions(id);
    res.json(updatedPermissions);
  }));

  // User-level sales access override endpoints
  app.get('/api/users/:id/sales-access', isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireRoleManagement(storage, req.user.id);
    const { id } = req.params;
    // Get effective sales access: role default + override
    const [override, userPerms] = await Promise.all([
      storage.getUserSalesAccessOverride(id),
      storage.getUserPermissions(id),
    ]);
    const hasSalesAccess = userPerms.some(p => p.name === 'sales.view');
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
    await storage.setUserSalesAccessOverride(id, grant);
    const [override, userPerms] = await Promise.all([
      storage.getUserSalesAccessOverride(id),
      storage.getUserPermissions(id),
    ]);
    const hasSalesAccess = userPerms.some(p => p.name === 'sales.view');
    res.json({
      hasSalesAccess,
      isOverride: override !== null,
      overrideValue: override ? override.grant : null,
    });
  }));
}
