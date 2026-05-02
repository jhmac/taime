import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, desc, asc, sql, lte, gte, ilike, or, count, inArray } from "drizzle-orm";
import {
  gtdInboxItems, gtdProjects, gtdNextActions, gtdWaitingFor,
  gtdSomedayMaybe, gtdReference, issues, workLocations,
  insertGtdInboxItemSchema, insertGtdProjectSchema, insertGtdNextActionSchema,
  insertGtdWaitingForSchema, insertGtdSomedayMaybeSchema, insertGtdReferenceSchema,
} from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { triggerClarification } from "../services/gtdClarificationAI";
import logger from "../lib/logger";
import { computeGtdInboxRecipients, computeGtdActionRecipients } from "../lib/broadcastRecipients";
import { resolveAnyPermission } from "../services/permissionResolver";

const captureSchema = z.object({
  raw_input: z.string().min(1).max(2000),
  source: z.enum(['manual', 'voice', 'debrief', 'issue_auto', 'sop_feedback', 'huddle', 'quick_capture']).optional().default('manual'),
});

const processInboxSchema = z.object({
  destination: z.enum(['next_action', 'project', 'waiting_for', 'someday_maybe', 'reference', 'trash', 'issue']),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  context: z.enum(['@store', '@computer', '@phone', '@errands', '@home', '@anywhere']).optional(),
  energy_level: z.enum(['low', 'medium', 'high']).optional(),
  time_estimate_minutes: z.number().int().min(1).max(480).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  due_date: z.string().optional(),
  assigned_to: z.string().optional(),
  project_id: z.string().optional(),
  is_two_minute: z.boolean().optional(),
  waiting_on: z.string().optional(),
  waiting_on_employee_id: z.string().optional(),
  follow_up_date: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const createActionSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  context: z.enum(['@store', '@computer', '@phone', '@errands', '@home', '@anywhere']).optional(),
  energy_level: z.enum(['low', 'medium', 'high']).optional(),
  time_estimate_minutes: z.number().int().min(1).max(480).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  due_date: z.string().optional(),
  assigned_to: z.string().optional(),
  project_id: z.string().optional(),
  is_two_minute: z.boolean().optional(),
});

const updateActionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  context: z.enum(['@store', '@computer', '@phone', '@errands', '@home', '@anywhere']).nullable().optional(),
  energy_level: z.enum(['low', 'medium', 'high']).nullable().optional(),
  time_estimate_minutes: z.number().int().min(1).max(480).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  status: z.enum(['active', 'completed', 'deferred']).optional(),
  due_date: z.string().nullable().optional(),
  assigned_to: z.string().optional(),
  project_id: z.string().nullable().optional(),
  is_two_minute: z.boolean().optional(),
});

const createProjectSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  desired_outcome: z.string().max(2000).optional(),
  due_date: z.string().optional(),
  owner_id: z.string().optional(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  desired_outcome: z.string().max(2000).nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(['active', 'completed', 'on_hold', 'cancelled']).optional(),
});

const createWaitingSchema = z.object({
  waiting_on: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  waiting_on_employee_id: z.string().optional(),
  follow_up_date: z.string().optional(),
  project_id: z.string().optional(),
});

const updateWaitingSchema = z.object({
  waiting_on: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(5000).optional(),
  follow_up_date: z.string().nullable().optional(),
  status: z.enum(['waiting', 'received', 'cancelled']).optional(),
});

const createSomedaySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
});

const updateSomedaySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  status: z.enum(['parked', 'activated', 'deleted']).optional(),
  activate_as: z.enum(['project', 'next_action']).optional(),
});

const createReferenceSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10000),
  tags: z.array(z.string()).optional().default([]),
});

const updateReferenceSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(10000).optional(),
  tags: z.array(z.string()).optional(),
});

async function getStoreId(): Promise<string> {
  const [store] = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
  if (!store) throw new AppError(400, "No store configured", "NO_STORE");
  return store.id;
}

async function isManagerOrOwner(storage: IStorage, userId: string): Promise<boolean> {
  return resolveAnyPermission(userId, ["admin.manage_all", "admin.role_management", "admin.manage_payroll"], storage);
}

function parsePagination(query: any): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset) || 0, 0);
  return { limit, offset };
}

export function registerGtdRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void,
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
) {

  // ── INBOX ──────────────────────────────────────────────

  app.post('/api/gtd/inbox', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const body = captureSchema.parse(req.body);

    const [item] = await db.insert(gtdInboxItems).values({
      storeId,
      capturedBy: userId,
      rawInput: body.raw_input,
      source: body.source,
      status: 'unprocessed',
    }).returning();

    sendToUsers(computeGtdInboxRecipients(userId), { type: 'inbox_item_created', data: { item } });

    const user = await storage.getUserWithRole(userId);
    const employeeName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
    const employeeRole = user?.role?.name || 'employee';

    triggerClarification(item.id, item.rawInput, storeId, employeeName, employeeRole, broadcastToAll)
      .catch(err => logger.error({ error: err.message, itemId: item.id }, 'Background clarification failed'));

    res.status(201).json({ success: true, data: item });
  }));

  app.get('/api/gtd/inbox', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const { limit, offset } = parsePagination(req.query);
    const isManager = await isManagerOrOwner(storage, userId);

    const statusFilter = req.query.status as string | undefined;
    const sourceFilter = req.query.source as string | undefined;
    const capturedByFilter = req.query.captured_by as string | undefined;
    const conditions = [eq(gtdInboxItems.storeId, storeId)];

    // Non-managers always see only their own items.
    // Managers can optionally scope to a specific user via captured_by=me or a userId.
    if (!isManager) {
      conditions.push(eq(gtdInboxItems.capturedBy, userId));
    } else if (capturedByFilter) {
      const targetUser = capturedByFilter === 'me' ? userId : capturedByFilter;
      conditions.push(eq(gtdInboxItems.capturedBy, targetUser));
    }

    if (sourceFilter) {
      conditions.push(eq(gtdInboxItems.source, sourceFilter));
    }

    if (statusFilter && statusFilter !== 'all') {
      conditions.push(eq(gtdInboxItems.status, statusFilter));
    } else if (!statusFilter) {
      conditions.push(
        or(eq(gtdInboxItems.status, 'unprocessed'), eq(gtdInboxItems.status, 'clarified'))!
      );
    }

    const items = await db.select().from(gtdInboxItems)
      .where(and(...conditions))
      .orderBy(desc(gtdInboxItems.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: items });
  }));

  app.post('/api/gtd/inbox/:id/resolve', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const isManager = await isManagerOrOwner(storage, userId);
    if (!isManager) {
      throw new AppError(403, "Only admins can resolve submissions", "FORBIDDEN");
    }

    const [item] = await db.select().from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!item) throw new AppError(404, "Inbox item not found", "NOT_FOUND");

    if (item.status === 'processed' && item.processedIntoType === 'resolved') {
      return res.json({ success: true, data: item });
    }

    const [updated] = await db.update(gtdInboxItems).set({
      status: 'processed',
      processedAt: new Date(),
      processedIntoType: 'resolved',
      processedIntoId: null,
      updatedAt: new Date(),
    }).where(eq(gtdInboxItems.id, id)).returning();

    sendToUsers(computeGtdInboxRecipients(item.capturedBy), {
      type: 'inbox_item_processed',
      data: { itemId: id, destination: 'resolved', createdId: null },
    });

    res.json({ success: true, data: updated });
  }));

  app.post('/api/gtd/inbox/:id/process', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const storeId = await getStoreId();

    const [item] = await db.select().from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!item) throw new AppError(404, "Inbox item not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (item.capturedBy !== userId && !isManager) {
      throw new AppError(403, "Not authorized to process this item", "FORBIDDEN");
    }

    const body = processInboxSchema.parse(req.body);
    const title = body.title || (item.aiClarification as any)?.suggested_title || item.rawInput.slice(0, 200);

    let createdId: string | null = null;

    await db.transaction(async (tx) => {
      if (body.destination === 'next_action') {
        const [action] = await tx.insert(gtdNextActions).values({
          storeId,
          assignedTo: body.assigned_to || userId,
          createdBy: userId,
          title,
          description: body.description || null,
          context: body.context || null,
          energyLevel: body.energy_level || null,
          timeEstimateMinutes: body.time_estimate_minutes || null,
          priority: body.priority || 'normal',
          dueDate: body.due_date || null,
          projectId: body.project_id || null,
          isTwoMinute: body.is_two_minute || false,
          sourceInboxItemId: id,
        }).returning();
        createdId = action.id;

      } else if (body.destination === 'project') {
        const [project] = await tx.insert(gtdProjects).values({
          storeId,
          ownerId: body.assigned_to || userId,
          title,
          description: body.description || null,
          desiredOutcome: null,
          dueDate: body.due_date || null,
        }).returning();
        createdId = project.id;

      } else if (body.destination === 'waiting_for') {
        const [wf] = await tx.insert(gtdWaitingFor).values({
          storeId,
          ownerId: userId,
          waitingOn: body.waiting_on || title,
          waitingOnEmployeeId: body.waiting_on_employee_id || null,
          description: body.description || title,
          followUpDate: body.follow_up_date || null,
          projectId: body.project_id || null,
          sourceInboxItemId: id,
        }).returning();
        createdId = wf.id;

      } else if (body.destination === 'someday_maybe') {
        const [sm] = await tx.insert(gtdSomedayMaybe).values({
          storeId,
          ownerId: userId,
          title,
          description: body.description || null,
          category: body.category || null,
          sourceInboxItemId: id,
        }).returning();
        createdId = sm.id;

      } else if (body.destination === 'reference') {
        const [ref] = await tx.insert(gtdReference).values({
          storeId,
          ownerId: userId,
          title,
          content: body.description || item.rawInput,
          tags: body.tags || [],
          sourceInboxItemId: id,
        }).returning();
        createdId = ref.id;

      } else if (body.destination === 'issue') {
        const [issue] = await tx.insert(issues).values({
          storeId,
          reportedBy: userId,
          title,
          description: body.description || null,
          category: body.category || 'general',
          priority: body.priority || 'medium',
          status: 'open',
        }).returning();
        createdId = issue.id;
      }

      await tx.update(gtdInboxItems).set({
        status: 'processed',
        processedAt: new Date(),
        processedIntoType: body.destination,
        processedIntoId: createdId,
        updatedAt: new Date(),
      }).where(eq(gtdInboxItems.id, id));
    });

    sendToUsers(computeGtdInboxRecipients(userId), { type: 'inbox_item_processed', data: { itemId: id, destination: body.destination, createdId } });
    res.json({ success: true, data: { itemId: id, destination: body.destination, createdId } });
  }));

  app.delete('/api/gtd/inbox/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [item] = await db.select().from(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    if (!item) throw new AppError(404, "Inbox item not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (item.capturedBy !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    if (item.status === 'unprocessed') {
      await db.delete(gtdInboxItems).where(eq(gtdInboxItems.id, id));
    } else {
      await db.update(gtdInboxItems)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(gtdInboxItems.id, id));
    }

    res.json({ success: true });
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

  // ── NEXT ACTIONS ───────────────────────────────────────

  app.get('/api/gtd/actions', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const { limit, offset } = parsePagination(req.query);
    const isManager = await isManagerOrOwner(storage, userId);

    const conditions = [eq(gtdNextActions.storeId, storeId)];

    if (!isManager) {
      conditions.push(eq(gtdNextActions.assignedTo, userId));
    } else if (req.query.assigned_to) {
      conditions.push(eq(gtdNextActions.assignedTo, req.query.assigned_to));
    }

    if (req.query.context) conditions.push(eq(gtdNextActions.context, req.query.context));
    if (req.query.energy_level) conditions.push(eq(gtdNextActions.energyLevel, req.query.energy_level));
    if (req.query.project_id) conditions.push(eq(gtdNextActions.projectId, req.query.project_id));
    if (req.query.priority) conditions.push(eq(gtdNextActions.priority, req.query.priority));
    if (req.query.status) {
      conditions.push(eq(gtdNextActions.status, req.query.status));
    } else {
      conditions.push(eq(gtdNextActions.status, 'active'));
    }
    if (req.query.due_before) conditions.push(lte(gtdNextActions.dueDate, req.query.due_before));
    if (req.query.is_two_minute === 'true') conditions.push(eq(gtdNextActions.isTwoMinute, true));

    const actions = await db.select({
      id: gtdNextActions.id,
      storeId: gtdNextActions.storeId,
      projectId: gtdNextActions.projectId,
      assignedTo: gtdNextActions.assignedTo,
      createdBy: gtdNextActions.createdBy,
      title: gtdNextActions.title,
      description: gtdNextActions.description,
      context: gtdNextActions.context,
      energyLevel: gtdNextActions.energyLevel,
      timeEstimateMinutes: gtdNextActions.timeEstimateMinutes,
      priority: gtdNextActions.priority,
      status: gtdNextActions.status,
      dueDate: gtdNextActions.dueDate,
      completedAt: gtdNextActions.completedAt,
      isTwoMinute: gtdNextActions.isTwoMinute,
      sourceInboxItemId: gtdNextActions.sourceInboxItemId,
      createdAt: gtdNextActions.createdAt,
      updatedAt: gtdNextActions.updatedAt,
      projectTitle: gtdProjects.title,
    })
      .from(gtdNextActions)
      .leftJoin(gtdProjects, eq(gtdNextActions.projectId, gtdProjects.id))
      .where(and(...conditions))
      .orderBy(
        sql`CASE ${gtdNextActions.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END`,
        asc(gtdNextActions.dueDate),
      )
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: actions });
  }));

  app.post('/api/gtd/actions', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const body = createActionSchema.parse(req.body);

    const [action] = await db.insert(gtdNextActions).values({
      storeId,
      assignedTo: body.assigned_to || userId,
      createdBy: userId,
      title: body.title,
      description: body.description || null,
      context: body.context || null,
      energyLevel: body.energy_level || null,
      timeEstimateMinutes: body.time_estimate_minutes || null,
      priority: body.priority || 'normal',
      dueDate: body.due_date || null,
      projectId: body.project_id || null,
      isTwoMinute: body.is_two_minute || false,
    }).returning();

    const actionRecipients = computeGtdActionRecipients(userId, action.assignedTo);
    sendToUsers(actionRecipients, { type: 'action_created', data: { action } });
    res.status(201).json({ success: true, data: action });
  }));

  app.put('/api/gtd/actions/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(gtdNextActions).where(eq(gtdNextActions.id, id));
    if (!existing) throw new AppError(404, "Action not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.assignedTo !== userId && existing.createdBy !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    const body = updateActionSchema.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.context !== undefined) updateData.context = body.context;
    if (body.energy_level !== undefined) updateData.energyLevel = body.energy_level;
    if (body.time_estimate_minutes !== undefined) updateData.timeEstimateMinutes = body.time_estimate_minutes;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.due_date !== undefined) updateData.dueDate = body.due_date;
    if (body.assigned_to !== undefined) updateData.assignedTo = body.assigned_to;
    if (body.project_id !== undefined) updateData.projectId = body.project_id;
    if (body.is_two_minute !== undefined) updateData.isTwoMinute = body.is_two_minute;
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === 'completed') {
        updateData.completedAt = new Date();
      }
    }

    const [updated] = await db.update(gtdNextActions)
      .set(updateData)
      .where(eq(gtdNextActions.id, id))
      .returning();

    if (body.status === 'completed') {
      await storage.createActivityLog({
        userId,
        action: 'complete',
        targetType: 'gtd_action',
        targetId: id,
        details: `Completed GTD action: ${updated.title}`,
      });
      const completedRecipients = computeGtdActionRecipients(userId, updated.assignedTo, updated.createdBy);
      sendToUsers(completedRecipients, { type: 'action_completed', data: { action: updated } });
    }

    res.json({ success: true, data: updated });
  }));

  app.delete('/api/gtd/actions/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(gtdNextActions).where(eq(gtdNextActions.id, id));
    if (!existing) throw new AppError(404, "Action not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.createdBy !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    await db.delete(gtdNextActions).where(eq(gtdNextActions.id, id));
    res.json({ success: true });
  }));

  // ── PROJECTS ───────────────────────────────────────────

  app.get('/api/gtd/projects', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const { limit, offset } = parsePagination(req.query);
    const isManager = await isManagerOrOwner(storage, userId);

    const conditions = [eq(gtdProjects.storeId, storeId)];

    if (!isManager) {
      conditions.push(eq(gtdProjects.ownerId, userId));
    } else if (req.query.owner_id) {
      conditions.push(eq(gtdProjects.ownerId, req.query.owner_id));
    }

    if (req.query.status) {
      conditions.push(eq(gtdProjects.status, req.query.status));
    } else {
      conditions.push(eq(gtdProjects.status, 'active'));
    }

    const projectRows = await db.select().from(gtdProjects)
      .where(and(...conditions))
      .orderBy(desc(gtdProjects.createdAt))
      .limit(limit)
      .offset(offset);

    const projectIds = projectRows.map(p => p.id);
    let actionCounts: Record<string, { total: number; completed: number }> = {};
    if (projectIds.length > 0) {
      const counts = await db.select({
        projectId: gtdNextActions.projectId,
        total: count(),
        completed: sql<number>`count(*) filter (where ${gtdNextActions.status} = 'completed')`,
      }).from(gtdNextActions)
        .where(inArray(gtdNextActions.projectId, projectIds))
        .groupBy(gtdNextActions.projectId);
      for (const row of counts) {
        if (row.projectId) {
          actionCounts[row.projectId] = { total: Number(row.total), completed: Number(row.completed) };
        }
      }
    }
    const projectsWithCounts = projectRows.map(p => {
      const c = actionCounts[p.id] || { total: 0, completed: 0 };
      const progress = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
      return { ...p, actionCount: c.total, completedActionCount: c.completed, progress };
    });

    res.json({ success: true, data: projectsWithCounts });
  }));

  app.post('/api/gtd/projects', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const body = createProjectSchema.parse(req.body);

    const [project] = await db.insert(gtdProjects).values({
      storeId,
      ownerId: body.owner_id || userId,
      title: body.title,
      description: body.description || null,
      desiredOutcome: body.desired_outcome || null,
      dueDate: body.due_date || null,
    }).returning();

    res.status(201).json({ success: true, data: project });
  }));

  app.get('/api/gtd/projects/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [project] = await db.select().from(gtdProjects).where(eq(gtdProjects.id, id));
    if (!project) throw new AppError(404, "Project not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (project.ownerId !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    const actions = await db.select().from(gtdNextActions)
      .where(eq(gtdNextActions.projectId, id))
      .orderBy(
        sql`CASE ${gtdNextActions.status} WHEN 'active' THEN 0 WHEN 'deferred' THEN 1 WHEN 'completed' THEN 2 END`,
        asc(gtdNextActions.dueDate),
      );

    const waitingItems = await db.select().from(gtdWaitingFor)
      .where(eq(gtdWaitingFor.projectId, id))
      .orderBy(desc(gtdWaitingFor.createdAt));

    const refItems = await db.select().from(gtdReference)
      .where(eq(gtdReference.sourceInboxItemId, id));

    res.json({
      success: true,
      data: { ...project, actions, waitingFor: waitingItems, reference: refItems },
    });
  }));

  app.put('/api/gtd/projects/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(gtdProjects).where(eq(gtdProjects.id, id));
    if (!existing) throw new AppError(404, "Project not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.ownerId !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    const body = updateProjectSchema.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.desired_outcome !== undefined) updateData.desiredOutcome = body.desired_outcome;
    if (body.due_date !== undefined) updateData.dueDate = body.due_date;
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === 'completed') {
        updateData.completedAt = new Date();
      }
    }

    const [updated] = await db.update(gtdProjects)
      .set(updateData)
      .where(eq(gtdProjects.id, id))
      .returning();

    if (body.status === 'completed') {
      const projectOwner = updated.ownerId || userId;
      const projectRecipients = Array.from(new Set([userId, projectOwner].filter(Boolean))) as string[];
      sendToUsers(projectRecipients, { type: 'project_completed', data: { project: updated } });
    }

    res.json({ success: true, data: updated });
  }));

  // ── WAITING FOR ────────────────────────────────────────

  app.get('/api/gtd/waiting', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const { limit, offset } = parsePagination(req.query);
    const isManager = await isManagerOrOwner(storage, userId);

    const conditions = [eq(gtdWaitingFor.storeId, storeId)];

    if (!isManager) {
      conditions.push(eq(gtdWaitingFor.ownerId, userId));
    }

    if (req.query.status) {
      conditions.push(eq(gtdWaitingFor.status, req.query.status));
    } else {
      conditions.push(eq(gtdWaitingFor.status, 'waiting'));
    }

    if (req.query.follow_up_overdue === 'true') {
      const today = new Date().toISOString().slice(0, 10);
      conditions.push(lte(gtdWaitingFor.followUpDate, today));
    }

    const items = await db.select().from(gtdWaitingFor)
      .where(and(...conditions))
      .orderBy(asc(gtdWaitingFor.followUpDate), desc(gtdWaitingFor.createdAt))
      .limit(limit)
      .offset(offset);

    const today = new Date().toISOString().slice(0, 10);
    const enriched = items.map(item => ({
      ...item,
      isOverdue: item.followUpDate ? item.followUpDate <= today : false,
    }));

    res.json({ success: true, data: enriched });
  }));

  app.post('/api/gtd/waiting', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const body = createWaitingSchema.parse(req.body);

    const [item] = await db.insert(gtdWaitingFor).values({
      storeId,
      ownerId: userId,
      waitingOn: body.waiting_on,
      waitingOnEmployeeId: body.waiting_on_employee_id || null,
      description: body.description,
      followUpDate: body.follow_up_date || null,
      projectId: body.project_id || null,
    }).returning();

    res.status(201).json({ success: true, data: item });
  }));

  app.put('/api/gtd/waiting/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(gtdWaitingFor).where(eq(gtdWaitingFor.id, id));
    if (!existing) throw new AppError(404, "Waiting-for item not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.ownerId !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    const body = updateWaitingSchema.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.waiting_on !== undefined) updateData.waitingOn = body.waiting_on;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.follow_up_date !== undefined) updateData.followUpDate = body.follow_up_date;
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === 'received') {
        updateData.receivedAt = new Date();
      }
    }

    const [updated] = await db.update(gtdWaitingFor)
      .set(updateData)
      .where(eq(gtdWaitingFor.id, id))
      .returning();

    res.json({ success: true, data: updated });
  }));

  // ── SOMEDAY / MAYBE ────────────────────────────────────

  app.get('/api/gtd/someday', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const { limit, offset } = parsePagination(req.query);
    const isManager = await isManagerOrOwner(storage, userId);

    const conditions = [eq(gtdSomedayMaybe.storeId, storeId)];

    if (!isManager) {
      conditions.push(eq(gtdSomedayMaybe.ownerId, userId));
    }

    if (req.query.category) conditions.push(eq(gtdSomedayMaybe.category, req.query.category));

    if (req.query.status) {
      conditions.push(eq(gtdSomedayMaybe.status, req.query.status));
    } else {
      conditions.push(eq(gtdSomedayMaybe.status, 'parked'));
    }

    const items = await db.select().from(gtdSomedayMaybe)
      .where(and(...conditions))
      .orderBy(desc(gtdSomedayMaybe.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: items });
  }));

  app.post('/api/gtd/someday', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const body = createSomedaySchema.parse(req.body);

    const [item] = await db.insert(gtdSomedayMaybe).values({
      storeId,
      ownerId: userId,
      title: body.title,
      description: body.description || null,
      category: body.category || null,
    }).returning();

    res.status(201).json({ success: true, data: item });
  }));

  app.put('/api/gtd/someday/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const storeId = await getStoreId();

    const [existing] = await db.select().from(gtdSomedayMaybe).where(eq(gtdSomedayMaybe.id, id));
    if (!existing) throw new AppError(404, "Someday/maybe item not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.ownerId !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    const body = updateSomedaySchema.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;

    if (body.activate_as) {
      let activatedId: string | null = null;

      if (body.activate_as === 'project') {
        const [project] = await db.insert(gtdProjects).values({
          storeId,
          ownerId: existing.ownerId,
          title: body.title || existing.title,
          description: body.description !== undefined ? body.description : existing.description,
        }).returning();
        activatedId = project.id;
      } else {
        const [action] = await db.insert(gtdNextActions).values({
          storeId,
          assignedTo: existing.ownerId,
          createdBy: userId,
          title: body.title || existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          sourceInboxItemId: existing.sourceInboxItemId,
        }).returning();
        activatedId = action.id;
      }

      updateData.status = 'activated';
      updateData.activatedIntoType = body.activate_as;
      updateData.activatedIntoId = activatedId;
    } else if (body.status !== undefined) {
      updateData.status = body.status;
    }

    const [updated] = await db.update(gtdSomedayMaybe)
      .set(updateData)
      .where(eq(gtdSomedayMaybe.id, id))
      .returning();

    res.json({ success: true, data: updated });
  }));

  // ── REFERENCE ──────────────────────────────────────────

  app.get('/api/gtd/reference', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const { limit, offset } = parsePagination(req.query);
    const isManager = await isManagerOrOwner(storage, userId);

    const conditions = [eq(gtdReference.storeId, storeId)];

    if (!isManager) {
      conditions.push(eq(gtdReference.ownerId, userId));
    }

    if (req.query.search) {
      const term = `%${req.query.search}%`;
      conditions.push(
        or(
          ilike(gtdReference.title, term),
          ilike(gtdReference.content, term),
        )!
      );
    }

    const items = await db.select().from(gtdReference)
      .where(and(...conditions))
      .orderBy(desc(gtdReference.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: items });
  }));

  app.post('/api/gtd/reference', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const body = createReferenceSchema.parse(req.body);

    const [item] = await db.insert(gtdReference).values({
      storeId,
      ownerId: userId,
      title: body.title,
      content: body.content,
      tags: body.tags,
    }).returning();

    res.status(201).json({ success: true, data: item });
  }));

  app.put('/api/gtd/reference/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(gtdReference).where(eq(gtdReference.id, id));
    if (!existing) throw new AppError(404, "Reference item not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.ownerId !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    const body = updateReferenceSchema.parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.tags !== undefined) updateData.tags = body.tags;

    const [updated] = await db.update(gtdReference)
      .set(updateData)
      .where(eq(gtdReference.id, id))
      .returning();

    res.json({ success: true, data: updated });
  }));

  app.delete('/api/gtd/reference/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(gtdReference).where(eq(gtdReference.id, id));
    if (!existing) throw new AppError(404, "Reference item not found", "NOT_FOUND");

    const isManager = await isManagerOrOwner(storage, userId);
    if (existing.ownerId !== userId && !isManager) {
      throw new AppError(403, "Not authorized", "FORBIDDEN");
    }

    await db.delete(gtdReference).where(eq(gtdReference.id, id));
    res.json({ success: true });
  }));

  // ── DASHBOARD ──────────────────────────────────────────

  app.get('/api/gtd/dashboard', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getStoreId();
    const today = new Date().toISOString().slice(0, 10);

    const [inboxResult] = await db.select({ count: count() }).from(gtdInboxItems)
      .where(and(
        eq(gtdInboxItems.storeId, storeId),
        eq(gtdInboxItems.capturedBy, userId),
        or(eq(gtdInboxItems.status, 'unprocessed'), eq(gtdInboxItems.status, 'clarified')),
      ));

    const [actionsTodayResult] = await db.select({ count: count() }).from(gtdNextActions)
      .where(and(
        eq(gtdNextActions.storeId, storeId),
        eq(gtdNextActions.assignedTo, userId),
        eq(gtdNextActions.status, 'active'),
        lte(gtdNextActions.dueDate, today),
      ));

    const [actionsOverdueResult] = await db.select({ count: count() }).from(gtdNextActions)
      .where(and(
        eq(gtdNextActions.storeId, storeId),
        eq(gtdNextActions.assignedTo, userId),
        eq(gtdNextActions.status, 'active'),
        lte(gtdNextActions.dueDate, sql`(CURRENT_DATE - INTERVAL '1 day')::date`),
      ));

    const [waitingOverdueResult] = await db.select({ count: count() }).from(gtdWaitingFor)
      .where(and(
        eq(gtdWaitingFor.storeId, storeId),
        eq(gtdWaitingFor.ownerId, userId),
        eq(gtdWaitingFor.status, 'waiting'),
        lte(gtdWaitingFor.followUpDate, today),
      ));

    const [projectsResult] = await db.select({ count: count() }).from(gtdProjects)
      .where(and(
        eq(gtdProjects.storeId, storeId),
        eq(gtdProjects.ownerId, userId),
        eq(gtdProjects.status, 'active'),
      ));

    const [twoMinResult] = await db.select({ count: count() }).from(gtdNextActions)
      .where(and(
        eq(gtdNextActions.storeId, storeId),
        eq(gtdNextActions.assignedTo, userId),
        eq(gtdNextActions.status, 'active'),
        eq(gtdNextActions.isTwoMinute, true),
      ));

    res.json({
      success: true,
      data: {
        inbox_count: inboxResult?.count || 0,
        actions_today_count: actionsTodayResult?.count || 0,
        actions_overdue_count: actionsOverdueResult?.count || 0,
        waiting_overdue_count: waitingOverdueResult?.count || 0,
        projects_active_count: projectsResult?.count || 0,
        two_minute_actions_count: twoMinResult?.count || 0,
      },
    });
  }));
}
