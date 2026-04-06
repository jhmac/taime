import type { Express } from "express";
import { indexSOPTemplate, indexAllSOPs, searchSOPs, startSOPIndexCron } from "../services/sopIndexer";
import { preloadModel } from "../services/embeddingService";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import logger from "../lib/logger";
import type { IStorage } from "../storage";
import { resolveStoreId } from "../lib/storeResolver";

export function registerRAGRoutes(
  app: Express,
  _storage: IStorage,
  isAuthenticated: any,
) {
  app.post("/api/sops/reindex", isAuthenticated, asyncHandler(async (req: any, res) => {
    const role = req.user?.role?.name;
    if (role !== "owner" && role !== "admin") {
      throw new AppError(403, "Only owners and admins can trigger re-indexing", "FORBIDDEN");
    }

    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "VALIDATION_ERROR");

    res.json({ success: true, message: "Re-indexing started in background" });

    setImmediate(async () => {
      try {
        const result = await indexAllSOPs(storeId);
        logger.info({ ...result, storeId }, "[RAG] Full re-index completed");
      } catch (err: any) {
        logger.error({ error: err.message }, "[RAG] Full re-index failed");
      }
    });
  }));

  app.post("/api/sops/reindex/:templateId", isAuthenticated, asyncHandler(async (req: any, res) => {
    const role = req.user?.role?.name;
    if (role !== "owner" && role !== "admin") {
      throw new AppError(403, "Only owners and admins can trigger re-indexing", "FORBIDDEN");
    }

    const { templateId } = req.params;
    const result = await indexSOPTemplate(templateId);
    res.json({ success: true, data: result });
  }));

  app.get("/api/rag/search", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "VALIDATION_ERROR");

    const query = req.query.q as string;
    if (!query || query.trim().length < 2) {
      throw new AppError(400, "Query must be at least 2 characters", "VALIDATION_ERROR");
    }

    const topK = Math.min(parseInt(req.query.limit as string) || 5, 20);
    const results = await searchSOPs(storeId, query.trim(), topK);

    res.json({ success: true, data: results });
  }));

  app.get("/api/rag/status", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await resolveStoreId();
    if (!storeId) throw new AppError(400, "No store configured", "VALIDATION_ERROR");

    const { db } = await import("../db");
    const { sopEmbeddings } = await import("@shared/schema");
    const { eq, count } = await import("drizzle-orm");

    const [result] = await db.select({ count: count() })
      .from(sopEmbeddings)
      .where(eq(sopEmbeddings.storeId, storeId));

    res.json({
      success: true,
      data: {
        embeddingsCount: result?.count || 0,
      },
    });
  }));

  setImmediate(() => {
    preloadModel().then(ok => {
      if (ok) logger.info("[RAG] Embedding model preloaded");
      else logger.warn("[RAG] Embedding model failed to preload — will retry on first use");
    });
  });

  startSOPIndexCron();
}
