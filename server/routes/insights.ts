import type { Express } from "express";
import type { IStorage } from "../storage";

export function registerInsightRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/insights', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canViewAllInsights = userPermissions.some(p => p.name === 'hr.insights');
      
      const companyId = req.user?.companyId;
      let insights;
      if (canViewAllInsights) {
        insights = await storage.getUserInsights(undefined, companyId);
      } else {
        insights = await storage.getUserInsights(userId, companyId);
      }

      res.json(insights);
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ message: "Failed to fetch insights" });
    }
  });
}
