import type { Express } from "express";
import type { IStorage } from "../storage";

export function registerAvailabilityRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.post('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const { availability } = req.body;
      const userId = req.user.id;
      
      const availabilityWithUserId = availability.map((avail: any) => ({
        ...avail,
        userId,
        date: new Date(avail.date),
        payrollPeriodId: avail.payrollPeriodId || null,
      }));
      
      const submitted = await storage.submitAvailability(availabilityWithUserId);
      res.json(submitted);
    } catch (error) {
      console.error("Error submitting availability:", error);
      res.status(500).json({ message: "Failed to submit availability" });
    }
  });

  app.get('/api/availability', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { payrollPeriodId, startDate, endDate } = req.query;
      
      if (startDate && endDate) {
        const availability = await storage.getUserAvailabilityByDateRange(
          userId,
          new Date(startDate as string),
          new Date(endDate as string)
        );
        return res.json(availability);
      }
      
      const availability = await storage.getUserAvailability(userId, payrollPeriodId as string);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ message: "Failed to fetch availability" });
    }
  });

  app.get('/api/availability/period/:periodId', isAuthenticated, async (req: any, res) => {
    try {
      const { periodId } = req.params;
      const availability = await storage.getAllAvailabilityForPeriod(periodId);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching period availability:", error);
      res.status(500).json({ message: "Failed to fetch period availability" });
    }
  });

  app.get('/api/availability/all', isAuthenticated, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }
      const availability = await storage.getAllAvailabilityByDateRange(
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.json(availability);
    } catch (error) {
      console.error("Error fetching all availability:", error);
      res.status(500).json({ message: "Failed to fetch all availability" });
    }
  });

  // Availability template routes
  app.get('/api/availability/template', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const template = await storage.getAvailabilityTemplate(userId);
      res.json(template || null);
    } catch (error) {
      console.error("Error fetching availability template:", error);
      res.status(500).json({ message: "Failed to fetch availability template" });
    }
  });

  app.post('/api/availability/template', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { slots } = req.body;
      if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
        return res.status(400).json({ message: "slots must be an object" });
      }
      // Validate structure: keys must be day-of-week strings 0..6, values must have boolean fields
      const validDays = new Set(['0','1','2','3','4','5','6']);
      for (const [key, val] of Object.entries(slots)) {
        if (!validDays.has(key)) {
          return res.status(400).json({ message: `Invalid day key: ${key}. Must be 0–6.` });
        }
        if (!val || typeof val !== 'object') {
          return res.status(400).json({ message: `slots.${key} must be an object with morning/afternoon/evening booleans` });
        }
        const v = val as Record<string, unknown>;
        if (typeof v.morning !== 'boolean' || typeof v.afternoon !== 'boolean' || typeof v.evening !== 'boolean') {
          return res.status(400).json({ message: `slots.${key} must have boolean morning, afternoon, and evening fields` });
        }
      }
      const template = await storage.upsertAvailabilityTemplate(userId, slots);
      res.json(template);
    } catch (error) {
      console.error("Error saving availability template:", error);
      res.status(500).json({ message: "Failed to save availability template" });
    }
  });

  // Time-off request routes
  app.post('/api/time-off-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { type, startDate, endDate, allDay, startTime, endTime, reason } = req.body;
      
      if (!type || !startDate || !endDate) {
        return res.status(400).json({ message: "type, startDate, and endDate are required" });
      }

      const request = await storage.createTimeOffRequest({
        userId,
        type,
        status: 'pending',
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        allDay: allDay ?? true,
        startTime: startTime || null,
        endTime: endTime || null,
        reason: reason || null,
        adminNotes: null,
        reviewedBy: null,
      });
      
      res.json(request);
    } catch (error) {
      console.error("Error creating time-off request:", error);
      res.status(500).json({ message: "Failed to create time-off request" });
    }
  });

  app.get('/api/time-off-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const roleName = req.user?.role?.name;
      const canReview = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';
      const { all } = req.query;

      if (all === 'true' && canReview) {
        const requests = await storage.getTimeOffRequests();
        return res.json(requests);
      }
      
      const requests = await storage.getTimeOffRequests(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time-off requests:", error);
      res.status(500).json({ message: "Failed to fetch time-off requests" });
    }
  });

  app.patch('/api/time-off-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const roleName = req.user?.role?.name;
      const isAdmin = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';
      const { status, adminNotes } = req.body;

      const existing = await storage.getTimeOffRequest(id);
      if (!existing) {
        return res.status(404).json({ message: "Time-off request not found" });
      }

      if (status === 'cancelled' && existing.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if ((status === 'approved' || status === 'denied') && !isAdmin) {
        return res.status(403).json({ message: "Only admins can approve or deny requests" });
      }

      const updates: any = { status };
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;
      if (status === 'approved' || status === 'denied') {
        updates.reviewedBy = userId;
        updates.reviewedAt = new Date();
      }

      const updated = await storage.updateTimeOffRequest(id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating time-off request:", error);
      res.status(500).json({ message: "Failed to update time-off request" });
    }
  });

  app.delete('/api/time-off-requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const roleName = req.user?.role?.name;
      const isAdmin = roleName === 'admin' || roleName === 'owner' || roleName === 'manager';

      const existing = await storage.getTimeOffRequest(id);
      if (!existing) {
        return res.status(404).json({ message: "Time-off request not found" });
      }

      if (existing.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      await storage.deleteTimeOffRequest(id);
      res.json({ message: "Request deleted" });
    } catch (error) {
      console.error("Error deleting time-off request:", error);
      res.status(500).json({ message: "Failed to delete time-off request" });
    }
  });
}
