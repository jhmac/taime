import type { Express } from "express";
import type { IStorage } from "../storage";
import { users, roles, companySettings, employeeDocuments, managerNotes } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
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

      const newUserData: Record<string, string | null | Date> = {
        email: email.trim(),
        firstName: firstName || null,
        lastName: lastName || null,
        invitedAt: new Date(),
      };
      if (roleId) newUserData.roleId = roleId;
      if (hourlyRate) newUserData.hourlyRate = hourlyRate;

      const [newUser] = await db.insert(users).values(newUserData).returning();

      const inviter = await storage.getUser(currentUserId);
      const inviterName = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || 'Your manager' : 'Your manager';

      const settings = await db.select().from(companySettings).limit(1);
      const companyName = settings[0]?.companyName || 'Taime';

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

  app.post('/api/users/:userId/resend-invite', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManage = userPermissions.some(p => p.name === 'hr.manage_employees' || p.name === 'hr.edit_team');

      if (!canManage) {
        return res.status(403).json({ message: "Employee management access required" });
      }

      const { userId } = req.params;
      const targetUser = await storage.getUser(userId);
      if (!targetUser || !targetUser.email) {
        return res.status(404).json({ message: "User not found or has no email" });
      }

      if (targetUser.inviteAcceptedAt) {
        return res.status(400).json({ message: "This user has already accepted their invite" });
      }

      const inviter = await storage.getUser(currentUserId);
      const inviterName = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || 'Your manager' : 'Your manager';

      const settings = await db.select().from(companySettings).limit(1);
      const companyName = settings[0]?.companyName || 'Taime';

      const recipientName = `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim();

      const sent = await sendTeamInviteEmail(req, targetUser.email, recipientName, inviterName, companyName);
      if (sent) {
        await db.update(users).set({ invitedAt: new Date() }).where(eq(users.id, userId));
        res.json({ message: "Invitation email sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send invitation email" });
      }
    } catch (error) {
      console.error("Error resending invite:", error);
      res.status(500).json({ message: "Failed to resend invitation" });
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

  app.get('/api/users/:userId/documents', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canView = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'hr.edit_team');
      if (!canView && currentUserId !== userId) {
        return res.status(403).json({ message: "Not authorized to view these documents" });
      }
      const docs = await db.select().from(employeeDocuments)
        .where(eq(employeeDocuments.userId, userId))
        .orderBy(desc(employeeDocuments.createdAt));
      const docsWithoutData = docs.map(({ fileData, ...rest }) => rest);
      res.json(docsWithoutData);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post('/api/users/:userId/documents', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManage = userPermissions.some(p => p.name === 'hr.manage_employees' || p.name === 'hr.edit_team');
      if (!canManage && currentUserId !== userId) {
        return res.status(403).json({ message: "Not authorized to upload documents for this user" });
      }
      const { category, name, fileName, fileData, fileType, fileSize } = req.body;

      if (!name || !fileName || !fileData) {
        return res.status(400).json({ message: "Name, file name, and file data are required" });
      }
      if (fileSize && fileSize > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "File must be under 5MB" });
      }
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (fileType && !allowedTypes.includes(fileType)) {
        return res.status(400).json({ message: "File type not allowed. Use PDF, JPG, PNG, or DOC." });
      }

      const [doc] = await db.insert(employeeDocuments).values({
        userId,
        category: category || 'general',
        name,
        fileName,
        fileData,
        fileType: fileType || null,
        fileSize: fileSize || null,
        uploadedBy: currentUserId,
      }).returning();

      const { fileData: _, ...docWithoutData } = doc;
      res.json(docWithoutData);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.get('/api/documents/:docId/download', isAuthenticated, async (req: any, res) => {
    try {
      const { docId } = req.params;
      const currentUserId = req.user.id;
      const [doc] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId));
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canView = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'hr.edit_team');
      if (!canView && currentUserId !== doc.userId) {
        return res.status(403).json({ message: "Not authorized to download this document" });
      }
      const base64Data = doc.fileData.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', doc.fileType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
      res.send(buffer);
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  app.delete('/api/documents/:docId', isAuthenticated, async (req: any, res) => {
    try {
      const { docId } = req.params;
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManage = userPermissions.some(p => p.name === 'hr.manage_employees' || p.name === 'hr.edit_team');

      const [doc] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId));
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      if (!canManage && doc.uploadedBy !== currentUserId) {
        return res.status(403).json({ message: "Not authorized to delete this document" });
      }

      await db.delete(employeeDocuments).where(eq(employeeDocuments.id, docId));
      res.json({ message: "Document deleted" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.get('/api/users/:userId/notes', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canView = userPermissions.some(p => p.name === 'hr.view_team' || p.name === 'hr.edit_team');
      if (!canView) {
        return res.status(403).json({ message: "Manager access required to view notes" });
      }
      const notes = await db.select().from(managerNotes)
        .where(eq(managerNotes.userId, userId))
        .orderBy(desc(managerNotes.createdAt));
      res.json(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  app.post('/api/users/:userId/notes', isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;
      const userPermissions = await storage.getUserPermissions(currentUserId);
      const canManage = userPermissions.some(p => p.name === 'hr.manage_employees' || p.name === 'hr.edit_team');

      if (!canManage) {
        return res.status(403).json({ message: "Manager access required" });
      }

      const { content } = req.body;
      if (!content?.trim()) {
        return res.status(400).json({ message: "Note content is required" });
      }

      const [note] = await db.insert(managerNotes).values({
        userId,
        authorId: currentUserId,
        content: content.trim(),
      }).returning();

      res.json(note);
    } catch (error) {
      console.error("Error adding note:", error);
      res.status(500).json({ message: "Failed to add note" });
    }
  });

  app.delete('/api/notes/:noteId', isAuthenticated, async (req: any, res) => {
    try {
      const { noteId } = req.params;
      const currentUserId = req.user.id;

      const [note] = await db.select().from(managerNotes).where(eq(managerNotes.id, noteId));
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }

      if (note.authorId !== currentUserId) {
        const userPermissions = await storage.getUserPermissions(currentUserId);
        const isAdmin = userPermissions.some(p => p.name === 'admin.manage_all');
        if (!isAdmin) {
          return res.status(403).json({ message: "Can only delete your own notes" });
        }
      }

      await db.delete(managerNotes).where(eq(managerNotes.id, noteId));
      res.json({ message: "Note deleted" });
    } catch (error) {
      console.error("Error deleting note:", error);
      res.status(500).json({ message: "Failed to delete note" });
    }
  });
}
