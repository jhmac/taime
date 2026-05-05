import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertOffsiteAllowanceRuleSchema, type InsertOffsiteAllowanceRule, offsiteAllowanceRules } from "@shared/schema";
import { config } from "../lib/config";
import { processOffsiteBreadcrumb } from "../services/routeTrackingService";
import { postMileageReimbursement } from "../services/mileageReimbursementService";
import { db } from "../db";
import { inArray, eq } from "drizzle-orm";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

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
      const isOwner = await resolvePermission(userId, 'admin.manage_all', storage);
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

      const createData: InsertOffsiteAllowanceRule = parsed.data;
      if (createData.mileageRateCents !== undefined && createData.mileageRateCents !== null && (createData.mileageRateCents < 0 || createData.mileageRateCents > 1000)) {
        return res.status(400).json({ message: "mileageRateCents must be between 0 and 1000" });
      }
      if (createData.destinationLat !== undefined && createData.destinationLat !== null) {
        const lat = parseFloat(String(createData.destinationLat));
        if (isNaN(lat) || lat < -90 || lat > 90) {
          return res.status(400).json({ message: "destinationLat must be between -90 and 90" });
        }
      }
      if (createData.destinationLng !== undefined && createData.destinationLng !== null) {
        const lng = parseFloat(String(createData.destinationLng));
        if (isNaN(lng) || lng < -180 || lng > 180) {
          return res.status(400).json({ message: "destinationLng must be between -180 and 180" });
        }
      }
      if (createData.destinationAddress !== undefined && createData.destinationAddress !== null && String(createData.destinationAddress).length > 1000) {
        return res.status(400).json({ message: "destinationAddress must be 1000 characters or fewer" });
      }
      if (createData.destinationName !== undefined && createData.destinationName !== null && String(createData.destinationName).length > 500) {
        return res.status(400).json({ message: "destinationName must be 500 characters or fewer" });
      }

      const rule = await storage.createOffsiteRule(createData);
      res.json(rule);
    } catch (error) {
      console.error("Error creating offsite rule:", error);
      res.status(500).json({ message: "Failed to create offsite rule" });
    }
  });

  app.patch('/api/offsite-rules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isOwner = await resolvePermission(userId, 'admin.manage_all', storage);
      if (!isOwner) {
        return res.status(403).json({ message: "Owner access required" });
      }

      const { id } = req.params;
      const existing = await storage.getOffsiteRule(id);
      if (!existing) {
        return res.status(404).json({ message: "Rule not found" });
      }

      const allowedFields = [
        'name', 'allowedMinutes', 'allowedTimeStart', 'allowedTimeEnd',
        'appliesTo', 'specificEmployeeIds', 'alertAfterMinutes',
        'alertRecipients', 'customAlertUserIds', 'isActive',
        'destinationAddress', 'destinationPlaceId', 'destinationLat',
        'destinationLng', 'destinationName', 'mileageRateCents',
        'maxTripsPerDay', 'deviationToleranceMeters', 'waypoints', 'chosenRoutePolyline',
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
      if (updates.mileageRateCents !== undefined && (typeof updates.mileageRateCents !== 'number' || updates.mileageRateCents < 0 || updates.mileageRateCents > 1000)) {
        return res.status(400).json({ message: "mileageRateCents must be a number between 0 and 1000" });
      }
      if (updates.destinationLat !== undefined && updates.destinationLat !== null) {
        const lat = parseFloat(String(updates.destinationLat));
        if (isNaN(lat) || lat < -90 || lat > 90) {
          return res.status(400).json({ message: "destinationLat must be between -90 and 90" });
        }
      }
      if (updates.destinationLng !== undefined && updates.destinationLng !== null) {
        const lng = parseFloat(String(updates.destinationLng));
        if (isNaN(lng) || lng < -180 || lng > 180) {
          return res.status(400).json({ message: "destinationLng must be between -180 and 180" });
        }
      }
      if (updates.destinationAddress !== undefined && updates.destinationAddress !== null && String(updates.destinationAddress).length > 1000) {
        return res.status(400).json({ message: "destinationAddress must be 1000 characters or fewer" });
      }
      if (updates.destinationName !== undefined && updates.destinationName !== null && String(updates.destinationName).length > 500) {
        return res.status(400).json({ message: "destinationName must be 500 characters or fewer" });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
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
      const isOwner = await resolvePermission(userId, 'admin.manage_all', storage);
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
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
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

  app.get('/api/offsite-sessions/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const sessions = await storage.getOffsiteSessions({ userId, status: 'active' });
      const session = sessions[0] || null;

      if (session) {
        const activeEntry = await storage.getActiveTimeEntry(userId);
        if (!activeEntry) {
          await storage.updateOffsiteSession(session.id, {
            status: 'completed',
            returnTime: new Date(),
          });
          return res.json(null);
        }
      }

      res.json(session);
    } catch (error) {
      console.error("Error fetching active offsite session:", error);
      res.status(500).json({ message: "Failed to fetch active session" });
    }
  });

  app.post('/api/offsite-sessions/:id/breadcrumb', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { latitude, longitude, accuracy } = req.body;

      if (latitude == null || longitude == null) {
        return res.status(400).json({ message: "latitude and longitude are required" });
      }

      const session = await storage.getOffsiteSession(id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (session.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (session.status !== 'active') {
        return res.status(409).json({ message: "Session is not active" });
      }

      const result = await processOffsiteBreadcrumb(id, latitude, longitude, accuracy);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Error processing breadcrumb:", error);
      res.status(500).json({ message: "Failed to process breadcrumb" });
    }
  });

  app.get('/api/offsite-sessions/:id/breadcrumbs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations', 'time.view_all'], storage);

      const session = await storage.getOffsiteSession(id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (session.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const breadcrumbs = await storage.getOffsiteBreadcrumbs(id);
      res.json(breadcrumbs);
    } catch (error) {
      console.error("Error fetching breadcrumbs:", error);
      res.status(500).json({ message: "Failed to fetch breadcrumbs" });
    }
  });

  app.get('/api/offsite-sessions/employee/:id', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      const { id } = req.params;

      if (requestingUserId !== id) {
        const isAdmin = await resolveAnyPermission(requestingUserId, ['admin.manage_all', 'admin.manage_locations', 'time.view_all'], storage);
        if (!isAdmin) {
          return res.status(403).json({ message: "You can only view your own off-site sessions" });
        }
      }

      const sessions = await storage.getOffsiteSessions({ userId: id });
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching employee offsite sessions:", error);
      res.status(500).json({ message: "Failed to fetch employee offsite sessions" });
    }
  });

  app.get('/api/offsite-sessions/:id/receipt', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      const { id } = req.params;

      const session = await storage.getOffsiteSession(id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (requestingUserId !== session.userId) {
        const isAdmin = await resolveAnyPermission(requestingUserId, ['admin.manage_all', 'admin.manage_locations', 'time.view_all'], storage);
        if (!isAdmin) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const employee = userMap.get(session.userId);
      const reviewer = session.reviewedBy ? userMap.get(session.reviewedBy) : null;

      let rule = null;
      if (session.ruleId) {
        rule = await storage.getOffsiteRule(session.ruleId);
      }

      const mileageRateCents = rule?.mileageRateCents ?? 0;
      const totalDistanceMiles = session.totalDistanceMiles ? parseFloat(String(session.totalDistanceMiles)) : 0;
      const computedReimbursementCents = mileageRateCents > 0 && totalDistanceMiles > 0
        ? Math.round(totalDistanceMiles * mileageRateCents)
        : (session.reimbursementCents ?? 0);

      const reimbursementMinutes = computedReimbursementCents > 0 && mileageRateCents > 0
        ? Math.round((computedReimbursementCents / 100) / ((mileageRateCents / 100) * 60) * 60)
        : 0;

      const receipt = {
        ...session,
        employee: employee ? {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          profileImageUrl: employee.profileImageUrl,
          email: employee.email,
        } : null,
        rule: rule ? {
          id: rule.id,
          name: rule.name,
          mileageRateCents: rule.mileageRateCents,
          destinationName: rule.destinationName,
          destinationAddress: rule.destinationAddress,
          destinationLat: rule.destinationLat,
          destinationLng: rule.destinationLng,
        } : null,
        reviewer: reviewer ? {
          id: reviewer.id,
          firstName: reviewer.firstName,
          lastName: reviewer.lastName,
        } : null,
        computedReimbursementCents,
        reimbursementMinutes,
        mileageRateCents,
      };

      res.json(receipt);
    } catch (error) {
      console.error("Error fetching trip receipt:", error);
      res.status(500).json({ message: "Failed to fetch trip receipt" });
    }
  });

  app.patch('/api/offsite-sessions/:id/review', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { id } = req.params;
      const session = await storage.getOffsiteSession(id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { adminNote, markReviewed, reviewStatus } = req.body;
      const updates: any = {};
      if (adminNote !== undefined) {
        if (adminNote !== null && typeof adminNote !== 'string') {
          return res.status(400).json({ message: "adminNote must be a string" });
        }
        if (typeof adminNote === 'string' && adminNote.length > 2000) {
          return res.status(400).json({ message: "adminNote must be 2000 characters or fewer" });
        }
        updates.adminNote = adminNote;
      }
      if (reviewStatus !== undefined) {
        if (reviewStatus !== null && reviewStatus !== 'approved' && reviewStatus !== 'flagged') {
          return res.status(400).json({ message: "reviewStatus must be 'approved', 'flagged', or null" });
        }
        updates.reviewStatus = reviewStatus;
        if (reviewStatus === 'approved') {
          updates.reviewedBy = userId;
          updates.reviewedAt = new Date();
        } else if (reviewStatus === 'flagged') {
          updates.reviewedBy = userId;
          updates.reviewedAt = new Date();
        } else if (reviewStatus === null) {
          updates.reviewedBy = null;
          updates.reviewedAt = null;
        }
      } else if (markReviewed === true) {
        updates.reviewedBy = userId;
        updates.reviewedAt = new Date();
        if (session.reviewStatus !== 'flagged') {
          updates.reviewStatus = 'approved';
        }
      } else if (markReviewed === false) {
        updates.reviewedBy = null;
        updates.reviewedAt = null;
        updates.reviewStatus = null;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateOffsiteSession(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error reviewing trip receipt:", error);
      res.status(500).json({ message: "Failed to update trip review" });
    }
  });

  app.get('/api/trip-history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const isAdmin = await resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations'], storage);
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const filters: any = {};
      if (req.query.locationId) filters.locationId = req.query.locationId as string;
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.from) filters.from = new Date(req.query.from as string);
      if (req.query.to) filters.to = new Date(req.query.to as string);

      const sessions = await storage.getOffsiteSessions(filters);

      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      // Batch-fetch all needed offsite rules in a single query (fixes N+1)
      const ruleIds = Array.from(new Set(sessions.map(s => s.ruleId).filter((id): id is string => !!id)));
      const rulesMap = new Map<string, any>();
      if (ruleIds.length > 0) {
        const rules = await db.select().from(offsiteAllowanceRules).where(inArray(offsiteAllowanceRules.id, ruleIds));
        for (const rule of rules) {
          rulesMap.set(rule.id, rule);
        }
      }

      const enriched = sessions.map((session) => {
        const employee = userMap.get(session.userId);
        const rule = session.ruleId ? rulesMap.get(session.ruleId) ?? null : null;
        const mileageRateCents = rule?.mileageRateCents ?? 0;
        const totalDistanceMiles = session.totalDistanceMiles ? parseFloat(String(session.totalDistanceMiles)) : 0;
        const computedReimbursementCents = mileageRateCents > 0 && totalDistanceMiles > 0
          ? Math.round(totalDistanceMiles * mileageRateCents)
          : (session.reimbursementCents ?? 0);

        return {
          ...session,
          employeeName: employee
            ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.email
            : 'Unknown',
          employeeProfileImageUrl: employee?.profileImageUrl ?? null,
          ruleName: rule?.name ?? null,
          computedReimbursementCents,
          mileageRateCents,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching trip history:", error);
      res.status(500).json({ message: "Failed to fetch trip history" });
    }
  });

  // Active offsite rules for the current user (used by TimeClockWidget to show Start Trip button)
  app.get('/api/offsite-rules/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;

      // Find active offsite sessions for user
      const existingActiveSessions = await storage.getOffsiteSessions({ userId, status: 'active' }).catch(() => [] as any[]);
      const activeSession = (existingActiveSessions as any[])[0] || null;

      // Get user's current location via active time entry
      const activeEntry = await storage.getActiveTimeEntry(userId).catch(() => null);
      const locationId = activeEntry?.locationId;
      if (!locationId) {
        return res.json({ rules: [], todayTripCounts: {} });
      }

      const allRules = await storage.getOffsiteRules(locationId);
      const activeRules = allRules.filter(r => r.isActive);

      // Count trips today per rule for this user
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const allSessions = await storage.getOffsiteSessions({ userId, from: todayStart });
      const todayTripCounts: Record<string, number> = {};
      for (const rule of activeRules) {
        todayTripCounts[rule.id] = allSessions.filter(s => s.ruleId === rule.id && s.status !== 'active').length;
      }

      const currentHour = new Date().getHours();
      const currentMinute = new Date().getMinutes();
      const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

      // Filter rules by time window
      const applicableRules = activeRules.filter(rule => {
        if (rule.allowedTimeStart && rule.allowedTimeEnd) {
          return currentTimeStr >= rule.allowedTimeStart && currentTimeStr <= rule.allowedTimeEnd;
        }
        return true;
      });

      res.json({ rules: applicableRules, todayTripCounts, activeSession });
    } catch (error) {
      console.error("Error fetching active offsite rules:", error);
      res.status(500).json({ message: "Failed to fetch active offsite rules" });
    }
  });

  // Start an off-site trip manually
  app.post('/api/offsite-sessions/start', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { ruleId, latitude, longitude } = req.body;

      if (!ruleId) {
        return res.status(400).json({ message: "ruleId is required" });
      }

      const rule = await storage.getOffsiteRule(ruleId);
      if (!rule || !rule.isActive) {
        return res.status(404).json({ message: "Rule not found or inactive" });
      }

      const activeEntry = await storage.getActiveTimeEntry(userId).catch(() => null);
      if (!activeEntry) {
        return res.status(409).json({ message: "You must be clocked in to start an off-site trip" });
      }

      // Validate the rule applies to this location
      if (rule.locationId && activeEntry.locationId && rule.locationId !== activeEntry.locationId) {
        return res.status(403).json({ message: "This trip rule is not for your current work location" });
      }

      // Validate appliesTo eligibility
      const appliesTo = rule.appliesTo as string;
      if (appliesTo === 'managers_only') {
        const isManager = await resolveAnyPermission(userId, ['scheduling.manage', 'admin.manage_all', 'admin.manage_locations'], storage);
        if (!isManager) {
          return res.status(403).json({ message: "This trip rule is for managers only" });
        }
      } else if (appliesTo === 'specific_employees') {
        const allowedIds = (rule.specificEmployeeIds as string[]) || [];
        if (!allowedIds.includes(userId)) {
          return res.status(403).json({ message: "You are not authorized to use this trip rule" });
        }
      }

      // Validate time window
      if (rule.allowedTimeStart && rule.allowedTimeEnd) {
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${hh}:${mm}`;
        if (currentTime < rule.allowedTimeStart || currentTime > rule.allowedTimeEnd) {
          return res.status(409).json({
            message: `This trip rule is only available between ${rule.allowedTimeStart} and ${rule.allowedTimeEnd}`,
          });
        }
      }

      // Check daily trip limit
      if (rule.maxTripsPerDay && rule.maxTripsPerDay > 0) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todaySessions = await storage.getOffsiteSessions({ userId, ruleId, from: todayStart });
        const todayCount = todaySessions.filter(s => s.status !== 'active').length;
        if (todayCount >= rule.maxTripsPerDay) {
          return res.status(409).json({
            message: `Daily trip limit of ${rule.maxTripsPerDay} reached for this rule`,
            limitReached: true,
          });
        }
      }

      // Check if there's already an active offsite session
      const existingSessions = await storage.getOffsiteSessions({ userId, status: 'active' });
      if (existingSessions.length > 0) {
        return res.status(409).json({ message: "You already have an active off-site trip" });
      }

      const waypoints = rule.waypoints as Array<{ name: string; placeId: string; lat: number; lng: number; address: string }> | null;

      const session = await storage.createOffsiteSession({
        userId,
        locationId: rule.locationId,
        ruleId: rule.id,
        timeEntryId: activeEntry.id,
        exitTime: new Date(),
        status: 'active',
        sessionWaypoints: waypoints ? (waypoints.map(w => ({ ...w, arrivedAt: undefined })) as any) : null,
        currentLegIndex: 0,
        consecutiveOffRouteCount: 0,
      } as any);

      // Fetch route in background
      if (latitude != null && longitude != null) {
        const { fetchAndStoreRoute } = await import('../services/routeTrackingService');
        fetchAndStoreRoute(session, rule, latitude, longitude).catch((err) => {
          console.error('[StartTrip] Error fetching route:', err);
        });
      } else if (rule.chosenRoutePolyline) {
        await storage.updateOffsiteSession(session.id, {
          routePolyline: rule.chosenRoutePolyline,
        });
      }

      res.json(session);
    } catch (error) {
      console.error("Error starting off-site trip:", error);
      res.status(500).json({ message: "Failed to start off-site trip" });
    }
  });

  // Google Maps proxy endpoints — API key stays on the server; restricted to admin/owner
  async function requireOwner(storage: IStorage, userId: string): Promise<boolean> {
  return resolvePermission(userId, 'admin.manage_all', storage);
}

  app.get('/api/maps/places/autocomplete', isAuthenticated, async (req: any, res) => {
    const apiKey = config.googleMaps.apiKey;
    if (!apiKey) {
      return res.status(503).json({ message: "Google Maps API key not configured" });
    }
    if (!(await requireOwner(storage, req.user.id))) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const input = (req.query.input as string) || '';
    if (!input.trim()) {
      return res.status(400).json({ message: "input query parameter is required" });
    }
    if (input.length > 200) {
      return res.status(400).json({ message: "input must be 200 characters or fewer" });
    }
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
      url.searchParams.set('input', input);
      url.searchParams.set('key', apiKey);
      const response = await fetch(url.toString());
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error calling Google Places Autocomplete:", error);
      res.status(500).json({ message: "Failed to fetch autocomplete suggestions" });
    }
  });

  app.get('/api/maps/directions', isAuthenticated, async (req: any, res) => {
    const apiKey = config.googleMaps.apiKey;
    if (!apiKey) {
      return res.status(503).json({ message: "Google Maps API key not configured" });
    }
    if (!(await requireOwner(storage, req.user.id))) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const { origin, destination, waypoints, alternatives } = req.query;
    if (!origin || !destination) {
      return res.status(400).json({ message: "origin and destination are required" });
    }
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
      url.searchParams.set('origin', origin as string);
      url.searchParams.set('destination', destination as string);
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('key', apiKey);
      if (waypoints) url.searchParams.set('waypoints', waypoints as string);
      if (alternatives === 'true') url.searchParams.set('alternatives', 'true');
      const response = await fetch(url.toString());
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error calling Google Directions API:", error);
      res.status(500).json({ message: "Failed to fetch directions" });
    }
  });

  app.get('/api/maps/geocode', isAuthenticated, async (req: any, res) => {
    const apiKey = config.googleMaps.apiKey;
    if (!apiKey) {
      return res.status(503).json({ message: "Google Maps API key not configured" });
    }
    if (!(await requireOwner(storage, req.user.id))) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const placeId = (req.query.place_id as string) || '';
    const address = (req.query.address as string) || '';
    if (!placeId && !address) {
      return res.status(400).json({ message: "place_id or address query parameter is required" });
    }
    if (placeId.length > 500 || address.length > 500) {
      return res.status(400).json({ message: "Query parameter exceeds maximum length" });
    }
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      if (placeId) url.searchParams.set('place_id', placeId);
      if (address) url.searchParams.set('address', address);
      url.searchParams.set('key', apiKey);
      const response = await fetch(url.toString());
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error calling Google Geocode:", error);
      res.status(500).json({ message: "Failed to geocode address" });
    }
  });

  // Helper for checking payroll access
  async function requirePayrollAccess(storage: IStorage, userId: string): Promise<boolean> {
  return resolveAnyPermission(userId, ['admin.manage_all', 'hr.payroll_view', 'time.view_all'], storage);
}

  async function requirePayrollEdit(storage: IStorage, userId: string): Promise<boolean> {
  return resolveAnyPermission(userId, ['admin.manage_all', 'admin.manage_locations', 'hr.payroll_view'], storage);
}

  // Mileage reimbursement routes
  app.get('/api/mileage-reimbursements', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      if (!(await requirePayrollAccess(storage, requestingUserId))) {
        return res.status(403).json({ message: "Payroll access required" });
      }
      const { userId, startDate, endDate } = req.query;
      const filters: { userId?: string; startDate?: Date; endDate?: Date } = {};
      if (userId) filters.userId = userId as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      const reimbursements = await storage.getMileageReimbursements(filters);

      const enriched = await Promise.all(reimbursements.map(async (r) => {
        const session = await storage.getOffsiteSession(r.sessionId);
        const rule = session?.ruleId ? await storage.getOffsiteRule(session.ruleId) : null;
        return {
          ...r,
          ruleName: rule?.name || null,
          sessionStatus: session?.status || null,
          routeDistanceMeters: session?.routeDistanceMeters || null,
        };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching mileage reimbursements:", error);
      res.status(500).json({ message: "Failed to fetch mileage reimbursements" });
    }
  });

  app.get('/api/mileage-reimbursements/session/:sessionId', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      if (!(await requirePayrollAccess(storage, requestingUserId))) {
        return res.status(403).json({ message: "Payroll access required" });
      }
      const { sessionId } = req.params;
      const reimbursement = await storage.getMileageReimbursementBySession(sessionId);
      if (!reimbursement) {
        return res.status(404).json({ message: "Mileage reimbursement not found" });
      }
      res.json(reimbursement);
    } catch (error) {
      console.error("Error fetching mileage reimbursement:", error);
      res.status(500).json({ message: "Failed to fetch mileage reimbursement" });
    }
  });

  app.patch('/api/mileage-reimbursements/:id', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      if (!(await requirePayrollEdit(storage, requestingUserId))) {
        return res.status(403).json({ message: "Admin access required to adjust mileage reimbursements" });
      }

      const { id } = req.params;
      const { adjustedMilesDecimal } = req.body;

      const existing = await storage.getMileageReimbursement(id);
      if (!existing) {
        return res.status(404).json({ message: "Mileage reimbursement not found" });
      }

      const updatedMiles = parseFloat(String(adjustedMilesDecimal));
      if (isNaN(updatedMiles) || updatedMiles < 0) {
        return res.status(400).json({ message: "adjustedMilesDecimal must be a non-negative number" });
      }

      const newTotalCents = Math.round(updatedMiles * existing.rateCents);
      const employeeUser = await storage.getUser(existing.userId);
      const hourlyRate = employeeUser ? parseFloat(String(employeeUser.hourlyRate || '0')) : 0;
      const newEquivalentMinutes = hourlyRate > 0
        ? Math.round(((newTotalCents / 100) / hourlyRate) * 60)
        : 0;

      const updated = await storage.updateMileageReimbursement(id, {
        adjustedMilesDecimal: String(updatedMiles),
        adjustedBy: requestingUserId,
        adjustedAt: new Date(),
        totalCents: newTotalCents,
        equivalentMinutes: newEquivalentMinutes,
      });

      if (existing.timeEntryId) {
        const entry = await storage.getTimeEntry(existing.timeEntryId);
        if (entry) {
          const oldCents = Number(entry.mileageTotalCents) || 0;
          const oldMinutes = Number(entry.mileageMinutes) || 0;
          const deltaCents = newTotalCents - existing.totalCents;
          const deltaMinutes = newEquivalentMinutes - existing.equivalentMinutes;
          await storage.updateTimeEntry(existing.timeEntryId, {
            mileageTotalCents: Math.max(0, oldCents + deltaCents),
            mileageMinutes: Math.max(0, oldMinutes + deltaMinutes),
          });
        }
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating mileage reimbursement:", error);
      res.status(500).json({ message: "Failed to update mileage reimbursement" });
    }
  });

  app.post('/api/mileage-reimbursements/reprocess/:sessionId', isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = req.user.id;
      if (!(await requirePayrollEdit(storage, requestingUserId))) {
        return res.status(403).json({ message: "Admin access required to reprocess mileage reimbursements" });
      }
      const { sessionId } = req.params;
      const result = await postMileageReimbursement(sessionId);
      res.json(result);
    } catch (error) {
      console.error("Error reprocessing mileage reimbursement:", error);
      res.status(500).json({ message: "Failed to reprocess mileage reimbursement" });
    }
  });

  app.get('/api/maps/trip-map', isAuthenticated, async (req: any, res) => {
    const apiKey = config.googleMaps.apiKey;
    if (!apiKey) {
      return res.status(503).json({ message: "Google Maps API key not configured" });
    }
    const requestingUserId = req.user.id;
    const isAdmin = await resolveAnyPermission(requestingUserId, ['admin.manage_all', 'admin.manage_locations', 'time.view_all'], storage);
    const { sessionId } = req.query as { sessionId?: string };
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }
    const session = await storage.getOffsiteSession(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    if (session.userId !== requestingUserId && !isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const breadcrumbs = await storage.getOffsiteBreadcrumbs(sessionId);
      const isLive = req.query.live === '1' || req.query.live === 'true';

      // Optional caller-supplied current GPS (used in live view for fresh pin)
      const currentLatRaw = req.query.currentLat as string | undefined;
      const currentLngRaw = req.query.currentLng as string | undefined;
      let currentLat: number | null = null;
      let currentLng: number | null = null;
      if (currentLatRaw && currentLngRaw) {
        const lat = parseFloat(currentLatRaw);
        const lng = parseFloat(currentLngRaw);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          currentLat = lat;
          currentLng = lng;
        }
      }

      const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
      url.searchParams.set('size', '640x360');
      url.searchParams.set('scale', '2');
      url.searchParams.set('key', apiKey);

      // Planned route polyline (blue)
      if (session.routePolyline) {
        url.searchParams.append('path', `color:0x4285F4CC|weight:4|enc:${session.routePolyline}`);
      }

      // Actual GPS path (green), sampled to keep URL short
      if (breadcrumbs.length > 0) {
        const step = Math.max(1, Math.floor(breadcrumbs.length / 60));
        const sampled = breadcrumbs.filter((_, i) => i % step === 0 || i === breadcrumbs.length - 1);
        const pathPts = sampled.map(b => `${b.latitude},${b.longitude}`).join('|');
        url.searchParams.append('path', `color:0x34A853CC|weight:3|${pathPts}`);
      }

      // Deviation pins (red)
      const deviationCrumbs = breadcrumbs.filter(b => b.isDeviation).slice(0, 10);
      for (const d of deviationCrumbs) {
        url.searchParams.append('markers', `color:red|size:tiny|${d.latitude},${d.longitude}`);
      }

      // Rule destination marker
      const rule = session.ruleId ? await storage.getOffsiteRule(session.ruleId) : null;
      if (rule?.destinationLat && rule?.destinationLng) {
        url.searchParams.append('markers', `color:red|label:D|${rule.destinationLat},${rule.destinationLng}`);
      }

      // Waypoint markers
      const waypoints = session.sessionWaypoints as Array<{ lat: number; lng: number; name: string; arrivedAt?: string }> | null;
      if (waypoints) {
        waypoints.forEach((w, i) => {
          url.searchParams.append('markers', `color:blue|label:${i + 1}|${w.lat},${w.lng}`);
        });
      }

      // Starting marker
      if (breadcrumbs.length > 0) {
        const first = breadcrumbs[0];
        url.searchParams.append('markers', `color:green|label:S|${first.latitude},${first.longitude}`);
      }

      // Current location pin (live view only)
      if (isLive) {
        let pinLat: number | string | null = null;
        let pinLng: number | string | null = null;
        if (currentLat != null && currentLng != null) {
          pinLat = currentLat;
          pinLng = currentLng;
        } else if (breadcrumbs.length > 0) {
          const last = breadcrumbs[breadcrumbs.length - 1];
          pinLat = last.latitude;
          pinLng = last.longitude;
        }
        if (pinLat != null && pinLng != null) {
          url.searchParams.append('markers', `color:0x9333EA|label:Y|${pinLat},${pinLng}`);
        }
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        return res.status(502).json({ message: "Failed to fetch trip map" });
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      res.set('Content-Type', contentType);
      // Live maps must not be cached so refreshes show the latest position
      res.set('Cache-Control', isLive ? 'no-store, max-age=0' : 'public, max-age=3600');
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Error generating trip map:", error);
      res.status(500).json({ message: "Failed to generate trip map" });
    }
  });

  // Route preview: renders a single polyline as a static map image (used in admin form route selection)
  app.get('/api/maps/route-preview', isAuthenticated, async (req: any, res) => {
    const apiKey = config.googleMaps.apiKey;
    if (!apiKey) {
      return res.status(503).json({ message: "Google Maps API key not configured" });
    }
    const { polyline } = req.query as { polyline?: string };
    if (!polyline) {
      return res.status(400).json({ message: "polyline is required" });
    }
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
      url.searchParams.set('size', '640x240');
      url.searchParams.set('scale', '2');
      url.searchParams.set('key', apiKey);
      url.searchParams.append('path', `color:0x4285F4CC|weight:4|enc:${polyline}`);
      const response = await fetch(url.toString());
      if (!response.ok) {
        return res.status(502).json({ message: "Failed to fetch route preview" });
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=3600');
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Error generating route preview:", error);
      res.status(500).json({ message: "Failed to generate route preview" });
    }
  });

  app.get('/api/maps/static-map', isAuthenticated, async (req: any, res) => {
    const apiKey = config.googleMaps.apiKey;
    if (!apiKey) {
      return res.status(503).json({ message: "Google Maps API key not configured" });
    }
    if (!(await requireOwner(storage, req.user.id))) {
      return res.status(403).json({ message: "Admin access required" });
    }
    const latRaw = req.query.lat as string;
    const lngRaw = req.query.lng as string;
    const zoomRaw = (req.query.zoom as string) || '14';
    if (!latRaw || !lngRaw) {
      return res.status(400).json({ message: "lat and lng are required" });
    }
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);
    const zoom = Math.min(21, Math.max(0, parseInt(zoomRaw, 10) || 14));
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ message: "lat must be a number between -90 and 90" });
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "lng must be a number between -180 and 180" });
    }
    const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
    url.searchParams.set('center', `${lat},${lng}`);
    url.searchParams.set('zoom', String(zoom));
    url.searchParams.set('size', '300x150');
    url.searchParams.set('markers', `color:red|${lat},${lng}`);
    url.searchParams.set('key', apiKey);
    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        return res.status(502).json({ message: "Failed to fetch map image" });
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Error fetching static map:", error);
      res.status(500).json({ message: "Failed to fetch static map" });
    }
  });
}
