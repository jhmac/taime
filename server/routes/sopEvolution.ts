import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { sopRevisionProposals, sopTemplates, sopInsights, dailyDebriefs } from "@shared/schema";
import { generateRevisionProposals } from "../services/sopEvolution";
import type { IStorage } from "../storage";
import logger from "../lib/logger";
import { z } from "zod";
import { resolveStoreId } from "../lib/storeResolver";

async function requireManagerOrAbove(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");
  return user.role === "admin" || user.role === "owner" || user.role === "manager";
}

async function requireOwnerOrAdmin(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");
  return user.role === "admin" || user.role === "owner";
}

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  review_notes: z.string().optional(),
});

export function registerSOPEvolutionRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/sops/revisions", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) return res.status(403).json({ message: "Manager or owner access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

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
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPEvolution] Error fetching revisions");
      res.status(500).json({ message: "Failed to load revision proposals" });
    }
  });

  app.put("/api/sops/revisions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const isOwner = await requireOwnerOrAdmin(storage, req.user.id);
      if (!isOwner) return res.status(403).json({ message: "Owner or admin access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });

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

      if (updated.length === 0) return res.status(404).json({ message: "Proposal not found or already reviewed" });

      res.json(updated[0]);
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPEvolution] Error reviewing proposal");
      res.status(500).json({ message: "Failed to review proposal" });
    }
  });

  app.get("/api/sops/revisions/stats", isAuthenticated, async (req: any, res) => {
    try {
      const isManager = await requireManagerOrAbove(storage, req.user.id);
      if (!isManager) return res.status(403).json({ message: "Manager or owner access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

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
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPEvolution] Error fetching stats");
      res.status(500).json({ message: "Failed to load stats" });
    }
  });

  app.post("/api/sops/revisions/generate", isAuthenticated, async (req: any, res) => {
    try {
      const isOwner = await requireOwnerOrAdmin(storage, req.user.id);
      if (!isOwner) return res.status(403).json({ message: "Owner or admin access required" });

      const storeId = await resolveStoreId();
      if (!storeId) return res.status(400).json({ message: "No store configured" });

      const count = await generateRevisionProposals(storeId);
      res.json({ message: `Generated ${count} revision proposals`, count });
    } catch (error: any) {
      logger.error({ error: error.message }, "[SOPEvolution] Error generating proposals");
      res.status(500).json({ message: "Failed to generate proposals" });
    }
  });
}
