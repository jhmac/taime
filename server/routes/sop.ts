import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";
import {
  insertSopCategorySchema,
  insertSopDocumentSchema,
  insertTrainingModuleSchema,
  sopDocuments,
  sopCategories,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { tryResolveStoreIdForUser } from "../lib/storeResolver";

async function requireAdmin(storage: IStorage, userId: string): Promise<boolean> {
  const permissions = await storage.getUserPermissions(userId);
  return permissions.some(p => p.name === 'admin.manage_all');
}

export function registerSopRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/sop/categories', isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      const categories = await storage.getSopCategories(storeId ?? undefined);
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/sop/categories', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      const data = insertSopCategorySchema.parse({
        ...req.body,
        createdBy: req.user.id,
        ...(storeId ? { storeId } : {}),
      });
      const category = await storage.createSopCategory(data);
      res.json(category);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put('/api/sop/categories/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const updateSchema = z.object({
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      });
      const validated = updateSchema.parse(req.body);
      const category = await storage.updateSopCategory(req.params.id, validated);
      res.json(category);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/sop/categories/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      await storage.deleteSopCategory(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/sop/documents', isAuthenticated, async (req: any, res) => {
    try {
      const isAdmin = await requireAdmin(storage, req.user.id);
      const categoryId = req.query.categoryId as string | undefined;
      const documents = await storage.getSopDocuments(categoryId);
      if (isAdmin) {
        res.json(documents);
      } else {
        res.json(documents.filter(d => d.isPublished));
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/sop/documents/:id', isAuthenticated, async (req: any, res) => {
    try {
      const doc = await storage.getSopDocument(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      const isAdmin = await requireAdmin(storage, req.user.id);
      if (!isAdmin && !doc.isPublished) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/sop/documents', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const data = insertSopDocumentSchema.parse({
        ...req.body,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      });
      const doc = await storage.createSopDocument(data);
      res.json(doc);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put('/api/sop/documents/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const updateSchema = z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        summary: z.string().nullable().optional(),
        categoryId: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        isPublished: z.boolean().optional(),
      });
      const validated = updateSchema.parse(req.body);
      const doc = await storage.updateSopDocument(req.params.id, {
        ...validated,
        updatedBy: req.user.id,
      } as any);
      res.json(doc);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/sop/documents/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      await storage.deleteSopDocument(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/sop/search', isAuthenticated, async (req: any, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Search query required" });
      }
      const results = await storage.searchSopDocuments(query);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/training/modules', isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      const modules = await storage.getTrainingModules(storeId ?? undefined);
      res.json(modules.filter(m => m.isActive));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/training/modules', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      const data = insertTrainingModuleSchema.parse({
        ...req.body,
        createdBy: req.user.id,
        ...(storeId ? { storeId } : {}),
      });
      const module = await storage.createTrainingModule(data);
      res.json(module);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put('/api/training/modules/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const updateSchema = z.object({
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        sopDocumentIds: z.array(z.string()).optional(),
        quizQuestions: z.any().optional(),
        sortOrder: z.number().optional(),
        estimatedMinutes: z.number().optional(),
        isRequired: z.boolean().optional(),
        isActive: z.boolean().optional(),
      });
      const validated = updateSchema.parse(req.body);
      const module = await storage.updateTrainingModule(req.params.id, validated);
      res.json(module);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/training/modules/:id', isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireAdmin(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      await storage.deleteTrainingModule(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/training/progress', isAuthenticated, async (req: any, res) => {
    try {
      const queryUserId = req.query.userId as string | undefined;
      let userId = req.user.id;
      if (queryUserId && queryUserId !== req.user.id) {
        if (!(await requireAdmin(storage, req.user.id))) {
          return res.status(403).json({ message: "Admin access required to view other employees' progress" });
        }
        userId = queryUserId;
      }
      const progress = await storage.getEmployeeTrainingProgress(userId);
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/training/progress', isAuthenticated, async (req: any, res) => {
    try {
      const progressSchema = z.object({
        moduleId: z.string(),
        status: z.enum(['not_started', 'in_progress', 'completed']),
        quizScore: z.number().optional(),
      });
      const validated = progressSchema.parse(req.body);
      const progress = await storage.upsertEmployeeTrainingProgress({
        ...validated,
        userId: req.user.id,
        completedAt: validated.status === 'completed' ? new Date() : undefined,
      });
      res.json(progress);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get('/api/knowledge-base', isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      const q = req.query.q as string | undefined;
      const tag = req.query.tag as string | undefined;

      const [kbCat] = await db
        .select({ id: sopCategories.id })
        .from(sopCategories)
        .where(
          and(
            storeId ? eq(sopCategories.storeId, storeId) : undefined,
            eq(sopCategories.name, "Knowledge Base")
          )
        )
        .limit(1);

      if (!kbCat) {
        return res.json({ success: true, data: [], tags: [] });
      }

      const searchTerm = q ? q.trim() : "";
      const whereClause = and(
        eq(sopDocuments.categoryId, kbCat.id),
        eq(sopDocuments.isPublished, true),
        searchTerm
          ? or(
              ilike(sopDocuments.title, `%${searchTerm}%`),
              ilike(sopDocuments.summary, `%${searchTerm}%`),
              ilike(sopDocuments.content, `%${searchTerm}%`)
            )
          : undefined
      );

      const articles = await db
        .select({
          id: sopDocuments.id,
          title: sopDocuments.title,
          summary: sopDocuments.summary,
          content: sopDocuments.content,
          tags: sopDocuments.tags,
          source: sopDocuments.source,
          updatedAt: sopDocuments.updatedAt,
          createdAt: sopDocuments.createdAt,
        })
        .from(sopDocuments)
        .where(whereClause)
        .orderBy(desc(sopDocuments.updatedAt))
        .limit(100);

      const filtered = tag
        ? articles.filter(a => Array.isArray(a.tags) && a.tags.includes(tag))
        : articles;

      const allTags = Array.from(
        new Set(
          articles.flatMap(a =>
            (Array.isArray(a.tags) ? a.tags : []).filter(
              t => t !== "ai-generated" && t !== "knowledge-base"
            )
          )
        )
      ).sort();

      res.json({ success: true, data: filtered, tags: allTags });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/knowledge-base/:id', isAuthenticated, async (req: any, res) => {
    try {
      const storeId = await tryResolveStoreIdForUser(req.user.id);
      const { id } = req.params;

      const [article] = await db
        .select({
          doc: sopDocuments,
          catStoreId: sopCategories.storeId,
        })
        .from(sopDocuments)
        .innerJoin(sopCategories, eq(sopDocuments.categoryId, sopCategories.id))
        .where(and(eq(sopDocuments.id, id), eq(sopDocuments.isPublished, true)))
        .limit(1);

      if (!article) return res.status(404).json({ success: false, message: "Article not found" });
      if (storeId && article.catStoreId && article.catStoreId !== storeId) {
        return res.status(404).json({ success: false, message: "Article not found" });
      }

      res.json({ success: true, data: article.doc });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
}
