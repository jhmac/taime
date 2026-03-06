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
      const rules = await storage.getOffsiteRules(locationId);
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
      const existing = await storage.getOffsiteRule(id);
      if (!existing) {
        return res.status(404).json({ message: "Rule not found" });
      }

      const updates: any = {};
      const allowedFields = [
        'name', 'allowedMinutes', 'allowedTimeStart', 'allowedTimeEnd',
        'appliesTo', 'specificEmployeeIds', 'alertAfterMinutes',
        'alertRecipients', 'customAlertUserIds', 'isActive'
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const updated = await storage.updateOffsiteRule(id, updates);
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
      const existing = await storage.getOffsiteRule(id);
      if (!existing) {
        return res.status(404).json({ message: "Rule not found" });
      }

      await storage.deleteOffsiteRule(id);
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

      const filters: { status?: string } = {};
      if (req.query.status) filters.status = req.query.status as string;

      const sessions = await storage.getOffsiteSessions(filters);

      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = sessions.map(session => {
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
      const { id } = req.params;
      const sessions = await storage.getOffsiteSessions({ userId: id });
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching employee offsite sessions:", error);
      res.status(500).json({ message: "Failed to fetch employee offsite sessions" });
    }
  });
}
