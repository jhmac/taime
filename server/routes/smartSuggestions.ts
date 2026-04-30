import type { Express } from "express";
import { asyncHandler } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { generateTaskSuggestions } from "../services/smartTaskSuggestions";
import { cache } from "../services/cache";
import { resolveStoreId } from "../services/storeResolver";

export function registerSmartSuggestionRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/ai/suggestions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await resolveStoreId();
    if (!storeId) return res.status(400).json({ message: "No store configured" });

    const result = await generateTaskSuggestions(userId, storeId);
    res.json({ success: true, data: result });
  }));

  app.post("/api/ai/suggestions/refresh", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await resolveStoreId();
    if (!storeId) return res.status(400).json({ message: "No store configured" });

    cache.invalidate(`smart-suggestions:${userId}`);
    const result = await generateTaskSuggestions(userId, storeId);
    res.json({ success: true, data: result });
  }));
}
