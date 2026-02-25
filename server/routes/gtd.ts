import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { gtdInboxItems, insertGtdInboxItemSchema, users, workLocations } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { triggerClarification } from "../services/gtdClarificationAI";
import logger from "../lib/logger";

const patchInboxItemSchema = z.object({
  status: z.enum(['unprocessed', 'clarified', 'processed', 'deleted']).optional(),
  processedIntoType: z.enum(['next_action', 'project', 'waiting_for', 'someday_maybe', 'reference', 'trash', 'calendar', 'issue']).optional(),
  processedIntoId: z.string().optional(),
});

export function registerGtdRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void
) {
  app.post('/api/gtd/inbox', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;

    const allLocations = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
    const storeId = allLocations[0]?.id;
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const body = insertGtdInboxItemSchema.parse({
      ...req.body,
      storeId,
      capturedBy: userId,
      status: 'unprocessed',
    });

    const [item] = await db.insert(gtdInboxItems).values(body).returning();

    broadcastToAll({ type: 'inbox_item_created', data: { item } });

    const user = await storage.getUserWithRole(userId);
    const employeeName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
    const employeeRole = user?.role?.name || 'employee';

    triggerClarification(item.id, item.rawInput, storeId, employeeName, employeeRole, broadcastToAll)
      .catch(err => logger.error({ error: err.message, itemId: item.id }, 'Background clarification failed'));

    res.status(201).json({ success: true, data: item });
  }));

  app.get('/api/gtd/inbox', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;

    const allLocations = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
    const storeId = allLocations[0]?.id;
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const statusFilter = req.query.status as string | undefined;

    let items;
    if (statusFilter) {
      items = await db.select().from(gtdInboxItems)
        .where(and(eq(gtdInboxItems.storeId, storeId), eq(gtdInboxItems.status, statusFilter)))
        .orderBy(desc(gtdInboxItems.createdAt));
    } else {
      items = await db.select().from(gtdInboxItems)
        .where(eq(gtdInboxItems.storeId, storeId))
        .orderBy(desc(gtdInboxItems.createdAt));
    }

    res.json({ success: true, data: items });
  }));

  app.get('/api/gtd/inbox/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const [item] = await db.select().from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!item) throw new AppError(404, "Inbox item not found", "NOT_FOUND");
    res.json({ success: true, data: item });
  }));

  app.patch('/api/gtd/inbox/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    const [existing] = await db.select().from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!existing) throw new AppError(404, "Inbox item not found", "NOT_FOUND");

    const body = patchInboxItemSchema.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status) updateData.status = body.status;
    if (body.processedIntoType) updateData.processedIntoType = body.processedIntoType;
    if (body.processedIntoId) updateData.processedIntoId = body.processedIntoId;
    if (body.status === 'processed') updateData.processedAt = new Date();

    const [updated] = await db.update(gtdInboxItems)
      .set(updateData)
      .where(eq(gtdInboxItems.id, id))
      .returning();

    broadcastToAll({ type: 'inbox_item_updated', data: { item: updated } });
    res.json({ success: true, data: updated });
  }));

  app.delete('/api/gtd/inbox/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    const [existing] = await db.select({ id: gtdInboxItems.id }).from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!existing) throw new AppError(404, "Inbox item not found", "NOT_FOUND");

    const [updated] = await db.update(gtdInboxItems)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(gtdInboxItems.id, id))
      .returning();

    res.json({ success: true, data: updated });
  }));

  app.post('/api/gtd/inbox/:id/reclarify', isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    const [item] = await db.select().from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!item) throw new AppError(404, "Inbox item not found", "NOT_FOUND");

    const user = await storage.getUserWithRole(req.user.id);
    const employeeName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
    const employeeRole = user?.role?.name || 'employee';

    triggerClarification(item.id, item.rawInput, item.storeId, employeeName, employeeRole, broadcastToAll)
      .catch(err => logger.error({ error: err.message, itemId: item.id }, 'Reclarification failed'));

    res.json({ success: true, message: 'Reclarification triggered' });
  }));
}
