import type { Express } from "express";
import type { IStorage } from "../storage";
import { gamificationService } from "../services/gamificationService";

export function registerGamificationRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/gamification/my-score', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const myScore = await gamificationService.computeUserScore(userId);
      const rankInfo = await gamificationService.getUserRank(userId, myScore.overallScore);
      myScore.rank = rankInfo.rank;
      myScore.totalMembers = rankInfo.totalMembers;

      const settings = await gamificationService.getSettings();
      const nextTier = await gamificationService.getNextTierInfo(myScore.overallScore);
      const prizeDescriptions = (settings.prizeDescriptions as any) || {};
      const prizeEligibility = prizeDescriptions[myScore.tier] || null;

      res.json({
        ...myScore,
        nextTier,
        prizeEligibility,
        achievementDefinitions: gamificationService.getAchievementDefinitions(),
      });
    } catch (error: any) {
      console.error("Error fetching user score:", error);
      res.status(500).json({ message: "Failed to fetch score" });
    }
  });

  app.get('/api/gamification/leaderboard', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const result = await gamificationService.getLeaderboard(userId);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.get('/api/gamification/score-history', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.query.userId as string || req.user.id;
      const range = (req.query.range as string) || '30d';

      if (userId !== req.user.id) {
        const perms = await storage.getUserPermissions(req.user.id);
        const isAdmin = perms.some(p => p.name === 'admin.manage_all');
        if (!isAdmin) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const history = await gamificationService.getScoreHistory(userId, range);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching score history:", error);
      res.status(500).json({ message: "Failed to fetch score history" });
    }
  });

  app.get('/api/gamification/team-scores', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const perms = await storage.getUserPermissions(userId);
      const isAdmin = perms.some(p => p.name === 'admin.manage_all');

      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const scores = await gamificationService.computeAllScoresAndRank();
      res.json(scores);
    } catch (error: any) {
      console.error("Error fetching team scores:", error);
      res.status(500).json({ message: "Failed to fetch team scores" });
    }
  });

  app.get('/api/gamification/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const perms = await storage.getUserPermissions(userId);
      const isAdmin = perms.some(p => p.name === 'admin.manage_all');

      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const settings = await gamificationService.getSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching gamification settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put('/api/gamification/settings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const perms = await storage.getUserPermissions(userId);
      const isAdmin = perms.some(p => p.name === 'admin.manage_all');

      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const updated = await gamificationService.updateSettings(req.body, userId);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating gamification settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post('/api/gamification/snapshot', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const perms = await storage.getUserPermissions(userId);
      const isAdmin = perms.some(p => p.name === 'admin.manage_all');

      if (!isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await gamificationService.saveScoreSnapshots();
      res.json({ success: true, message: "Score snapshots saved" });
    } catch (error: any) {
      console.error("Error saving score snapshots:", error);
      res.status(500).json({ message: "Failed to save snapshots" });
    }
  });

  app.get('/api/gamification/notification-preference', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      res.json({ scoreNotificationsEnabled: user?.scoreNotificationsEnabled ?? true });
    } catch (error: any) {
      console.error("Error fetching notification preference:", error);
      res.status(500).json({ message: "Failed to fetch preference" });
    }
  });

  app.put('/api/gamification/notification-preference', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { enabled } = req.body;
      const { db } = await import('../db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.update(users).set({ scoreNotificationsEnabled: !!enabled }).where(eq(users.id, userId));
      res.json({ success: true, scoreNotificationsEnabled: !!enabled });
    } catch (error: any) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ message: "Failed to update preference" });
    }
  });

  app.get('/api/gamification/achievements', isAuthenticated, async (req: any, res) => {
    try {
      res.json(gamificationService.getAchievementDefinitions());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch achievements" });
    }
  });
}
