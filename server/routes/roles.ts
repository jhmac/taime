import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertRoleSchema } from "@shared/schema";
import { cache } from "../lib/cache";

export function registerRoleRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/roles', isAuthenticated, async (req: any, res) => {
    try {
      const cached = cache.get<Awaited<ReturnType<typeof storage.getAllRoles>>>('roles:all');
      if (cached) return res.json(cached);
      const roles = await storage.getAllRoles();
      cache.set('roles:all', roles);
      res.json(roles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  app.post('/api/roles', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const data = insertRoleSchema.parse(req.body);
      const role = await storage.createRole(data);
      cache.invalidatePrefix('roles:');
      res.json(role);
    } catch (error) {
      console.error("Error creating role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.patch('/api/roles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const allowedFields = ['name', 'description', 'isDefault'];
      const safeUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          safeUpdates[key] = req.body[key];
        }
      }
      
      const role = await storage.updateRole(id, safeUpdates);
      cache.invalidatePrefix('roles:');
      res.json(role);
    } catch (error) {
      console.error("Error updating role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/roles/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      await storage.deleteRole(id);
      cache.invalidatePrefix('roles:');
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }

      const cached = cache.get('permissions:by-category');
      if (cached) return res.json(cached);
      const permissions = await storage.getPermissionsByCategory();
      cache.set('permissions:by-category', permissions);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.get('/api/roles/all-permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management' || p.name === 'admin.manage_all');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }

      const cacheKey = 'roles:all-permissions';
      const cached = cache.get<Record<string, string[]>>(cacheKey);
      if (cached) return res.json(cached);
      
      const allRoles = await storage.getAllRoles();
      const permPromises = allRoles.map(role => storage.getRolePermissions(role.id));
      const permResults = await Promise.all(permPromises);
      const result: Record<string, string[]> = {};
      allRoles.forEach((role, i) => {
        result[role.id] = permResults[i].map(p => p.id);
      });
      cache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching all role permissions:", error);
      res.status(500).json({ message: "Failed to fetch all role permissions" });
    }
  });

  app.get('/api/roles/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const rolePermissions = await storage.getRolePermissions(id);
      res.json(rolePermissions);
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      res.status(500).json({ message: "Failed to fetch role permissions" });
    }
  });

  app.put('/api/roles/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canManageRoles) {
        return res.status(403).json({ message: "Permission denied: Role management access required" });
      }
      
      const { id } = req.params;
      const { permissionIds } = req.body;
      
      if (!Array.isArray(permissionIds)) {
        return res.status(400).json({ message: "permissionIds must be an array" });
      }
      
      await storage.updateRolePermissions(id, permissionIds);
      cache.invalidatePrefix('roles:');
      const updatedPermissions = await storage.getRolePermissions(id);
      res.json(updatedPermissions);
    } catch (error) {
      console.error("Error updating role permissions:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });
}
