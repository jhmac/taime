import type { Express } from "express";
import { db } from "../db";
import { workLocations, companySettings, users, roles } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { IStorage } from "../storage";
import { seedDefaultRoles } from "../lib/migrations";

const storeSetupSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  address: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().email("Invalid email").optional().or(z.literal("")).default(""),
  timezone: z.string().default("America/Chicago"),
  hoursOfOperation: z.record(z.object({
    isOpen: z.boolean(),
    open: z.string(),
    close: z.string(),
  })).optional(),
});

export function registerOnboardingRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  // GET /api/onboarding/status
  // Returns the onboarding state for the current user:
  //   needsStoreSetup  – true if no work_locations exist + user is owner/admin/first user
  //   isNewInvitedUser – true if user accepted invite within the last 10 minutes
  //   storeInfo        – first work_location if one exists
  //   userRole         – name of the user's role
  app.get("/api/onboarding/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      // Check if any work locations exist
      const [firstLocation] = await db
        .select()
        .from(workLocations)
        .limit(1);

      const hasStore = !!firstLocation;

      // Get user with role
      const userWithRole = await storage.getUserWithRole(userId);
      const roleName = userWithRole?.role?.name || "";
      const isOwnerOrAdmin = roleName === "owner" || roleName === "admin";

      // Check if this is the first/only user in the system (no role set = fresh signup)
      const isFirstUser = !roleName && !hasStore;

      // needsStoreSetup: no store AND (owner/admin role OR first user ever)
      const needsStoreSetup = !hasStore && (isOwnerOrAdmin || isFirstUser);

      // isNewInvitedUser: user has invitedAt, recently accepted invite (within 10 min),
      // and already has a store to log into
      let isNewInvitedUser = false;
      if (hasStore && userWithRole?.invitedAt && userWithRole?.inviteAcceptedAt) {
        const acceptedMs = new Date(userWithRole.inviteAcceptedAt).getTime();
        const tenMinutesMs = 10 * 60 * 1000;
        if (Date.now() - acceptedMs < tenMinutesMs) {
          isNewInvitedUser = true;
        }
      }

      res.json({
        needsStoreSetup,
        isNewInvitedUser,
        storeInfo: firstLocation || null,
        userRole: roleName,
        userName: userWithRole
          ? `${userWithRole.firstName || ""} ${userWithRole.lastName || ""}`.trim()
          : "",
      });
    } catch (error: any) {
      console.error("[Onboarding] status error:", error);
      res.status(500).json({ message: "Failed to get onboarding status" });
    }
  });

  // POST /api/onboarding/store
  // Creates the first work_location and seeds company_settings.
  // Allowed only when no store exists yet AND the calling user is owner/admin OR the first user ever.
  app.post("/api/onboarding/store", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      // Authorization: owner/admin role, OR first-ever user (no store + no roles assigned yet)
      const userWithRole = await storage.getUserWithRole(userId);
      const roleName = userWithRole?.role?.name || "";
      const isOwnerOrAdmin = roleName === "owner" || roleName === "admin";

      // Check if any store exists
      const [existing] = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
      if (existing) {
        return res.status(409).json({ message: "Store already configured" });
      }

      // If a store doesn't exist but we do have role-bearing users (i.e. it's not truly the first signup),
      // only owner/admin may proceed.
      const [anyRoleUser] = await db.select({ id: users.id }).from(users).where(sql`role_id IS NOT NULL`).limit(1);
      if (anyRoleUser && !isOwnerOrAdmin) {
        return res.status(403).json({ message: "Only owners or admins can configure the store." });
      }

      const body = storeSetupSchema.parse(req.body);

      // Default hours if not provided
      const defaultHours = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].reduce<
        Record<string, { isOpen: boolean; open: string; close: string }>
      >((acc, day) => {
        acc[day] = {
          isOpen: day !== "sunday",
          open: day === "saturday" ? "10:00" : "09:00",
          close: day === "saturday" ? "17:00" : "18:00",
        };
        return acc;
      }, {});

      const [location] = await db.insert(workLocations).values({
        name: body.name,
        address: body.address || null,
        phone: body.phone || null,
        email: body.email || null,
        timezone: body.timezone,
        hoursOfOperation: body.hoursOfOperation || defaultHours,
        isActive: true,
        geofenceEnabled: false,
      }).returning();

      // Bust the storeResolver cache so all services pick up the new location immediately
      try {
        const { resolveStoreId } = await import("../lib/storeResolver");
        // We call it to warm the cache immediately (it will pick up new record)
        await resolveStoreId();
      } catch {
        // Non-critical
      }

      // Upsert company settings with onboarding-collected data (name, timezone, contact)
      const settingsPayload = {
        companyName: body.name,
        timezone: body.timezone,
        overtimeThresholdHours: 40,
        businessStartHour: 9,
        businessEndHour: 18,
        ...(body.phone ? { locationPhone: body.phone, companyPhone: body.phone } : {}),
        updatedAt: new Date(),
      };
      const [existingSettings] = await db.select().from(companySettings).limit(1);
      if (!existingSettings) {
        await db.insert(companySettings).values(settingsPayload).onConflictDoNothing();
      } else {
        await db.update(companySettings)
          .set(settingsPayload)
          .where(eq(companySettings.id, existingSettings.id));
      }

      // Ensure default roles exist before assigning (fresh DB may have no roles yet)
      await seedDefaultRoles();

      // Assign owner role to the creating user
      const userRecord = await storage.getUser(userId);
      if (userRecord) {
        const allRoles = await storage.getAllRoles();
        const ownerRole = allRoles.find(r => r.name === "owner");
        if (ownerRole && userRecord.roleId !== ownerRole.id) {
          await storage.assignUserRole(userId, ownerRole.id);
          console.log(`[Onboarding] Assigned owner role to store creator userId=${userId}`);
        }
      }

      res.json({ success: true, location });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: error.issues[0]?.message || "Invalid input" });
      }
      console.error("[Onboarding] store creation error:", error);
      res.status(500).json({ message: "Failed to create store" });
    }
  });
}
