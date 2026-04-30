import {
  users,
  roles,
  permissions,
  rolePermissions,
  userPermissionOverrides,
  companySettings,
  workLocations,
  activityLogs,
  type User,
  type UpsertUser,
  type Role,
  type InsertRole,
  type Permission,
  type InsertPermission,
  type RolePermission,
  type InsertRolePermission,
  type UserPermissionOverride,
  type UserWithRole,
  type CompanySettings,
  type InsertCompanySettings,
  type WorkLocation,
  type InsertWorkLocation,
  type ActivityLog,
  type InsertActivityLog,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, isNull, or, inArray, sql } from "drizzle-orm";
import { cache } from "../services/cache";
import { timeEntries } from "@shared/schema";

export interface IIdentityStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  getAllUsers(): Promise<User[]>;
  getUsersByRole(roleId: string): Promise<User[]>;
  updateUserRole(userId: string, roleId: string): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  deactivateUser(userId: string): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;
  updateUserPayRate(userId: string, hourlyRate: number): Promise<User>;

  getUserWithRole(id: string): Promise<UserWithRole | undefined>;
  getAllRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, updates: Partial<Role>): Promise<Role>;
  deleteRole(id: string): Promise<void>;
  assignUserRole(userId: string, roleId: string): Promise<void>;

  getAllPermissions(): Promise<Permission[]>;
  getPermissionsByCategory(): Promise<Record<string, Permission[]>>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void>;
  getUserPermissions(userId: string): Promise<Permission[]>;
  getUserRoleName(userId: string): Promise<string | null>;
  getUserSalesAccessOverride(userId: string): Promise<UserPermissionOverride | null>;
  setUserSalesAccessOverride(userId: string, grant: boolean | null): Promise<void>;

  getCompanySettings(storeId?: string): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: InsertCompanySettings, storeId?: string): Promise<CompanySettings>;
  getClockedInUsers(): Promise<{ id: string; firstName: string | null; lastName: string | null }[]>;

  createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation>;
  getAllWorkLocations(): Promise<WorkLocation[]>;
  getWorkLocation(id: string): Promise<WorkLocation | undefined>;
  updateWorkLocation(id: string, updates: Partial<WorkLocation>): Promise<WorkLocation>;
  deleteWorkLocation(id: string): Promise<void>;

  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(limit?: number): Promise<ActivityLog[]>;
}

export class IdentityStorage implements IIdentityStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    if (userData.email) {
      const [existingByEmail] = await db.select().from(users).where(eq(users.email, userData.email));
      if (existingByEmail && existingByEmail.id !== userData.id) {
        const updateData: Record<string, string | boolean | Date | null> = { updatedAt: new Date(), isActive: true };
        if (userData.firstName) updateData.firstName = userData.firstName;
        if (userData.lastName) updateData.lastName = userData.lastName;
        if (userData.profileImageUrl) updateData.profileImageUrl = userData.profileImageUrl;
        if (!existingByEmail.inviteAcceptedAt && existingByEmail.invitedAt) {
          updateData.inviteAcceptedAt = new Date();
        }
        const [updated] = await db.update(users).set(updateData).where(eq(users.id, existingByEmail.id)).returning();
        return updated;
      }
    }
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).where(
      or(eq(users.isActive, true), isNull(users.isActive))
    );
  }

  async getUsersByRole(roleId: string): Promise<User[]> {
    return await db.select().from(users).where(
      and(
        eq(users.roleId, roleId),
        or(eq(users.isActive, true), isNull(users.isActive))
      )
    );
  }

  async updateUserPayRate(userId: string, hourlyRate: number): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ hourlyRate: hourlyRate.toString() })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async updateUserRole(userId: string, roleId: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ roleId })
      .where(eq(users.id, userId))
      .returning();
    cache.invalidate(`permissions:${userId}`);
    return updatedUser;
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  async deactivateUser(userId: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    cache.invalidate(`permissions:${userId}`);
    cache.invalidate('dashboard:userlist');
    return updatedUser;
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async getClockedInUsers(): Promise<{ id: string; firstName: string | null; lastName: string | null }[]> {
    const rows = await db
      .selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(isNull(timeEntries.clockOutTime));
    return rows;
  }

  async getUserWithRole(id: string): Promise<any> {
    const user = await this.getUser(id);
    if (!user) return undefined;

    let role = null;
    if (user.roleId) {
      role = await this.getRole(user.roleId);
    }

    return {
      ...user,
      role: role ? {
        id: role.id,
        name: role.name,
        displayName: role.displayName,
        description: role.description
      } : null
    };
  }

  async getAllRoles(): Promise<Role[]> {
    return await db.select().from(roles).where(eq(roles.isActive, true)).orderBy(roles.name);
  }

  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }

  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }

  async updateRole(id: string, updates: Partial<Role>): Promise<Role> {
    const [updated] = await db
      .update(roles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    return updated;
  }

  async deleteRole(id: string): Promise<void> {
    await db.update(roles).set({ isActive: false }).where(eq(roles.id, id));
  }

  async assignUserRole(userId: string, roleId: string): Promise<void> {
    await db
      .update(users)
      .set({ roleId, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async getAllPermissions(): Promise<Permission[]> {
    return await db.select().from(permissions).orderBy(permissions.category, permissions.name);
  }

  async getPermissionsByCategory(): Promise<Record<string, Permission[]>> {
    const CATEGORY_ALIASES: Record<string, string> = {
      time_tracking: 'time',
      scheduling: 'schedule',
    };
    const allPermissions = await this.getAllPermissions();
    return allPermissions.reduce((acc, permission) => {
      const category = CATEGORY_ALIASES[permission.category] ?? permission.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(permission);
      return acc;
    }, {} as Record<string, Permission[]>);
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const result = await db
      .select({ permission: permissions })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    return result.map(row => row.permission);
  }

  async updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissionIds.length > 0) {
      const newRolePermissions = permissionIds.map(permissionId => ({
        roleId,
        permissionId
      }));
      await db.insert(rolePermissions).values(newRolePermissions);
    }
    cache.invalidatePrefix('permissions:');
  }

  async getUserPermissions(userId: string): Promise<Permission[]> {
    const cacheKey = `permissions:${userId}`;
    const cached = cache.get<Permission[]>(cacheKey);
    if (cached) return cached;

    const userWithRole = await db
      .select({ roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);

    let perms: Permission[];

    if (userWithRole.length > 0 && (userWithRole[0].roleName === 'owner' || userWithRole[0].roleName === 'admin')) {
      perms = await db.select().from(permissions);
    } else {
      const result = await db
        .select({ permission: permissions })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(users.id, userId));
      perms = result.map(row => row.permission);
    }

    const overrides = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));

    if (overrides.length > 0) {
      const permMap = new Map(perms.map(p => [p.name, p]));
      for (const override of overrides) {
        if (override.grant) {
          if (!permMap.has(override.permissionName)) {
            const [perm] = await db
              .select()
              .from(permissions)
              .where(eq(permissions.name, override.permissionName))
              .limit(1);
            if (perm) permMap.set(perm.name, perm);
          }
        } else {
          permMap.delete(override.permissionName);
        }
      }
      perms = Array.from(permMap.values());
    }

    cache.set(cacheKey, perms, 2 * 60 * 1000);
    return perms;
  }

  async getUserRoleName(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);
    return row?.roleName ?? null;
  }

  async getUserSalesAccessOverride(userId: string): Promise<UserPermissionOverride | null> {
    const [override] = await db
      .select()
      .from(userPermissionOverrides)
      .where(and(
        eq(userPermissionOverrides.userId, userId),
        eq(userPermissionOverrides.permissionName, 'sales.view_all')
      ))
      .limit(1);
    return override ?? null;
  }

  async setUserSalesAccessOverride(userId: string, grant: boolean | null): Promise<void> {
    if (grant === null) {
      await db
        .delete(userPermissionOverrides)
        .where(and(
          eq(userPermissionOverrides.userId, userId),
          eq(userPermissionOverrides.permissionName, 'sales.view_all')
        ));
    } else {
      await db
        .insert(userPermissionOverrides)
        .values({ userId, permissionName: 'sales.view_all', grant })
        .onConflictDoUpdate({
          target: [userPermissionOverrides.userId, userPermissionOverrides.permissionName],
          set: { grant, updatedAt: new Date() },
        });
    }
    cache.invalidatePrefix(`permissions:${userId}`);
  }

  async getCompanySettings(storeId?: string): Promise<CompanySettings | undefined> {
    const cacheKey = storeId ? `company:settings:${storeId}` : 'company:settings';
    const cached = cache.get<CompanySettings>(cacheKey);
    if (cached) return cached;
    const query = storeId
      ? db.select().from(companySettings).where(eq(companySettings.storeId, storeId)).limit(1)
      : db.select().from(companySettings).limit(1);
    const [settings] = await query;
    if (settings) cache.set(cacheKey, settings, 2 * 60 * 1000);
    return settings;
  }

  async updateCompanySettings(updates: Partial<CompanySettings> & { expectedVersion?: number }, storeId?: string): Promise<CompanySettings> {
    const existing = await this.getCompanySettings(storeId);
    const { expectedVersion, ...settingsData } = updates;
    const cacheKey = storeId ? `company:settings:${storeId}` : 'company:settings';

    if (existing) {
      if (expectedVersion !== undefined && expectedVersion !== (existing.version || 1)) {
        throw new Error("Settings were modified by another user. Please refresh and try again.");
      }

      const updatePayload: any = {
        ...settingsData,
        updatedAt: new Date(),
        version: (existing.version || 1) + 1
      };

      if (settingsData.autoClockOutAfterMinutes !== undefined) {
        updatePayload.autoClockOutAfterMinutes = settingsData.autoClockOutAfterMinutes !== null ? settingsData.autoClockOutAfterMinutes.toString() : null;
      }

      const [updated] = await db
        .update(companySettings)
        .set(updatePayload)
        .where(eq(companySettings.id, existing.id))
        .returning();
      cache.invalidate(cacheKey);
      return updated;
    }

    const insertData: any = { ...settingsData, version: 1 };
    if (storeId) insertData.storeId = storeId;
    if (settingsData.autoClockOutAfterMinutes !== undefined) {
      insertData.autoClockOutAfterMinutes = settingsData.autoClockOutAfterMinutes !== null ? settingsData.autoClockOutAfterMinutes.toString() : null;
    }

    const [created] = await db
      .insert(companySettings)
      .values(insertData)
      .returning();
    cache.invalidate(cacheKey);
    return created;
  }

  async createWorkLocation(location: InsertWorkLocation): Promise<WorkLocation> {
    const [created] = await db.insert(workLocations).values(location as any).returning();
    cache.invalidate('work_locations:all');
    return created;
  }

  async getAllWorkLocations(): Promise<WorkLocation[]> {
    return cache.getOrSet('work_locations:all', async () => {
      return await db.select().from(workLocations).where(eq(workLocations.isActive, true));
    }, 60_000);
  }

  async getWorkLocation(id: string): Promise<WorkLocation | undefined> {
    const [location] = await db.select().from(workLocations).where(eq(workLocations.id, id));
    return location;
  }

  async updateWorkLocation(id: string, updates: Partial<WorkLocation>): Promise<WorkLocation> {
    const finalUpdates: any = { ...updates };
    if (updates.geofenceGraceMinutes !== undefined) {
      finalUpdates.geofenceGraceMinutes = updates.geofenceGraceMinutes !== null ? updates.geofenceGraceMinutes.toString() : "5.00";
    }
    cache.invalidate('work_locations:all');
    const [updated] = await db
      .update(workLocations)
      .set(finalUpdates)
      .where(eq(workLocations.id, id))
      .returning();
    return updated;
  }

  async deleteWorkLocation(id: string): Promise<void> {
    await db.delete(workLocations).where(eq(workLocations.id, id));
    cache.invalidate('work_locations:all');
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db
      .insert(activityLogs)
      .values(log)
      .returning();
    return created;
  }

  async getActivityLogs(limit: number = 50): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }
}
