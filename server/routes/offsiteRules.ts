import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertOffsiteAllowanceRuleSchema } from "@shared/schema";

export function registerOffsiteRulesRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/offsite-rules', isAuthenticated, async (req: any, res) => {
    try {
      const locationId = req.query.locationId as string;
      if (!locationId) {
        return res.status(400).json({ message: "locationId query parameter is required" });
      }
      const companyId = req.user?.companyId;
      const location = await storage.getWorkLocation(locationId, companyId);
      if (!location) {
        return res.status(403).json({ message: "Access denied" });
      }
      const rules = await storage.getOffsiteRules(locationId, companyId);
      res.json(rules);
    } catch (error) {
      console.error("Error fetching offsite rules:", error);
      res.status(500).json({ message: "Failed to fetch offsite rules" });
    }
  });

  app.post('/api/offsite-rules', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isOwner = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isOwner) {
        return res.status(403).json({ message: "Owner access required" });
      }

      const parsed = insertOffsiteAllowanceRuleSchema.safeParse({
        ...req.body,
        createdBy: userId,
        ...(req.user?.companyId ? { companyId: req.user.companyId } : {}),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }

      const rule = await storage.createOffsiteRule(parsed.data);
      res.json(rule);
    } catch (error) {
      console.error("Error creating offsite rule:", error);
      res.status(500).json({ message: "Failed to create offsite rule" });
    }
  });

  app.patch('/api/offsite-rules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isOwner = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isOwner) {
        return res.status(403).json({ message: "Owner access required" });
      }

      const { id } = req.params;
      const ruleCompanyId = req.user?.companyId;
      const existing = await storage.getOffsiteRule(id, ruleCompanyId);
      if (!existing) {
        return res.status(404).json({ message: "Rule not found" });
      }

      const allowedFields = [
        'name', 'allowedMinutes', 'allowedTimeStart', 'allowedTimeEnd',
        'appliesTo', 'specificEmployeeIds', 'alertAfterMinutes',
        'alertRecipients', 'customAlertUserIds', 'isActive'
      ] as const;
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (updates.allowedMinutes !== undefined && (typeof updates.allowedMinutes !== 'number' || updates.allowedMinutes < 1)) {
        return res.status(400).json({ message: "allowedMinutes must be a positive number" });
      }
      if (updates.alertAfterMinutes !== undefined && (typeof updates.alertAfterMinutes !== 'number' || updates.alertAfterMinutes < 1)) {
        return res.status(400).json({ message: "alertAfterMinutes must be a positive number" });
      }
      if (updates.specificEmployeeIds !== undefined && !Array.isArray(updates.specificEmployeeIds)) {
        return res.status(400).json({ message: "specificEmployeeIds must be an array" });
      }
      if (updates.customAlertUserIds !== undefined && !Array.isArray(updates.customAlertUserIds)) {
        return res.status(400).json({ message: "customAlertUserIds must be an array" });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateOffsiteRule(id, updates, ruleCompanyId);
      res.json(updated);
    } catch (error) {
      console.error("Error updating offsite rule:", error);
      res.status(500).json({ message: "Failed to update offsite rule" });
    }
  });

  app.delete('/api/offsite-rules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isOwner = userPermissions.some((p: any) => p.name === 'admin.manage_all');
      if (!isOwner) {
        return res.status(403).json({ message: "Owner access required" });
      }

      const { id } = req.params;
      const deleteRuleCompanyId = req.user?.companyId;
      const existing = await storage.getOffsiteRule(id, deleteRuleCompanyId);
      if (!existing) {
        return res.status(404).json({ message: "Rule not found" });
      }

      await storage.deleteOffsiteRule(id, deleteRuleCompanyId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting offsite rule:", error);
      res.status(500).json({ message: "Failed to delete offsite rule" });
    }
  });

  app.get('/api/offsite-sessions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) =>
        p.name === 'admin.manage_all' || p.name === 'admin.manage_locations'
      );
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const companyId = req.user?.companyId;
      if (!companyId) throw new Error("Company context required");

      const filters: { status?: string; companyId: string } = { companyId };
      if (req.query.status) filters.status = req.query.status as string;

      const allUsers = await storage.getAllUsers(companyId);
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const companySessions = await storage.getOffsiteSessions(filters);

      const enriched = companySessions.map(session => {
        const user = userMap.get(session.userId);
        return {
          ...session,
          userName: user
            ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
            : 'Unknown',
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching offsite sessions:", error);
      res.status(500).json({ message: "Failed to fetch offsite sessions" });
    }
  });

  app.get('/api/offsite-sessions/employee/:id', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      const { id } = req.params;

      if (requestingUserId !== id) {
        const userPermissions = await storage.getUserPermissions(requestingUserId);
        const isAdmin = userPermissions.some((p: any) =>
          p.name === 'admin.manage_all' || p.name === 'admin.manage_locations' || p.name === 'time.view_all'
        );
        if (!isAdmin) {
          return res.status(403).json({ message: "You can only view your own off-site sessions" });
        }
      }

      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "Employee not found" });
      }
      if (!targetUser.companyId || targetUser.companyId !== req.user?.companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const sessions = await storage.getOffsiteSessions({ userId: id, companyId: req.user?.companyId });
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching employee offsite sessions:", error);
      res.status(500).json({ message: "Failed to fetch employee offsite sessions" });
    }
  });
}
