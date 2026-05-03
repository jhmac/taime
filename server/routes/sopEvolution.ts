import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { sopRevisionProposals, sopTemplates, sopInsights, dailyDebriefs } from "@shared/schema";
import { generateRevisionProposals } from "../services/sopEvolution";
import type { IStorage } from "../storage";
import { z } from "zod";
import { resolveStoreId } from "../services/storeResolver";
import { asyncHandler, AppError } from "../lib/routeWrapper";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
  const roleName = user.role?.name;
  return roleName === "admin" || roleName === "owner" || roleName === "manager";
}

async function requireOwnerOrAdmin(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
  const roleName = user.role?.name;
  return roleName === "admin" || roleName === "owner";
}

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  review_notes: z.string().optional(),
});

const employeeSuggestionSchema = z.object({
  sop_template_id: z.string().min(1, "Please choose an SOP"),
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(120),
  description: z.string().trim().min(10, "Please describe your suggestion (at least 10 characters)").max(2000),
});

export function registerSOPEvolutionRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/sops/revisions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or owner access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const { status, sop_template_id } = req.query;
    const filterStatus = (status as string) || "pending";

    const conditions = [
      eq(sopRevisionProposals.storeId, storeId),
      eq(sopRevisionProposals.status, filterStatus),
    ];

    if (sop_template_id) {
      conditions.push(eq(sopRevisionProposals.sopTemplateId, sop_template_id as string));
    }

    const proposals = await db.select({
      proposal: sopRevisionProposals,
      sopTitle: sopTemplates.title,
      sopCategory: sopTemplates.category,
    })
      .from(sopRevisionProposals)
      .leftJoin(sopTemplates, eq(sopRevisionProposals.sopTemplateId, sopTemplates.id))
      .where(and(...conditions))
      .orderBy(desc(sopRevisionProposals.createdAt));

    const enriched = proposals.map(p => ({
      ...p.proposal,
      sopTitle: p.sopTitle,
      sopCategory: p.sopCategory,
    }));

    res.json(enriched);
  }));

  app.put("/api/sops/revisions/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isOwner = await requireOwnerOrAdmin(storage, req.user.id);
    if (!isOwner) throw new AppError(403, "Owner or admin access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request", "VALIDATION_ERROR", parsed.error.errors);

    const { id } = req.params;
    const { status, review_notes } = parsed.data;

    const updated = await db.update(sopRevisionProposals)
      .set({
        status,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        reviewNotes: review_notes || null,
      })
      .where(and(
        eq(sopRevisionProposals.id, id),
        eq(sopRevisionProposals.storeId, storeId),
        eq(sopRevisionProposals.status, "pending"),
      ))
      .returning();

    if (updated.length === 0) throw new AppError(404, "Proposal not found or already reviewed", "NOT_FOUND");

    res.json(updated[0]);
  }));

  app.get("/api/sops/revisions/stats", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isManager = await requireManagerOrAbove(storage, req.user.id);
    if (!isManager) throw new AppError(403, "Manager or owner access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const result = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(sopRevisionProposals)
      .where(and(
        eq(sopRevisionProposals.storeId, storeId),
        eq(sopRevisionProposals.status, "pending"),
      ));

    const sopCount = await db.selectDistinct({ id: sopRevisionProposals.sopTemplateId })
      .from(sopRevisionProposals)
      .where(and(
        eq(sopRevisionProposals.storeId, storeId),
        eq(sopRevisionProposals.status, "pending"),
      ));

    res.json({
      pendingCount: result[0]?.count || 0,
      affectedSOPs: sopCount.length,
    });
  }));

  app.post("/api/sops/revisions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const parsed = employeeSuggestionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid request", "VALIDATION_ERROR", parsed.error.errors);

    const { sop_template_id, title, description } = parsed.data;

    const template = await db.select({ id: sopTemplates.id })
      .from(sopTemplates)
      .where(and(eq(sopTemplates.id, sop_template_id), eq(sopTemplates.storeId, storeId)))
      .limit(1);
    if (template.length === 0) throw new AppError(404, "SOP not found", "NOT_FOUND");

    const inserted = await db.insert(sopRevisionProposals).values({
      storeId,
      sopTemplateId: sop_template_id,
      sourceType: "employee_suggestion",
      sourceIds: [req.user.id],
      proposalType: "general",
      title,
      description,
      status: "pending",
    }).returning();

    res.status(201).json(inserted[0]);
  }));

  app.post("/api/sops/revisions/generate", isAuthenticated, asyncHandler(async (req: any, res) => {
    const isOwner = await requireOwnerOrAdmin(storage, req.user.id);
    if (!isOwner) throw new AppError(403, "Owner or admin access required", "FORBIDDEN");

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const count = await generateRevisionProposals(storeId);
    res.json({ message: `Generated ${count} revision proposals`, count });
  }));
}
