import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertSupplySchema } from "@shared/schema";
import { z } from "zod";

function isAdminOrOwner(user: any): boolean {
  const role = user?.role?.name?.toLowerCase() ?? '';
  return role === 'admin' || role === 'owner' || user?.isAdmin;
}

export function registerSupplyRequestRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: (req: any, res: any, next: any) => void,
) {
  app.get('/api/supplies', isAuthenticated, async (req: any, res) => {
    try {
      if (!isAdminOrOwner(req.user)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const currentUser = await storage.getUser(req.user.id);
      if (!currentUser?.companyId) {
        return res.json([]);
      }
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const items = await storage.getSupplies(currentUser.companyId, weekAgo);

      const requesterIds = [...new Set(items.map((s) => s.requestedBy))];
      const requesterList = await Promise.all(requesterIds.map((id) => storage.getUser(id)));
      const userMap = new Map(
        requesterList
          .filter((u): u is NonNullable<typeof u> => u != null)
          .map((u) => [u.id, u]),
      );

      const enriched = items.map((s) => {
        const requester = userMap.get(s.requestedBy);
        return {
          ...s,
          requestedByName: requester
            ? `${requester.firstName ?? ''} ${requester.lastName ?? ''}`.trim()
            : 'Unknown',
        };
      });
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/supplies', isAuthenticated, async (req: any, res) => {
    try {
      if (!isAdminOrOwner(req.user)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const currentUser = await storage.getUser(req.user.id);
      if (!currentUser?.companyId) {
        return res.status(400).json({ message: 'User has no company association' });
      }
      const body = insertSupplySchema.parse({
        ...req.body,
        requestedBy: req.user.id,
        companyId: currentUser.companyId,
        purchased: false,
      });
      const item = await storage.createSupply(body);
      res.status(201).json({
        ...item,
        requestedByName: currentUser
          ? `${currentUser.firstName ?? ''} ${currentUser.lastName ?? ''}`.trim()
          : 'Unknown',
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: 'Validation error', errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.patch('/api/supplies/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!isAdminOrOwner(req.user)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const currentUser = await storage.getUser(req.user.id);
      if (!currentUser?.companyId) {
        return res.status(400).json({ message: 'User has no company association' });
      }
      const { id } = req.params;
      if (typeof req.body.purchased !== 'boolean') {
        return res.status(400).json({ message: 'purchased field (boolean) is required' });
      }
      const updates = {
        purchased: req.body.purchased,
        purchasedAt: req.body.purchased ? new Date() : null,
      };
      const updated = await storage.updateSupply(id, currentUser.companyId, updates);
      res.json(updated);
    } catch (err: any) {
      if (err.message === 'Supply not found or access denied') {
        return res.status(404).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });
}
