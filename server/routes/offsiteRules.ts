import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertOffsiteAllowanceRuleSchema, type InsertOffsiteAllowanceRule } from "@shared/schema";
import { config } from "../lib/config";
import { processOffsiteBreadcrumb } from "../services/routeTrackingService";

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

      const allowedFields = [
        'name', 'allowedMinutes', 'allowedTimeStart', 'allowedTimeEnd',
        'appliesTo', 'specificEmployeeIds', 'alertAfterMinutes',
        'alertRecipients', 'customAlertUserIds', 'isActive',
        'destinationAddress', 'destinationPlaceId', 'destinationLat',
        'destinationLng', 'destinationName', 'mileageRateCents',
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

  app.get('/api/offsite-sessions/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const sessions = await storage.getOffsiteSessions({ userId, status: 'active' });
      res.json(sessions[0] || null);
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

      const userPermissions = await storage.getUserPermissions(userId);
      const isAdmin = userPermissions.some((p: any) =>
        p.name === 'admin.manage_all' || p.name === 'admin.manage_locations' || p.name === 'time.view_all'
      );

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
        const userPermissions = await storage.getUserPermissions(requestingUserId);
        const isAdmin = userPermissions.some((p: any) =>
          p.name === 'admin.manage_all' || p.name === 'admin.manage_locations' || p.name === 'time.view_all'
        );
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

  // Google Maps proxy endpoints — API key stays on the server; restricted to admin/owner
  async function requireOwner(storage: IStorage, userId: string): Promise<boolean> {
    const perms = await storage.getUserPermissions(userId);
    return perms.some((p: any) => p.name === 'admin.manage_all');
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
