import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, desc, asc, sql, ilike, or, gte, lte, count } from "drizzle-orm";
import { sopTemplates, sopSteps, sopExecutions, sopStepCompletions, gtdInboxItems, workLocations } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";
import type { IStorage } from "../storage";
import { generateSOPFromDescription } from "../services/sopAI";
import { getSurfacedSOPsForEmployee } from "../services/sopSurfacing";
import { triggerClarification } from "../services/gtdClarificationAI";
import { indexSOPTemplate } from "../services/sopIndexer";
import logger from "../lib/logger";

const stepSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  stepType: z.enum(["action", "verification", "photo", "decision", "timer"]),
  isCheckpoint: z.boolean().optional().default(false),
  timerDurationSeconds: z.number().int().min(1).nullable().optional(),
  decisionOptions: z.object({
    question: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      nextStepOrder: z.number().int(),
      color: z.enum(["green", "yellow", "red", "blue", "gray"]).optional(),
    })).min(2).max(5),
  }).nullable().optional(),
  trainingDetail: z.string().nullable().optional(),
  trainingVideoUrl: z.string().nullable().optional(),
  trainingPhotoUrls: z.array(z.string()).nullable().optional(),
  trainingVideoThumbnail: z.string().nullable().optional(),
});

const createTemplateSchema = z.object({
  storeId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  category: z.enum(["opening", "closing", "customer_service", "visual_merchandising", "inventory", "safety", "shift_handoff", "custom"]),
  estimatedDurationMinutes: z.number().int().min(1).nullable().optional(),
  roleAssignments: z.array(z.string()).nullable().optional(),
  trainingNotes: z.string().nullable().optional(),
  walkthroughVideoUrl: z.string().nullable().optional(),
  isTrainingPriority: z.boolean().optional().default(false),
  steps: z.array(stepSchema).min(1, "At least one step is required"),
});

const updateExecutionStatusSchema = z.object({
  status: z.enum(["completed", "abandoned", "paused"]),
  notes: z.string().nullable().optional(),
});

const completeStepSchema = z.object({
  status: z.enum(["completed", "skipped"]),
  skipReason: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  timeSpentSeconds: z.number().int().min(0).nullable().optional(),
  decisionChoice: z.object({
    label: z.string(),
    targetStepOrder: z.number().int(),
  }).nullable().optional(),
});

async function requireAdminOrOwner(storage: IStorage, userId: string): Promise<void> {
  const perms = await storage.getUserPermissions(userId);
  if (!perms.some(p => p.name === "admin.manage_all")) {
    throw new AppError(403, "Admin or Owner access required", "FORBIDDEN");
  }
}

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const perms = await storage.getUserPermissions(userId);
  return perms.some(p =>
    p.name === "admin.manage_all" ||
    p.name === "admin.role_management" ||
    p.name === "admin.manage_payroll"
  );
}

export function registerSopLibraryRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: Record<string, unknown>) => void
) {
  app.post("/api/sops/templates/ai-generate", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireAdminOrOwner(storage, req.user.id);
    const body = z.object({
      description: z.string().min(10, "Description must be at least 10 characters").max(2000, "Description must be under 2000 characters"),
      storeId: z.string().min(1),
      storeName: z.string().optional(),
    }).parse(req.body);

    const generated = await generateSOPFromDescription(body.description, body.storeId, {
      storeName: body.storeName,
    });

    res.json({ success: true, data: { generated_sop: generated } });
  }));

  app.post("/api/sops/templates", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireAdminOrOwner(storage, req.user.id);
    const body = createTemplateSchema.parse(req.body);

    const result = await db.transaction(async (tx) => {
      const [template] = await tx.insert(sopTemplates).values({
        storeId: body.storeId,
        title: body.title,
        description: body.description ?? null,
        category: body.category,
        estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
        roleAssignments: body.roleAssignments ?? null,
        trainingNotes: body.trainingNotes ?? null,
        walkthroughVideoUrl: body.walkthroughVideoUrl ?? null,
        isTrainingPriority: body.isTrainingPriority ?? false,
        createdBy: req.user.id,
      }).returning();

      const stepsToInsert = body.steps.map((s, i) => ({
        templateId: template.id,
        stepOrder: i + 1,
        title: s.title,
        description: s.description ?? null,
        stepType: s.stepType,
        isCheckpoint: s.isCheckpoint ?? false,
        timerDurationSeconds: s.timerDurationSeconds ?? null,
        decisionOptions: s.decisionOptions ?? null,
        trainingDetail: s.trainingDetail ?? null,
        trainingVideoUrl: s.trainingVideoUrl ?? null,
        trainingPhotoUrls: s.trainingPhotoUrls ?? [],
        trainingVideoThumbnail: s.trainingVideoThumbnail ?? null,
      }));

      const steps = await tx.insert(sopSteps).values(stepsToInsert).returning();

      return { ...template, steps };
    });

    await storage.createActivityLog({
      userId: req.user.id,
      action: "create",
      targetType: "sop_template",
      targetId: result.id,
      details: `Created SOP template: ${result.title}`,
    });

    setImmediate(() => {
      indexSOPTemplate(result.id).catch(err =>
        logger.warn({ error: err.message, templateId: result.id }, "[SOPIndexer] Background index failed")
      );
    });

    res.status(201).json({ success: true, data: result });
  }));

  app.get("/api/sops/templates", isAuthenticated, asyncHandler(async (req: any, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const category = req.query.category as string | undefined;
    const isActive = req.query.is_active !== "false";
    const search = req.query.search as string | undefined;

    const storeId = await tryResolveStoreIdForUser(req.user.id);

    const conditions = [eq(sopTemplates.isActive, isActive)];
    if (storeId) conditions.push(eq(sopTemplates.storeId, storeId));
    if (category) conditions.push(eq(sopTemplates.category, category));
    if (search) {
      conditions.push(
        or(
          ilike(sopTemplates.title, `%${search}%`),
          ilike(sopTemplates.description, `%${search}%`)
        )!
      );
    }

    const where = and(...conditions);

    const [templates, [{ total }]] = await Promise.all([
      db.select({
        id: sopTemplates.id,
        storeId: sopTemplates.storeId,
        title: sopTemplates.title,
        description: sopTemplates.description,
        category: sopTemplates.category,
        estimatedDurationMinutes: sopTemplates.estimatedDurationMinutes,
        roleAssignments: sopTemplates.roleAssignments,
        isActive: sopTemplates.isActive,
        trainingNotes: sopTemplates.trainingNotes,
        walkthroughVideoUrl: sopTemplates.walkthroughVideoUrl,
        isTrainingPriority: sopTemplates.isTrainingPriority,
        version: sopTemplates.version,
        parentTemplateId: sopTemplates.parentTemplateId,
        createdBy: sopTemplates.createdBy,
        createdAt: sopTemplates.createdAt,
        updatedAt: sopTemplates.updatedAt,
        stepCount: sql<number>`(SELECT count(*) FROM sop_steps WHERE template_id = ${sopTemplates.id})::int`,
      })
        .from(sopTemplates)
        .where(where)
        .orderBy(desc(sopTemplates.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(sopTemplates).where(where),
    ]);

    res.json({ success: true, data: templates, pagination: { total, limit, offset } });
  }));

  app.get("/api/sops/templates/training-priority", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await tryResolveStoreIdForUser(req.user.id);

    const trainingPriorityConditions = [
      eq(sopTemplates.isActive, true),
      eq(sopTemplates.isTrainingPriority, true),
    ];
    if (storeId) trainingPriorityConditions.push(eq(sopTemplates.storeId, storeId));

    const templates = await db.select({
      id: sopTemplates.id,
      storeId: sopTemplates.storeId,
      title: sopTemplates.title,
      description: sopTemplates.description,
      category: sopTemplates.category,
      estimatedDurationMinutes: sopTemplates.estimatedDurationMinutes,
      roleAssignments: sopTemplates.roleAssignments,
      isActive: sopTemplates.isActive,
      walkthroughVideoUrl: sopTemplates.walkthroughVideoUrl,
      isTrainingPriority: sopTemplates.isTrainingPriority,
      createdAt: sopTemplates.createdAt,
      stepCount: sql<number>`(SELECT count(*) FROM sop_steps WHERE template_id = ${sopTemplates.id})::int`,
    })
      .from(sopTemplates)
      .where(and(...trainingPriorityConditions))
      .orderBy(desc(sopTemplates.createdAt));

    const employeeId = req.user.id;
    const executions = await db.select({
      templateId: sopExecutions.templateId,
      completionCount: count(),
    })
      .from(sopExecutions)
      .where(and(
        eq(sopExecutions.employeeId, employeeId),
        eq(sopExecutions.status, "completed"),
      ))
      .groupBy(sopExecutions.templateId);

    const execMap = new Map(executions.map(e => [e.templateId, e.completionCount]));
    const enriched = templates.map(t => ({
      ...t,
      completionCount: execMap.get(t.id) ?? 0,
      mastery: (() => {
        const c = execMap.get(t.id) ?? 0;
        if (c >= 3) return "mastered" as const;
        if (c >= 1) return "practicing" as const;
        return "beginner" as const;
      })(),
    }));

    res.json({ success: true, data: enriched });
  }));

  app.get("/api/sops/templates/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
    if (!template) throw new AppError(404, "Template not found", "NOT_FOUND");

    const steps = await db.select().from(sopSteps)
      .where(eq(sopSteps.templateId, id))
      .orderBy(asc(sopSteps.stepOrder));

    const [stats] = await db.select({
      totalExecutions: count(),
      avgCompletionSeconds: sql<number>`avg(extract(epoch from (completed_at - started_at)))::int`,
      lastExecutedAt: sql<string>`max(started_at)`,
    }).from(sopExecutions).where(eq(sopExecutions.templateId, id));

    res.json({
      success: true,
      data: {
        ...template,
        steps,
        stats: {
          totalExecutions: stats?.totalExecutions ?? 0,
          avgCompletionSeconds: stats?.avgCompletionSeconds ?? null,
          lastExecutedAt: stats?.lastExecutedAt ?? null,
        },
      },
    });
  }));

  app.put("/api/sops/templates/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireAdminOrOwner(storage, req.user.id);
    const { id } = req.params;
    const body = createTemplateSchema.parse(req.body);

    const [existing] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
    if (!existing) throw new AppError(404, "Template not found", "NOT_FOUND");

    const result = await db.transaction(async (tx) => {
      await tx.update(sopTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(sopTemplates.id, id));

      const [newTemplate] = await tx.insert(sopTemplates).values({
        storeId: body.storeId,
        title: body.title,
        description: body.description ?? null,
        category: body.category,
        estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
        roleAssignments: body.roleAssignments ?? null,
        trainingNotes: body.trainingNotes ?? null,
        walkthroughVideoUrl: body.walkthroughVideoUrl ?? null,
        isTrainingPriority: body.isTrainingPriority ?? false,
        version: existing.version + 1,
        parentTemplateId: id,
        createdBy: req.user.id,
      }).returning();

      const stepsToInsert = body.steps.map((s, i) => ({
        templateId: newTemplate.id,
        stepOrder: i + 1,
        title: s.title,
        description: s.description ?? null,
        stepType: s.stepType,
        isCheckpoint: s.isCheckpoint ?? false,
        timerDurationSeconds: s.timerDurationSeconds ?? null,
        decisionOptions: s.decisionOptions ?? null,
        trainingDetail: s.trainingDetail ?? null,
        trainingVideoUrl: s.trainingVideoUrl ?? null,
        trainingPhotoUrls: s.trainingPhotoUrls ?? [],
        trainingVideoThumbnail: s.trainingVideoThumbnail ?? null,
      }));

      const steps = await tx.insert(sopSteps).values(stepsToInsert).returning();
      return { ...newTemplate, steps };
    });

    await storage.createActivityLog({
      userId: req.user.id,
      action: "update",
      targetType: "sop_template",
      targetId: result.id,
      details: `Updated SOP template to v${result.version}: ${result.title}`,
    });

    setImmediate(() => {
      indexSOPTemplate(result.id).catch(err =>
        logger.warn({ error: err.message, templateId: result.id }, "[SOPIndexer] Background index failed")
      );
    });

    res.json({ success: true, data: result });
  }));

  app.delete("/api/sops/templates/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireAdminOrOwner(storage, req.user.id);
    const { id } = req.params;
    const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
    if (!template) throw new AppError(404, "Template not found", "NOT_FOUND");

    await db.update(sopTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(sopTemplates.id, id));

    await storage.createActivityLog({
      userId: req.user.id,
      action: "delete",
      targetType: "sop_template",
      targetId: id,
      details: `Deactivated SOP template: ${template.title}`,
    });

    res.json({ success: true, data: { id } });
  }));

  app.put("/api/sops/templates/:id/steps/:stepId/media", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireAdminOrOwner(storage, req.user.id);
    const { id, stepId } = req.params;
    const body = z.object({
      trainingVideoUrl: z.string().nullable().optional(),
      trainingPhotoUrls: z.array(z.string()).nullable().optional(),
      trainingVideoThumbnail: z.string().nullable().optional(),
    }).parse(req.body);

    const [step] = await db.select().from(sopSteps)
      .where(and(eq(sopSteps.id, stepId), eq(sopSteps.templateId, id)));
    if (!step) throw new AppError(404, "Step not found", "NOT_FOUND");

    const updates: Record<string, any> = {};
    if (body.trainingVideoUrl !== undefined) updates.trainingVideoUrl = body.trainingVideoUrl;
    if (body.trainingPhotoUrls !== undefined) updates.trainingPhotoUrls = body.trainingPhotoUrls ?? [];
    if (body.trainingVideoThumbnail !== undefined) updates.trainingVideoThumbnail = body.trainingVideoThumbnail;

    if (Object.keys(updates).length === 0) {
      throw new AppError(400, "No media fields to update", "NO_UPDATES");
    }

    const [updated] = await db.update(sopSteps)
      .set(updates)
      .where(eq(sopSteps.id, stepId))
      .returning();

    res.json({ success: true, data: updated });
  }));

  app.get("/api/sops/templates/:id/flow", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, id));
    if (!template) throw new AppError(404, "Template not found", "NOT_FOUND");

    const templateSteps = await db.select().from(sopSteps)
      .where(eq(sopSteps.templateId, id))
      .orderBy(asc(sopSteps.stepOrder));

    const nodes = templateSteps.map(s => ({
      id: s.id,
      stepOrder: s.stepOrder,
      title: s.title,
      stepType: s.stepType,
      isDecision: s.stepType === 'decision',
      decisionQuestion: (s.decisionOptions as any)?.question || null,
    }));

    const edges: { from: number; to: number; label?: string; color?: string }[] = [];
    for (const s of templateSteps) {
      if (s.stepType === 'decision' && s.decisionOptions) {
        const opts = (s.decisionOptions as any).options || [];
        for (const opt of opts) {
          edges.push({
            from: s.stepOrder,
            to: opt.nextStepOrder,
            label: opt.label,
            color: opt.color || undefined,
          });
        }
      } else {
        const nextOrder = s.stepOrder + 1;
        if (templateSteps.some(ns => ns.stepOrder === nextOrder)) {
          edges.push({ from: s.stepOrder, to: nextOrder });
        }
      }
    }

    res.json({ success: true, data: { templateId: id, templateTitle: template.title, nodes, edges } });
  }));

  app.get("/api/sops/executions/completion-count", isAuthenticated, asyncHandler(async (req: any, res) => {
    const templateId = req.query.templateId as string;
    if (!templateId) throw new AppError(400, "templateId required", "MISSING_PARAM");

    const [result] = await db.select({
      count: count(),
    }).from(sopExecutions).where(
      and(
        eq(sopExecutions.templateId, templateId),
        eq(sopExecutions.employeeId, req.user.id),
        eq(sopExecutions.status, "completed"),
      )
    );

    res.json({ success: true, data: { count: result?.count ?? 0 } });
  }));

  app.post("/api/sops/executions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const body = z.object({ templateId: z.string().min(1) }).parse(req.body);
    const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, body.templateId));
    if (!template) throw new AppError(404, "Template not found", "NOT_FOUND");
    if (!template.isActive) throw new AppError(400, "Template is no longer active", "TEMPLATE_INACTIVE");

    const steps = await db.select().from(sopSteps)
      .where(eq(sopSteps.templateId, body.templateId))
      .orderBy(asc(sopSteps.stepOrder));

    if (steps.length === 0) throw new AppError(400, "Template has no steps", "NO_STEPS");

    const result = await db.transaction(async (tx) => {
      const [execution] = await tx.insert(sopExecutions).values({
        templateId: body.templateId,
        employeeId: req.user.id,
        storeId: template.storeId,
      }).returning();

      const completions = await tx.insert(sopStepCompletions).values(
        steps.map(step => ({
          executionId: execution.id,
          stepId: step.id,
          status: "pending",
        }))
      ).returning();

      return { ...execution, stepCompletions: completions };
    });

    await storage.createActivityLog({
      userId: req.user.id,
      action: "create",
      targetType: "sop_execution",
      targetId: result.id,
      details: `Started SOP: ${template.title}`,
    });

    broadcastToAll({ type: "execution_started", data: { executionId: result.id, templateTitle: template.title, employeeId: req.user.id } });
    res.status(201).json({ success: true, data: result });
  }));

  app.put("/api/sops/executions/:id/steps/:stepId", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id, stepId } = req.params;
    const body = completeStepSchema.parse(req.body);

    if (body.status === "skipped" && !body.skipReason) {
      throw new AppError(400, "Skip reason is required when skipping a step", "VALIDATION_ERROR");
    }

    const [execution] = await db.select().from(sopExecutions).where(eq(sopExecutions.id, id));
    if (!execution) throw new AppError(404, "Execution not found", "NOT_FOUND");

    if (execution.employeeId !== req.user.id) {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) throw new AppError(403, "Only the assigned employee or a manager can update steps", "FORBIDDEN");
    }

    if (execution.status !== "in_progress") {
      throw new AppError(400, `Cannot update steps on a ${execution.status} execution`, "INVALID_STATE");
    }

    const [step] = await db.select().from(sopSteps).where(eq(sopSteps.id, stepId));
    if (!step) throw new AppError(404, "Step not found", "NOT_FOUND");

    const [completion] = await db.select().from(sopStepCompletions)
      .where(and(eq(sopStepCompletions.executionId, id), eq(sopStepCompletions.stepId, stepId)));
    if (!completion) throw new AppError(404, "Step completion record not found", "NOT_FOUND");

    const updateData: Record<string, unknown> = {
      status: body.status,
      completedAt: new Date(),
      timeSpentSeconds: body.timeSpentSeconds ?? null,
      skipReason: body.skipReason ?? null,
      photoUrl: body.photoUrl ?? null,
      notes: body.notes ?? null,
    };

    if (step.isCheckpoint && body.status === "completed") {
      updateData.managerSignOff = false;
      broadcastToAll({
        type: "sign_off_requested",
        data: { executionId: id, stepId, stepTitle: step.title, employeeId: execution.employeeId },
      });
    }

    if (body.decisionChoice && step.stepType === "decision") {
      const currentBranch = (execution.branchPath as any[]) || [];
      const newBranch = [...currentBranch, {
        stepId,
        choice: body.decisionChoice.label,
        targetStepOrder: body.decisionChoice.targetStepOrder,
      }];
      await db.update(sopExecutions)
        .set({ branchPath: newBranch })
        .where(eq(sopExecutions.id, id));
    }

    await db.update(sopStepCompletions)
      .set(updateData)
      .where(eq(sopStepCompletions.id, completion.id));

    const allSteps = await db.select().from(sopSteps)
      .where(eq(sopSteps.templateId, execution.templateId))
      .orderBy(asc(sopSteps.stepOrder));

    const allCompletions = await db.select().from(sopStepCompletions)
      .where(eq(sopStepCompletions.executionId, id));

    const updatedExec = await db.select().from(sopExecutions).where(eq(sopExecutions.id, id)).then(r => r[0]);
    const branchChoices = (updatedExec?.branchPath as any[]) || [];

    const reachableStepIds = new Set<string>();
    const maxOrder = Math.max(...allSteps.map(s => s.stepOrder), 0);
    let currentOrder = 1;
    const stepByOrder = new Map(allSteps.map(s => [s.stepOrder, s]));
    const visitedOrders = new Set<number>();

    while (currentOrder <= maxOrder && !visitedOrders.has(currentOrder)) {
      visitedOrders.add(currentOrder);
      const s = stepByOrder.get(currentOrder);
      if (!s) break;
      reachableStepIds.add(s.id);

      if (s.stepType === "decision") {
        const choice = branchChoices.find((b: any) => b.stepId === s.id);
        if (choice) {
          currentOrder = choice.targetStepOrder;
        } else {
          break;
        }
      } else {
        currentOrder++;
      }
    }

    const allDone = allCompletions
      .filter(c => reachableStepIds.has(c.stepId))
      .every(c =>
        c.id === completion.id
          ? (body.status === "completed" || body.status === "skipped")
          : (c.status === "completed" || c.status === "skipped")
      ) && reachableStepIds.size > 0;

    if (allDone) {
      await db.update(sopExecutions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(sopExecutions.id, id));

      await storage.createActivityLog({
        userId: execution.employeeId,
        action: "update",
        targetType: "sop_execution",
        targetId: id,
        details: "SOP execution completed (all steps done)",
      });

      broadcastToAll({ type: "execution_completed", data: { executionId: id, employeeId: execution.employeeId } });
    }

    broadcastToAll({ type: "step_completed", data: { executionId: id, stepId, status: body.status } });

    const [updated] = await db.select().from(sopStepCompletions).where(eq(sopStepCompletions.id, completion.id));
    res.json({ success: true, data: { stepCompletion: updated, executionCompleted: allDone } });
  }));

  app.put("/api/sops/executions/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const body = updateExecutionStatusSchema.parse(req.body);

    const [execution] = await db.select().from(sopExecutions).where(eq(sopExecutions.id, id));
    if (!execution) throw new AppError(404, "Execution not found", "NOT_FOUND");

    if (execution.employeeId !== req.user.id) {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) throw new AppError(403, "Only the assigned employee or a manager can update this execution", "FORBIDDEN");
    }

    const updateData: Record<string, unknown> = { status: body.status };
    if (body.notes) updateData.notes = body.notes;
    if (body.status === "completed" || body.status === "abandoned") {
      updateData.completedAt = new Date();
    }

    const [updated] = await db.update(sopExecutions)
      .set(updateData)
      .where(eq(sopExecutions.id, id))
      .returning();

    await storage.createActivityLog({
      userId: req.user.id,
      action: "update",
      targetType: "sop_execution",
      targetId: id,
      details: `SOP execution ${body.status}`,
    });

    if (body.status === "completed") {
      broadcastToAll({ type: "execution_completed", data: { executionId: id, employeeId: execution.employeeId } });
    }

    if (body.notes && body.notes.trim().length > 0) {
      try {
        const [template] = await db.select({ title: sopTemplates.title }).from(sopTemplates).where(eq(sopTemplates.id, execution.templateId));
        const sopTitle = template?.title || 'SOP';
        const rawInput = `[SOP Feedback on "${sopTitle}"] ${body.notes}`;

        const [inboxItem] = await db.insert(gtdInboxItems).values({
          storeId: execution.storeId,
          capturedBy: req.user.id,
          rawInput,
          source: 'sop_feedback',
          status: 'unprocessed',
        }).returning();

        const user = await storage.getUserWithRole(req.user.id);
        const empName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
        const empRole = user?.role?.name || 'employee';

        triggerClarification(inboxItem.id, inboxItem.rawInput, execution.storeId, empName, empRole, broadcastToAll)
          .catch(err => logger.error({ error: err.message, itemId: inboxItem.id }, 'GTD SOP feedback clarification failed'));
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to create GTD inbox item from SOP feedback');
      }
    }

    res.json({ success: true, data: updated });
  }));

  app.get("/api/sops/executions/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const [execution] = await db.select().from(sopExecutions).where(eq(sopExecutions.id, id));
    if (!execution) throw new AppError(404, "Execution not found", "NOT_FOUND");

    if (execution.employeeId !== req.user.id) {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) throw new AppError(403, "Access denied", "FORBIDDEN");
    }

    const [template] = await db.select().from(sopTemplates).where(eq(sopTemplates.id, execution.templateId));
    const steps = await db.select().from(sopSteps)
      .where(eq(sopSteps.templateId, execution.templateId))
      .orderBy(asc(sopSteps.stepOrder));

    const stepCompletions = await db.select().from(sopStepCompletions)
      .where(eq(sopStepCompletions.executionId, id));

    res.json({
      success: true,
      data: {
        ...execution,
        template: template ?? null,
        steps,
        stepCompletions,
      },
    });
  }));

  app.get("/api/sops/executions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const isManager = await requireManagerOrAbove(storage, req.user.id);

    const conditions: ReturnType<typeof eq>[] = [];

    if (!isManager) {
      conditions.push(eq(sopExecutions.employeeId, req.user.id));
    } else if (req.query.employee_id) {
      conditions.push(eq(sopExecutions.employeeId, req.query.employee_id as string));
    }

    if (req.query.template_id) {
      conditions.push(eq(sopExecutions.templateId, req.query.template_id as string));
    }
    if (req.query.status) {
      conditions.push(eq(sopExecutions.status, req.query.status as string));
    }
    if (req.query.date_from) {
      conditions.push(gte(sopExecutions.startedAt, new Date(req.query.date_from as string)));
    }
    if (req.query.date_to) {
      conditions.push(lte(sopExecutions.startedAt, new Date(req.query.date_to as string)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [executions, [{ total }]] = await Promise.all([
      db.select().from(sopExecutions)
        .where(where)
        .orderBy(desc(sopExecutions.startedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(sopExecutions).where(where),
    ]);

    res.json({ success: true, data: executions, pagination: { total, limit, offset } });
  }));

  app.post("/api/sops/templates/:id/sign-off/:stepCompletionId", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or Owner access required for sign-off", "FORBIDDEN");

    const { id, stepCompletionId } = req.params;

    const [completion] = await db.select().from(sopStepCompletions)
      .where(eq(sopStepCompletions.id, stepCompletionId));
    if (!completion) throw new AppError(404, "Step completion not found", "NOT_FOUND");

    const [execution] = await db.select().from(sopExecutions)
      .where(eq(sopExecutions.id, completion.executionId));
    if (!execution || execution.templateId !== id) {
      throw new AppError(404, "Execution not found for this template", "NOT_FOUND");
    }

    const [updated] = await db.update(sopStepCompletions)
      .set({
        managerSignOff: true,
        managerSignOffBy: req.user.id,
        managerSignOffAt: new Date(),
      })
      .where(eq(sopStepCompletions.id, stepCompletionId))
      .returning();

    broadcastToAll({
      type: "sign_off_completed",
      data: { executionId: execution.id, stepCompletionId, managerId: req.user.id },
    });

    res.json({ success: true, data: updated });
  }));

  app.get("/api/sops/surfaced", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = req.query.storeId as string | undefined;

    const surfaced = await getSurfacedSOPsForEmployee(userId, storeId);

    logger.info(
      { userId, sopCount: surfaced.length, templates: surfaced.map((s) => s.templateId) },
      "SOP surfacing: API request"
    );

    res.json(surfaced);
  }));
}
