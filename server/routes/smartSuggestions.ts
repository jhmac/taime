import type { Express } from "express";
import { asyncHandler } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { generateTaskSuggestions } from "../services/smartTaskSuggestions";
import { cache } from "../lib/cache";

export function registerSmartSuggestionRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/ai/suggestions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const storeId = user.locationId || user.storeId;
    if (!storeId) return res.status(400).json({ message: "No store assigned" });

    const result = await generateTaskSuggestions(userId, storeId);
    res.json({ success: true, data: result });
  }));

  app.post("/api/ai/suggestions/refresh", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const storeId = user.locationId || user.storeId;
    if (!storeId) return res.status(400).json({ message: "No store assigned" });

    cache.invalidate(`smart-suggestions:${userId}`);
    const result = await generateTaskSuggestions(userId, storeId);
    res.json({ success: true, data: result });
  }));
}
