import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { gamificationService } from "../services/gamificationService";
import { db } from '../db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { resolvePermission } from '../services/permissionResolver';

interface AuthRequest extends Request {
  user: { id: string };
}

export function registerGamificationRoutes(app: Express, storage: IStorage, isAuthenticated: (req: Request, res: Response, next: () => void) => void) {
  app.get('/api/gamification/my-score', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const myScore = await gamificationService.computeUserScore(userId);
      const rankInfo = await gamificationService.getUserRank(userId, myScore.overallScore);
      myScore.rank = rankInfo.rank;
      myScore.totalMembers = rankInfo.totalMembers;

      const settings = await gamificationService.getSettings();
      const nextTier = await gamificationService.getNextTierInfo(myScore.overallScore);
      const prizeDescriptions = (settings.prizeDescriptions ?? {}) as Record<string, string>;
      const prizeEligibility = prizeDescriptions[myScore.tier] || null;

      try {
        await gamificationService.generateAndSaveNotices(userId);
      } catch (noticeErr) {
        console.warn('[Gamification] Notice generation failed (non-fatal):', noticeErr);
      }

      res.json({
        ...myScore,
        nextTier,
        prizeEligibility,
        achievementDefinitions: gamificationService.getAchievementDefinitions(),
      });
    } catch (error: unknown) {
      console.error("Error fetching user score:", error);
      res.status(500).json({ message: "Failed to fetch score" });
    }
  });

  app.get('/api/gamification/leaderboard', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const result = await gamificationService.getLeaderboard(userId);
      res.json(result);
    } catch (error: unknown) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.get('/api/gamification/score-history', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const requesterId = (req as AuthRequest).user.id;
      const userId = (req.query.userId as string) || requesterId;
      const range = (req.query.range as string) || '30d';

      if (userId !== requesterId) {
        if (!(await resolvePermission(requesterId, 'admin.manage_all', storage))) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const history = await gamificationService.getScoreHistory(userId, range);
      res.json(history);
    } catch (error: unknown) {
      console.error("Error fetching score history:", error);
      res.status(500).json({ message: "Failed to fetch score history" });
    }
  });

  app.get('/api/gamification/team-scores', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      if (!(await resolvePermission(userId, 'admin.manage_all', storage))) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const scores = await gamificationService.computeAllScoresAndRank();
      res.json(scores);
    } catch (error: unknown) {
      console.error("Error fetching team scores:", error);
      res.status(500).json({ message: "Failed to fetch team scores" });
    }
  });

  app.get('/api/gamification/settings', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      if (!(await resolvePermission(userId, 'admin.manage_all', storage))) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const settings = await gamificationService.getSettings();
      res.json(settings);
    } catch (error: unknown) {
      console.error("Error fetching gamification settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put('/api/gamification/settings', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      if (!(await resolvePermission(userId, 'admin.manage_all', storage))) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const updated = await gamificationService.updateSettings(req.body, userId);
      res.json(updated);
    } catch (error: unknown) {
      console.error("Error updating gamification settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.post('/api/gamification/snapshot', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      if (!(await resolvePermission(userId, 'admin.manage_all', storage))) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await gamificationService.saveScoreSnapshots();
      res.json({ success: true, message: "Score snapshots saved" });
    } catch (error: unknown) {
      console.error("Error saving score snapshots:", error);
      res.status(500).json({ message: "Failed to save snapshots" });
    }
  });

  app.get('/api/gamification/notification-preference', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const user = await storage.getUser(userId);
      res.json({ scoreNotificationsEnabled: user?.scoreNotificationsEnabled ?? true });
    } catch (error: unknown) {
      console.error("Error fetching notification preference:", error);
      res.status(500).json({ message: "Failed to fetch preference" });
    }
  });

  app.put('/api/gamification/notification-preference', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const { enabled } = req.body as { enabled: boolean };
      await db.update(users).set({ scoreNotificationsEnabled: !!enabled }).where(eq(users.id, userId));
      res.json({ success: true, scoreNotificationsEnabled: !!enabled });
    } catch (error: unknown) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ message: "Failed to update preference" });
    }
  });

  app.get('/api/gamification/achievements', isAuthenticated, async (_req: Request, res: Response) => {
    try {
      res.json(gamificationService.getAchievementDefinitions());
    } catch (error: unknown) {
      res.status(500).json({ message: "Failed to fetch achievements" });
    }
  });

  app.get('/api/gamification/notices', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const notices = await gamificationService.getNotices(userId);
      const unreadCount = notices.filter(n => !n.isRead).length;
      res.json({ notices, unreadCount });
    } catch (error: unknown) {
      console.error("Error fetching notices:", error);
      res.status(500).json({ message: "Failed to fetch notices" });
    }
  });

  app.get('/api/gamification/notices/unread-count', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const count = await gamificationService.getUnreadNoticeCount(userId);
      res.json({ count });
    } catch (error: unknown) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.patch('/api/gamification/notices/read-all', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      await gamificationService.markAllNoticesRead(userId);
      res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error marking all notices as read:", error);
      res.status(500).json({ message: "Failed to mark all as read" });
    }
  });

  app.patch('/api/gamification/notices/:id/read', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthRequest).user.id;
      const noticeId = req.params.id;
      await gamificationService.markNoticeRead(noticeId, userId);
      res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error marking notice as read:", error);
      res.status(500).json({ message: "Failed to mark notice as read" });
    }
  });
}
