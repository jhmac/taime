import type { Express } from "express";
import type { IStorage } from "../storage";
import { users, roles, companySettings, employeeDocuments, managerNotes, workLocations, timeEntries, payrollPeriods } from "@shared/schema";
import { eq, desc, or, isNull, and, sql as sqlExpr, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { sendTeamInviteEmail } from "../services/emailService";
import { randomBytes } from "crypto";
import { tryResolveStoreIdForUser } from "../services/storeResolver";
import { clerkClient } from "@clerk/express";
import { invalidatePermissionCache } from "../lib/permissionUtils";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

export function registerUserRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/invite/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const [user] = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        roleId: users.roleId,
        invitedAt: users.invitedAt,
        inviteAcceptedAt: users.inviteAcceptedAt,
        inviteCount: users.inviteCount,
      }).from(users).where(eq(users.inviteToken, token)).limit(1);

      if (!user) {
        return res.status(404).json({ message: "Invite not found or has expired" });
      }
      if (user.inviteAcceptedAt) {
        return res.status(410).json({ message: "This invite has already been accepted" });
      }

      const settings = await db.select().from(companySettings).limit(1);
      const companyName = settings[0]?.companyName || 'Taime';

      const roleName = user.roleId
        ? await db.select({ displayName: roles.displayName }).from(roles).where(eq(roles.id, user.roleId)).then(r => r[0]?.displayName)
        : null;

      res.json({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        companyName,
        roleName: roleName || null,
        invitedAt: user.invitedAt,
        inviteCount: user.inviteCount,
      });
    } catch (error) {
      console.error("Error fetching invite:", error);
      res.status(500).json({ message: "Failed to load invite" });
    }
  });

  app.post('/api/users', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const canManage = await resolveAnyPermission(currentUserId, ['hr.manage_employees', 'hr.edit_team'], storage);

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

      const inviteToken = generateInviteToken();
      const newUserData: Record<string, string | null | Date | number> = {
        email: email.trim(),
        firstName: firstName || null,
        lastName: lastName || null,
        invitedAt: new Date(),
        inviteToken,
        inviteCount: 1,
      };
      if (roleId) newUserData.roleId = roleId;
      if (hourlyRate) newUserData.hourlyRate = hourlyRate;

      const [newUser] = await db.insert(users).values(newUserData).returning();
      if (roleId) invalidatePermissionCache();

      const inviter = await storage.getUser(currentUserId);
      const inviterName = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || 'Your manager' : 'Your manager';

      const settings = await db.select().from(companySettings).limit(1);
      const companyName = settings[0]?.companyName || 'Taime';

      const recipientName = `${firstName || ''} ${lastName || ''}`.trim();
      const roleName = roleId ? await db.select({ displayName: roles.displayName }).from(roles).where(eq(roles.id, roleId)).then(r => r[0]?.displayName) : null;

      sendTeamInviteEmail(req, email.trim(), recipientName, inviterName, companyName, inviteToken, roleName || null).catch(err => {
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
      const canManage = await resolveAnyPermission(currentUserId, ['hr.manage_employees', 'hr.edit_team'], storage);

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

      const newToken = generateInviteToken();
      const roleInfo = targetUser.roleId ? await db.select({ displayName: roles.displayName }).from(roles).where(eq(roles.id, targetUser.roleId)).then(r => r[0]?.displayName) : null;

      const sent = await sendTeamInviteEmail(req, targetUser.email, recipientName, inviterName, companyName, newToken, roleInfo || null);
      if (sent) {
        await db.update(users).set({
          invitedAt: new Date(),
          inviteToken: newToken,
          inviteCount: (targetUser.inviteCount || 0) + 1,
        }).where(eq(users.id, userId));
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
      const roleName = req.user.role?.name;

      const isOwnerOrAdmin = roleName === 'owner' || roleName === 'admin';
      let canViewTeam = isOwnerOrAdmin;

      if (!canViewTeam) {
        canViewTeam = await resolveAnyPermission(userId, ['hr.view_team', 'schedule.view_all'], storage);
        console.log(`[/api/users] userId=${userId} roleName=${roleName} canViewTeam=${canViewTeam}`);
      } else {
        console.log(`[/api/users] userId=${userId} roleName=${roleName} canViewTeam=true (via role)`);
      }

      if (!canViewTeam) {
        let currentUser = await storage.getUser(userId);
        if (!currentUser && req.user.email) {
          currentUser = await storage.getUserByEmail(req.user.email);
        }
        if (!currentUser) {
          console.warn(`[/api/users] Fallback miss: no user found for id=${userId} email=${req.user.email || 'none'}`);
        }
        res.json(currentUser ? [currentUser] : []);
        return;
      }
      
      const includeAll = req.query.includeAll === 'true';

      const requestingUser = await storage.getUser(userId);
      const requestingLocationId = requestingUser?.locationId;
      const requestingLocationName = requestingUser?.locationName;

      const activeFilter = includeAll ? undefined : eq(users.isActive, true);

      if (requestingLocationId) {
        // Primary path: FK-based store scoping (rename-safe).
        // Include users assigned to this store OR users with no store assignment at all
        // (null on BOTH fields = truly unassigned/newly invited, not from another store).
        const locationFilter = or(
          eq(users.locationId, requestingLocationId),
          and(isNull(users.locationId), isNull(users.locationName)),
        );
        const whereClause = activeFilter ? and(locationFilter, activeFilter) : locationFilter;
        const filteredUsers = await db.select().from(users).where(whereClause);
        res.json(filteredUsers);
      } else if (requestingLocationName) {
        // Compatibility fallback for requesters whose locationId hasn't been backfilled yet.
        // Include users with a matching locationName OR users with no location at all.
        const locationFilter = or(
          eq(users.locationName, requestingLocationName),
          isNull(users.locationName),
        );
        const whereClause = activeFilter ? and(locationFilter, activeFilter) : locationFilter;
        const filteredUsers = await db.select().from(users).where(whereClause);
        res.json(filteredUsers);
      } else {
        // No store assignment — return full list only for owners/admins.
        // Scoped viewers without a store see only themselves.
        const isOwnerOrAdmin = roleName === 'owner' || roleName === 'admin';
        if (isOwnerOrAdmin) {
          const allUsers = includeAll
            ? await db.select().from(users)
            : await db.select().from(users).where(eq(users.isActive, true));
          res.json(allUsers);
        } else {
          const selfUser = requestingUser ? [requestingUser] : [];
          res.json(selfUser);
        }
      }
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
      const requestingUserId = req.user.id;
      const { userId } = req.params;

      // Users may update their own profile. Updating someone else requires hr.edit_team.
      if (requestingUserId !== userId) {
        const canEditTeam = await resolveAnyPermission(requestingUserId, ['hr.edit_team', 'admin.manage_all'], storage);
        const requesterRole = req.user.role?.name;
        const isOwnerOrAdmin = requesterRole === 'owner' || requesterRole === 'admin';
        if (!canEditTeam && !isOwnerOrAdmin) {
          return res.status(403).json({ message: "You don't have permission to update this user" });
        }
      }

      const updateData = { ...req.body };

      // When locationName is being set, resolve and persist the matching locationId so
      // that store-scoped queries (getAllStoreUserIds, resolveStoreIdForUser) can use the
      // FK directly instead of a fragile name match.
      if ('locationName' in updateData) {
        if (updateData.locationName) {
          const [matchedLoc] = await db
            .select({ id: workLocations.id })
            .from(workLocations)
            .where(eq(workLocations.name, updateData.locationName))
            .limit(1);
          updateData.locationId = matchedLoc?.id ?? null;
        } else {
          updateData.locationId = null;
        }
      }

      const updated = await db.update(users).set({ ...updateData, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
      if (updated.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      if ('roleId' in updateData || 'isActive' in updateData) {
        invalidatePermissionCache();
      }
      res.json(updated[0]);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Admin-only: directly set locationId for a user (bypass name-match requirement).
  // Useful for users whose locationId is null despite having a locationName, e.g. due to
  // store renames, inactive stores, or name-casing mismatches that the startup backfill missed.
  app.patch('/api/users/:userId/assign-location', isAuthenticated, async (req: any, res) => {
    try {
      const requestingRole = req.user.role?.name;
      const isOwnerOrAdmin = requestingRole === 'owner' || requestingRole === 'admin';
      if (!isOwnerOrAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId } = req.params;
      const { locationId } = req.body;

      // If a locationId is provided, resolve the matching locationName so both fields stay in sync.
      let locationName: string | null = null;
      if (locationId) {
        const [loc] = await db
          .select({ name: workLocations.name })
          .from(workLocations)
          .where(eq(workLocations.id, locationId))
          .limit(1);
        if (!loc) {
          return res.status(404).json({ message: "Work location not found" });
        }
        locationName = loc.name;
      }

      const [updated] = await db
        .update(users)
        .set({ locationId: locationId ?? null, locationName, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error assigning location:", error);
      res.status(500).json({ message: "Failed to assign location" });
    }
  });

  app.put('/api/users/:userId/pay-rate', isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.user.id;
      const { userId } = req.params;
      const { hourlyRate } = req.body;

      const canEditPayRates = await resolvePermission(currentUserId, 'hr.edit_pay_rates', storage);
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

      const canManageEmployees = await resolvePermission(currentUserId, 'hr.manage_employees', storage);
      if (!canManageEmployees) {
        return res.status(403).json({ message: "Employee management access required" });
      }

      if (currentUserId === userId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      await storage.deleteUser(userId);
      invalidatePermissionCache();
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

      const canEditRoles = await resolvePermission(currentUserId, 'admin.role_management', storage);
      if (!canEditRoles) {
        return res.status(403).json({ message: "Role management access required" });
      }

      // Role hierarchy: lower number = higher authority. Owners/admins can manage anyone below them.
      // Managers can only manage roles below their own level.
      const ROLE_RANK: Record<string, number> = {
        owner: 0,
        admin: 1,
        manager: 2,
        assistant_manager: 3,
        employee: 4,
        stylist: 4,
      };
      const UNKNOWN_RANK = 99;

      const requesterRoleName = req.user.role?.name ?? '';
      const requesterRank = ROLE_RANK[requesterRoleName] ?? UNKNOWN_RANK;

      // Owner and admin can assign any role — skip hierarchy check
      if (requesterRoleName !== 'owner' && requesterRoleName !== 'admin') {
        // Look up target user's current role and the new role being assigned
        const [targetUser] = await db
          .select({ roleId: users.roleId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const targetRoles = targetUser?.roleId
          ? await db.select({ name: roles.name }).from(roles).where(eq(roles.id, targetUser.roleId)).limit(1)
          : [];
        const targetRoleName = targetRoles[0]?.name ?? '';
        const targetRank = ROLE_RANK[targetRoleName] ?? UNKNOWN_RANK;

        const newRoles = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, roleId)).limit(1);
        const newRoleName = newRoles[0]?.name ?? '';
        const newRank = ROLE_RANK[newRoleName] ?? UNKNOWN_RANK;

        if (targetRank <= requesterRank) {
          return res.status(403).json({ message: "You cannot manage roles at or above your own level" });
        }
        if (newRank <= requesterRank) {
          return res.status(403).json({ message: "You cannot assign a role at or above your own level" });
        }
      }

      const updatedUser = await storage.updateUserRole(userId, roleId);
      invalidatePermissionCache();
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.patch('/api/users/:id/role', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canEditTeam = await resolvePermission(userId, 'hr.edit_team', storage);
      if (!canEditTeam) {
        return res.status(403).json({ message: "Permission denied: Team editing access required" });
      }
      
      const { id } = req.params;
      const { roleId } = req.body;
      
      await storage.assignUserRole(id, roleId);
      invalidatePermissionCache();
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
        const canViewTeam = await resolvePermission(requestingUserId, 'hr.view_team', storage);
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
      const canView = await resolveAnyPermission(currentUserId, ['hr.view_team', 'hr.edit_team'], storage);
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
      const canManage = await resolveAnyPermission(currentUserId, ['hr.manage_employees', 'hr.edit_team'], storage);
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
      const canView = await resolveAnyPermission(currentUserId, ['hr.view_team', 'hr.edit_team'], storage);
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
      const canManage = await resolveAnyPermission(currentUserId, ['hr.manage_employees', 'hr.edit_team'], storage);

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
      const canView = await resolveAnyPermission(currentUserId, ['hr.view_team', 'hr.edit_team'], storage);
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
      const canManage = await resolveAnyPermission(currentUserId, ['hr.manage_employees', 'hr.edit_team'], storage);
      if (!canManage) {
        return res.status(403).json({ message: "Manager access required" });
      }

      const { content } = req.body;
      if (!content?.trim()) {
        return res.status(400).json({ message: "Note content is required" });
      }

      const { category = 'general' } = req.body;
      const [note] = await db.insert(managerNotes).values({
        userId,
        managerId: currentUserId,
        note: content.trim(),
        category,
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

      if (note.managerId !== currentUserId) {
        const isAdmin = await resolvePermission(currentUserId, 'admin.manage_all', storage);
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

  // POST /api/account/unsubscribe — remove all push tokens and opt out of notifications
  app.post('/api/account/unsubscribe', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      // Remove all native push tokens so no more push notifications are delivered
      await db.execute(sqlExpr`DELETE FROM native_push_tokens WHERE user_id = ${userId}`);

      // Remove web push subscriptions if table exists
      try {
        await db.execute(sqlExpr`DELETE FROM push_subscriptions WHERE user_id = ${userId}`);
      } catch { /* table may not exist */ }

      console.log(`[Account] User ${userId} unsubscribed from all push notifications`);
      res.json({ success: true, message: "Successfully unsubscribed from all notifications" });
    } catch (error) {
      console.error("[Account] Unsubscribe error:", error);
      res.status(500).json({ message: "Failed to unsubscribe" });
    }
  });

  // DELETE /api/account/self — permanently delete own account
  app.delete('/api/account/self', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      // Prevent the only owner from deleting their account (would orphan the store)
      const userWithRole = await storage.getUserWithRole(userId);
      if (userWithRole?.role?.name === 'owner') {
        const [otherOwner] = await db
          .select({ id: users.id })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .where(and(eq(roles.name, 'owner'), sqlExpr`users.id != ${userId}`))
          .limit(1);
        if (!otherOwner) {
          return res.status(400).json({
            message: "You are the only owner. Transfer ownership to another team member before deleting your account.",
          });
        }
      }

      // Remove push tokens and subscriptions first
      await db.execute(sqlExpr`DELETE FROM native_push_tokens WHERE user_id = ${userId}`);
      try { await db.execute(sqlExpr`DELETE FROM push_subscriptions WHERE user_id = ${userId}`); } catch { /* ok */ }

      // Delete from our DB (cascades to related records)
      await storage.deleteUser(userId);

      // Delete from Clerk (best-effort — if it fails the DB is already clean)
      try {
        await clerkClient.users.deleteUser(userId);
      } catch (clerkErr) {
        console.warn(`[Account] Could not delete Clerk user ${userId}:`, clerkErr);
      }

      console.log(`[Account] User ${userId} account permanently deleted`);
      res.json({ success: true, message: "Account permanently deleted" });
    } catch (error) {
      console.error("[Account] Self-delete error:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // GET /api/users/me/pay-summary — Employee pay estimate for current pay period
  app.get('/api/users/me/pay-summary', isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;

      // 1. Fetch user with deduction settings
      const [user] = await db.select({
        id: users.id,
        hourlyRate: users.hourlyRate,
        federalWithholdingPct: users.federalWithholdingPct,
        stateWithholdingPct: users.stateWithholdingPct,
        otherDeductionsCents: users.otherDeductionsCents,
      }).from(users).where(eq(users.id, userId)).limit(1);

      if (!user) return res.status(404).json({ message: "User not found" });

      const hourlyRate = parseFloat(user.hourlyRate ?? "0");

      // 2. Find current payroll period
      const now = new Date();
      const [currentPeriod] = await db
        .select()
        .from(payrollPeriods)
        .where(and(
          lte(payrollPeriods.startDate, now),
          gte(payrollPeriods.endDate, now)
        ))
        .orderBy(desc(payrollPeriods.startDate))
        .limit(1);

      // Fall back to the most recent period if none spans today
      const [latestPeriod] = currentPeriod
        ? [currentPeriod]
        : await db
            .select()
            .from(payrollPeriods)
            .orderBy(desc(payrollPeriods.startDate))
            .limit(1);

      const period = latestPeriod ?? null;
      const periodStart = period ? new Date(period.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = period ? new Date(period.endDate) : now;

      // 3. Fetch time entries for this period
      const entries = await db
        .select()
        .from(timeEntries)
        .where(and(
          eq(timeEntries.userId, userId),
          gte(timeEntries.clockInTime, periodStart),
          lte(timeEntries.clockInTime, periodEnd)
        ));

      // 4. Calculate hours worked (exclude any currently-open entry's in-progress time)
      let totalHours = 0;
      let currentlyClocked = false;
      let hoursInProgress = 0;

      for (const entry of entries) {
        const clockIn = new Date(entry.clockInTime);
        const clockOut = entry.clockOutTime ? new Date(entry.clockOutTime) : null;

        if (!clockOut) {
          currentlyClocked = true;
          const ms = now.getTime() - clockIn.getTime();
          hoursInProgress = ms / (1000 * 60 * 60) - (entry.breakMinutes ?? 0) / 60;
        } else {
          const ms = clockOut.getTime() - clockIn.getTime();
          const worked = ms / (1000 * 60 * 60) - (entry.breakMinutes ?? 0) / 60;
          totalHours += Math.max(0, worked);
        }
      }

      const totalHoursIncludingNow = totalHours + (currentlyClocked ? hoursInProgress : 0);

      // 5. Gross pay
      const grossPay = totalHoursIncludingNow * hourlyRate;

      // 6. Deduction calculations
      const ficaRate = 0.0765; // 6.2% SS + 1.45% Medicare
      const federalRate = parseFloat(user.federalWithholdingPct ?? "12") / 100;
      const stateRate = parseFloat(user.stateWithholdingPct ?? "5") / 100;
      const otherDeductionsDollars = (user.otherDeductionsCents ?? 0) / 100;

      const ficaDeduction = grossPay * ficaRate;
      const federalDeduction = grossPay * federalRate;
      const stateDeduction = grossPay * stateRate;
      const totalDeductions = ficaDeduction + federalDeduction + stateDeduction + otherDeductionsDollars;
      const netPay = Math.max(0, grossPay - totalDeductions);

      res.json({
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        periodLabel: period ? `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'This Month',
        hourlyRate,
        totalHours: Math.round(totalHoursIncludingNow * 100) / 100,
        hoursLogged: Math.round(totalHours * 100) / 100,
        currentlyClocked,
        grossPay: Math.round(grossPay * 100) / 100,
        deductions: {
          fica: Math.round(ficaDeduction * 100) / 100,
          federal: Math.round(federalDeduction * 100) / 100,
          state: Math.round(stateDeduction * 100) / 100,
          other: Math.round(otherDeductionsDollars * 100) / 100,
          total: Math.round(totalDeductions * 100) / 100,
        },
        netPay: Math.round(netPay * 100) / 100,
        ficaRate: ficaRate * 100,
        federalRate: federalRate * 100,
        stateRate: stateRate * 100,
      });
    } catch (error) {
      console.error("[Pay Summary] Error:", error);
      res.status(500).json({ message: "Failed to load pay summary" });
    }
  });

  // PATCH /api/users/:userId/withholding — Manager/admin updates employee deduction settings
  app.patch('/api/users/:userId/withholding', isAuthenticated, async (req: any, res) => {
    try {
      const requesterId: string = req.user.id;
      const { userId } = req.params;

      const canEdit = await resolveAnyPermission(requesterId, ['hr.edit_team', 'hr.edit_pay_rates'], storage);
      if (!canEdit) return res.status(403).json({ message: "Insufficient permissions" });

      const { federalWithholdingPct, stateWithholdingPct, otherDeductionsCents } = req.body;

      await db.update(users)
        .set({
          ...(federalWithholdingPct !== undefined ? { federalWithholdingPct: String(federalWithholdingPct) } : {}),
          ...(stateWithholdingPct !== undefined ? { stateWithholdingPct: String(stateWithholdingPct) } : {}),
          ...(otherDeductionsCents !== undefined ? { otherDeductionsCents: Number(otherDeductionsCents) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      res.json({ success: true });
    } catch (error) {
      console.error("[Withholding] Error:", error);
      res.status(500).json({ message: "Failed to update withholding" });
    }
  });
}
