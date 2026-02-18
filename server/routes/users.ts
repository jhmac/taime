import type { Express } from "express";
import type { IStorage } from "../storage";
import { users, roles, companySettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { sendTeamInviteEmail } from "../services/emailService";

export function registerUserRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/users', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManage = userPermissions.some(p => p.name === 'hr.manage_employees' || p.name === 'hr.edit_team');

      if (!canManage) {
        return res.status(403).json({ message: "Employee management access required" });
      }

      const { email, firstName, lastName, roleId, hourlyRate } = req.body;
      if (!email || !email.trim()) {
        return res.status(400).json({ message: "Email is required" });
      }

      const existing = await db.select().from(users).where(eq(users.email, email.trim()));
      if (existing.length > 0) {
        return res.status(409).json({ message: "A team member with this email already exists" });
      }

      const newUserData: Record<string, any> = {
        email: email.trim(),
        firstName: firstName || null,
        lastName: lastName || null,
      };
      if (roleId) newUserData.roleId = roleId;
      if (hourlyRate) newUserData.hourlyRate = hourlyRate;

      const [newUser] = await db.insert(users).values(newUserData).returning();

      const inviter = await storage.getUser(currentUserId);
      const inviterName = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || 'Your manager' : 'Your manager';

      const settings = await db.select().from(companySettings).limit(1);
      const companyName = settings[0]?.companyName || 'Taime Clock';

      const recipientName = `${firstName || ''} ${lastName || ''}`.trim();

      sendTeamInviteEmail(req, email.trim(), recipientName, inviterName, companyName).catch(err => {
        console.error("Background email send failed:", err);
      });

      res.json(newUser);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create team member" });
    }
  });

  app.get('/api/users', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewTeam = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'schedule.view_all');
      
      if (!canViewTeam) {
        const currentUser = await storage.getUser(userId);
        res.json(currentUser ? [currentUser] : []);
        return;
      }
      
      const includeAll = req.query.includeAll === 'true';
      const allUsers = includeAll
        ? await db.select().from(users)
        : await db.select().from(users).where(eq(users.isActive, true));
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get('/api/users/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const role = user.roleId ? await db.select().from(roles).where(eq(roles.id, user.roleId)).then(r => r[0]) : null;
      res.json({ ...user, role });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.put('/api/users/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const updateData = req.body;
      const updated = await db.update(users).set({ ...updateData, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
      if (updated.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updated[0]);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.put('/api/users/:userId/pay-rate', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;
      const { hourlyRate } = req.body;

      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canEditPayRates = userPermissions.some(p => p.name === 'hr.edit_pay_rates');
      
      if (!canEditPayRates) {
        return res.status(403).json({ message: "Pay rate editing access required" });
      }

      const updatedUser = await storage.updateUserPayRate(userId, parseFloat(hourlyRate));
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating pay rate:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.delete('/api/users/:userId', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;

      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManageEmployees = userPermissions.some(p => p.name === 'hr.manage_employees');
      
      if (!canManageEmployees) {
        return res.status(403).json({ message: "Employee management access required" });
      }

      if (currentUserId === userId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.put('/api/users/:userId/role', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;
      const { roleId } = req.body;

      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canEditRoles = userPermissions.some(p => p.name === 'admin.role_management');
      
      if (!canEditRoles) {
        return res.status(403).json({ message: "Role management access required" });
      }

      const updatedUser = await storage.updateUserRole(userId, roleId);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.patch('/api/users/:id/role', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canEditTeam = userPermissions.some(p => p.name === 'hr.edit_team');
      
      if (!canEditTeam) {
        return res.status(403).json({ message: "Permission denied: Team editing access required" });
      }
      
      const { id } = req.params;
      const { roleId } = req.body;
      
      await storage.assignUserRole(id, roleId);
      const updatedUser = await storage.getUserWithRole(id);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error assigning user role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/users/:id/permissions', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const requestingUserId = req.user.id;
      
      if (id !== requestingUserId) {
        const userPermissions = await storage.getUserPermissions(requestingUserId);
        const canViewTeam = userPermissions.some(p => p.name === 'hr.view_team');
        
        if (!canViewTeam) {
          return res.status(403).json({ message: "Permission denied" });
        }
      }
      
      const permissions = await storage.getUserPermissions(id);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching user permissions:", error);
      res.status(500).json({ message: "Failed to fetch user permissions" });
    }
  });
}
