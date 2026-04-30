import type { Express } from "express";
import type { IStorage } from "../storage";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

export function registerInsightRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/insights', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const canViewAllInsights = await resolvePermission(userId, 'hr.insights', storage);
      
      let insights;
      if (canViewAllInsights) {
        insights = await storage.getUserInsights();
      } else {
        insights = await storage.getUserInsights(userId);
      }

      res.json(insights);
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ message: "Failed to fetch insights" });
    }
  });
}
