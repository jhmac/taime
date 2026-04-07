import { db } from '../db';
import { storage } from '../storage';
import { users, clockEvents, scoreHistory, userAchievements, gamificationSettings, scoreNotices, type UserAchievement, type GamificationSettings, type ScoreNotice } from '@shared/schema';
import { eq, and, gte, lte, desc, asc, sql, count } from 'drizzle-orm';
import { NotificationService } from './notificationService';

const notificationService = new NotificationService();

interface CategoryScore {
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
}

interface ScoreBreakdown {
  attendance: CategoryScore;
  tasks: CategoryScore;
  sops: CategoryScore;
  engagement: CategoryScore;
}

interface TierThresholds {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
  diamond: number;
}

interface CategoryWeights {
  attendance: number;
  tasks: number;
  sops: number;
  engagement: number;
}

interface PrizeDescriptions {
  [tier: string]: string;
}

interface AchievementDefinition {
  key: string;
  name: string;
  description: string;
  icon: string;
}

interface GamificationSettingsData {
  id?: string;
  storeId?: string | null;
  tierThresholds: TierThresholds;
  prizeDescriptions: PrizeDescriptions;
  categoryWeights: CategoryWeights;
  scoreNotificationsEnabled: boolean;
  updatedBy?: string | null;
  updatedAt?: Date | null;
}

interface NextTierInfo {
  nextTier: string | null;
  pointsNeeded: number;
  threshold: number;
}

interface UserScore {
  userId: string;
  firstName: string;
  lastName: string;
  overallScore: number;
  breakdown: ScoreBreakdown;
  tier: string;
  rank: number;
  totalMembers: number;
  streakDays: number;
  achievements: UserAchievement[];
  totalPoints: number;
}

interface DbRow {
  [key: string]: string | number | null;
}

const DEFAULT_WEIGHTS = { attendance: 30, tasks: 30, sops: 20, engagement: 20 };
const DEFAULT_THRESHOLDS = { bronze: 0, silver: 40, gold: 60, platinum: 80, diamond: 95 };

const ACHIEVEMENT_DEFINITIONS = [
  { key: 'perfect_week', name: 'Perfect Week', description: '7-day on-time streak', icon: '🌟' },
  { key: 'sop_master', name: 'SOP Master', description: 'Mastered 5+ SOPs', icon: '📋' },
  { key: 'team_player', name: 'Team Player', description: 'Gave 10+ kudos', icon: '🤝' },
  { key: 'iron_streak', name: 'Iron Streak', description: '30-day attendance streak', icon: '🔥' },
  { key: 'speed_demon', name: 'Speed Demon', description: 'All tasks on time for 5 days straight', icon: '⚡' },
  { key: 'first_clock_in', name: 'First Day', description: 'Completed your first clock-in', icon: '🎉' },
  { key: 'gold_tier', name: 'Gold Status', description: 'Reached Gold tier', icon: '🥇' },
  { key: 'platinum_tier', name: 'Platinum Status', description: 'Reached Platinum tier', icon: '💎' },
  { key: 'diamond_tier', name: 'Diamond Status', description: 'Reached Diamond tier', icon: '👑' },
  { key: 'task_streak_10', name: 'Task Machine', description: 'Completed 10 tasks in a row on time', icon: '🏆' },
  { key: 'helpful_hero', name: 'Helpful Hero', description: 'Received 20+ kudos', icon: '❤️' },
  { key: 'early_bird', name: 'Early Bird', description: 'Clocked in early 10 times', icon: '🐦' },
];

function getTier(score: number, thresholds: TierThresholds = DEFAULT_THRESHOLDS): string {
  if (score >= (thresholds.diamond || 95)) return 'diamond';
  if (score >= (thresholds.platinum || 80)) return 'platinum';
  if (score >= (thresholds.gold || 60)) return 'gold';
  if (score >= (thresholds.silver || 40)) return 'silver';
  return 'bronze';
}

function getNextTierInfo(score: number, thresholds: TierThresholds = DEFAULT_THRESHOLDS): NextTierInfo {
  const tiers = [
    { name: 'silver', threshold: thresholds.silver || 40 },
    { name: 'gold', threshold: thresholds.gold || 60 },
    { name: 'platinum', threshold: thresholds.platinum || 80 },
    { name: 'diamond', threshold: thresholds.diamond || 95 },
  ];
  for (const t of tiers) {
    if (score < t.threshold) {
      return { nextTier: t.name, pointsNeeded: t.threshold - score, threshold: t.threshold };
    }
  }
  return { nextTier: null, pointsNeeded: 0, threshold: 100 };
}

function normalizeScore(raw: number, maxPossible: number): number {
  if (maxPossible <= 0) return 50;
  const pct = Math.min(100, Math.max(0, (raw / maxPossible) * 100));
  return Math.round(pct);
}

export class GamificationService {
  async getSettings(_storeId?: string): Promise<GamificationSettingsData> {
    const rows = await db.select().from(gamificationSettings).limit(1);
    if (rows.length > 0) {
      return {
        id: rows[0].id,
        storeId: rows[0].storeId,
        tierThresholds: (rows[0].tierThresholds as TierThresholds) ?? DEFAULT_THRESHOLDS,
        prizeDescriptions: (rows[0].prizeDescriptions as PrizeDescriptions) ?? {},
        categoryWeights: (rows[0].categoryWeights as CategoryWeights) ?? DEFAULT_WEIGHTS,
        scoreNotificationsEnabled: rows[0].scoreNotificationsEnabled ?? true,
        updatedBy: rows[0].updatedBy,
        updatedAt: rows[0].updatedAt,
      };
    }
    return {
      tierThresholds: DEFAULT_THRESHOLDS,
      prizeDescriptions: { gold: 'Free lunch this month!', platinum: 'Gift card reward', diamond: 'Employee of the month recognition' },
      categoryWeights: DEFAULT_WEIGHTS,
      scoreNotificationsEnabled: true,
    };
  }

  async computeUserScore(userId: string, allUserIds?: string[]): Promise<UserScore> {
    const settings = await this.getSettings();
    const weights = settings.categoryWeights;
    const thresholds = settings.tierThresholds;

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = await storage.getClockEvents(userId, thirtyDaysAgo, now);

    let attendancePoints = 0;
    let maxAttendancePoints = 0;
    let consecutiveOnTime = 0;
    let maxConsecutiveOnTime = 0;

    for (const ev of events) {
      const defaultMax = Math.abs(ev.pointValue || 0) || 10;
      if (['shift-start', 'late-clock-in', 'excessive-late', 'full-shift-bonus', 'geofence-exit-out',
           'break-end-on-time', 'break-overrun', 'app-switch-out', 'prompted-resume',
           'geofence-prompt-in', 'geofence-denied', 'auto-timeout-out'].includes(ev.eventType)) {
        attendancePoints += (ev.pointValue || 0);
        maxAttendancePoints += defaultMax;

        if (ev.eventType === 'shift-start' && (ev.pointValue || 0) > 0) {
          consecutiveOnTime++;
          maxConsecutiveOnTime = Math.max(maxConsecutiveOnTime, consecutiveOnTime);
        } else if (['late-clock-in', 'excessive-late'].includes(ev.eventType)) {
          consecutiveOnTime = 0;
        }
      }
    }

    const taskEvents = events.filter(e =>
      ['task-completed-on-time', 'task-completed-late', 'task-overdue', 'chore-completed', 'chore-missed'].includes(e.eventType)
    );
    let taskPoints = 0;
    let maxTaskPoints = 0;
    for (const ev of taskEvents) {
      taskPoints += (ev.pointValue || 0);
      maxTaskPoints += Math.abs(ev.pointValue || 0) || 10;
    }

    let sopScore = 50;
    try {
      const sopExecs = await db.execute(sql`
        SELECT status FROM sop_executions 
        WHERE employee_id = ${userId} 
        AND created_at >= ${thirtyDaysAgo.toISOString()}
      `);
      const sopRows = (sopExecs as { rows: DbRow[] }).rows || [];
      if (sopRows.length > 0) {
        const completed = sopRows.filter((r) => r.status === 'completed').length;
        sopScore = Math.round((completed / sopRows.length) * 100);
      }
    } catch (err) {
      console.warn('[Gamification] SOP score fallback for', userId, err);
    }

    let engagementScore = 50;
    try {
      const [kudosGiven, kudosReceived, debriefs] = await Promise.all([
        db.execute(sql`SELECT COUNT(*) as cnt FROM kudos WHERE from_employee_id = ${userId} AND created_at >= ${thirtyDaysAgo.toISOString()}`),
        db.execute(sql`SELECT COUNT(*) as cnt FROM kudos WHERE to_employee_id = ${userId} AND created_at >= ${thirtyDaysAgo.toISOString()}`),
        db.execute(sql`SELECT COUNT(*) as cnt FROM daily_debriefs WHERE employee_id = ${userId} AND created_at >= ${thirtyDaysAgo.toISOString()}`),
      ]);
      const given = parseInt(String((kudosGiven as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));
      const received = parseInt(String((kudosReceived as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));
      const debriefCount = parseInt(String((debriefs as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));
      const engagementRaw = Math.min(given * 5 + received * 3 + debriefCount * 4, 100);
      engagementScore = engagementRaw || 50;
    } catch (err) {
      console.warn('[Gamification] Engagement score fallback for', userId, err);
    }

    const attendanceNorm = normalizeScore(attendancePoints, maxAttendancePoints || 1);
    const taskNorm = normalizeScore(taskPoints, maxTaskPoints || 1);

    const totalWeight = weights.attendance + weights.tasks + weights.sops + weights.engagement;
    const overallScore = Math.round(
      (attendanceNorm * weights.attendance +
       taskNorm * weights.tasks +
       sopScore * weights.sops +
       engagementScore * weights.engagement) / totalWeight
    );

    const breakdown: ScoreBreakdown = {
      attendance: { raw: attendancePoints, normalized: attendanceNorm, weight: weights.attendance, weighted: Math.round(attendanceNorm * weights.attendance / totalWeight) },
      tasks: { raw: taskPoints, normalized: taskNorm, weight: weights.tasks, weighted: Math.round(taskNorm * weights.tasks / totalWeight) },
      sops: { raw: sopScore, normalized: sopScore, weight: weights.sops, weighted: Math.round(sopScore * weights.sops / totalWeight) },
      engagement: { raw: engagementScore, normalized: engagementScore, weight: weights.engagement, weighted: Math.round(engagementScore * weights.engagement / totalWeight) },
    };

    const tier = getTier(overallScore, thresholds);

    let streakDays = 0;
    try {
      const recentEntries = await db.execute(sql`
        SELECT DISTINCT DATE(clock_in_time) as d FROM time_entries
        WHERE user_id = ${userId} AND clock_in_time >= ${new Date(now.getTime() - 90 * 86400000).toISOString()}
        ORDER BY d DESC
      `);
      const dates = ((recentEntries as { rows: DbRow[] }).rows || []).map((r) => String(r.d));
      if (dates.length > 0) {
        streakDays = 1;
        for (let i = 1; i < dates.length; i++) {
          const prev = new Date(dates[i - 1]);
          const curr = new Date(dates[i]);
          const diff = (prev.getTime() - curr.getTime()) / 86400000;
          if (diff <= 1.5) {
            streakDays++;
          } else {
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[Gamification] Streak calc fallback for', userId, err);
    }

    const achievements = await db.select().from(userAchievements).where(eq(userAchievements.userId, userId));

    let rank = 1;
    let totalMembers = 1;
    if (allUserIds && allUserIds.length > 0) {
      totalMembers = allUserIds.length;
    } else {
      try {
        const activeUsers = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
        totalMembers = activeUsers.length;
        allUserIds = activeUsers.map(u => u.id);
      } catch {}
    }

    const userInfo = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId)).limit(1);

    return {
      userId,
      firstName: userInfo[0]?.firstName || '',
      lastName: userInfo[0]?.lastName || '',
      overallScore: Math.min(100, Math.max(0, overallScore)),
      breakdown,
      tier,
      rank,
      totalMembers,
      streakDays,
      achievements,
      totalPoints: attendancePoints + taskPoints,
    };
  }

  async getUserRank(userId: string, userScore: number): Promise<{ rank: number; totalMembers: number }> {
    try {
      const activeUsers = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
      const totalMembers = activeUsers.length;

      const snapshotCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM score_history`);
      const snapshotCount = parseInt(String((snapshotCheck as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));

      if (snapshotCount > 0) {
        const result = await db.execute(sql`
          SELECT COUNT(*) as higher_count FROM score_history sh 
          INNER JOIN (SELECT user_id, MAX(snapshot_date) as max_date FROM score_history GROUP BY user_id) latest
          ON sh.user_id = latest.user_id AND sh.snapshot_date = latest.max_date
          WHERE sh.overall_score > ${userScore}
        `);
        const higherCount = parseInt(String((result as { rows: DbRow[] }).rows?.[0]?.higher_count ?? '0'));
        return { rank: higherCount + 1, totalMembers };
      }

      let higherCount = 0;
      for (const u of activeUsers) {
        if (u.id === userId) continue;
        try {
          const otherScore = await this.computeUserScore(u.id);
          if (otherScore.overallScore > userScore) higherCount++;
        } catch {
          // skip users whose score can't be computed
        }
      }
      return { rank: higherCount + 1, totalMembers };
    } catch (err) {
      console.warn('[Gamification] getUserRank fallback:', err);
      return { rank: 1, totalMembers: 1 };
    }
  }

  async computeAllScoresAndRank(): Promise<UserScore[]> {
    const activeUsers = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
    const userIds = activeUsers.map(u => u.id);

    const scores: UserScore[] = [];
    for (const uid of userIds) {
      try {
        const score = await this.computeUserScore(uid, userIds);
        scores.push(score);
      } catch (err) {
        console.error(`[Gamification] Error computing score for ${uid}:`, err);
      }
    }

    scores.sort((a, b) => b.overallScore - a.overallScore);
    scores.forEach((s, i) => { s.rank = i + 1; s.totalMembers = scores.length; });

    return scores;
  }

  async getLeaderboard(requestingUserId: string) {
    const scores = await this.computeAllScoresAndRank();
    const userScore = scores.find(s => s.userId === requestingUserId);

    const anonymousBoard = scores.map((s, i) => ({
      rank: i + 1,
      score: s.overallScore,
      tier: s.tier,
      isYou: s.userId === requestingUserId,
      streakDays: s.streakDays,
    }));

    return {
      leaderboard: anonymousBoard,
      yourRank: userScore?.rank || scores.length,
      totalMembers: scores.length,
    };
  }

  async getScoreHistory(userId: string, range: string = '30d') {
    if (range === 'all') {
      const history = await db.select()
        .from(scoreHistory)
        .where(eq(scoreHistory.userId, userId))
        .orderBy(asc(scoreHistory.snapshotDate));
      return history;
    }

    let daysBack = 30;
    if (range === '7d') daysBack = 7;
    else if (range === '90d') daysBack = 90;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const dateStr = startDate.toISOString().split('T')[0];

    const history = await db.select()
      .from(scoreHistory)
      .where(and(
        eq(scoreHistory.userId, userId),
        gte(scoreHistory.snapshotDate, dateStr)
      ))
      .orderBy(asc(scoreHistory.snapshotDate));

    return history;
  }

  async saveScoreSnapshots(): Promise<void> {
    console.log('[Gamification] Computing daily score snapshots...');
    const scores = await this.computeAllScoresAndRank();
    const today = new Date().toISOString().split('T')[0];

    for (const score of scores) {
      try {
        await db.execute(sql`
          INSERT INTO score_history (user_id, snapshot_date, overall_score, attendance_score, task_score, sop_score, engagement_score, tier, rank, total_points, streak_days)
          VALUES (${score.userId}, ${today}, ${score.overallScore}, ${score.breakdown.attendance.normalized}, ${score.breakdown.tasks.normalized}, ${score.breakdown.sops.normalized}, ${score.breakdown.engagement.normalized}, ${score.tier}, ${score.rank}, ${score.totalPoints}, ${score.streakDays})
          ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
            overall_score = EXCLUDED.overall_score,
            attendance_score = EXCLUDED.attendance_score,
            task_score = EXCLUDED.task_score,
            sop_score = EXCLUDED.sop_score,
            engagement_score = EXCLUDED.engagement_score,
            tier = EXCLUDED.tier,
            rank = EXCLUDED.rank,
            total_points = EXCLUDED.total_points,
            streak_days = EXCLUDED.streak_days
        `);
      } catch (err) {
        console.error(`[Gamification] Failed to save snapshot for ${score.userId}:`, err);
      }
    }

    await this.checkAndAwardAchievements(scores);
    await this.sendScoreNotifications(scores);

    console.log(`[Gamification] Saved ${scores.length} score snapshots for ${today}`);
  }

  async checkAndAwardAchievements(scores: UserScore[]): Promise<void> {
    for (const score of scores) {
      const existing = new Set(score.achievements.map(a => a.achievementKey));

      const toAward: { key: string; name: string; description: string; icon: string }[] = [];

      if (!existing.has('first_clock_in') && score.totalPoints > 0) {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'first_clock_in')!;
        toAward.push(def);
      }

      if (!existing.has('perfect_week') && score.streakDays >= 7) {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'perfect_week')!;
        toAward.push(def);
      }

      if (!existing.has('iron_streak') && score.streakDays >= 30) {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'iron_streak')!;
        toAward.push(def);
      }

      if (!existing.has('gold_tier') && ['gold', 'platinum', 'diamond'].includes(score.tier)) {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'gold_tier')!;
        toAward.push(def);
      }

      if (!existing.has('platinum_tier') && ['platinum', 'diamond'].includes(score.tier)) {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'platinum_tier')!;
        toAward.push(def);
      }

      if (!existing.has('diamond_tier') && score.tier === 'diamond') {
        const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'diamond_tier')!;
        toAward.push(def);
      }

      try {
        if (!existing.has('sop_master')) {
          const mastered = await db.execute(sql`
            SELECT COUNT(DISTINCT sop_id) as cnt FROM sop_executions 
            WHERE employee_id = ${score.userId} AND status = 'completed'
            GROUP BY employee_id
            HAVING COUNT(DISTINCT sop_id) >= 5
          `);
          if (((mastered as { rows: DbRow[] }).rows || []).length > 0) {
            const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'sop_master')!;
            toAward.push(def);
          }
        }
      } catch {}

      try {
        if (!existing.has('team_player')) {
          const kudosCount = await db.execute(sql`
            SELECT COUNT(*) as cnt FROM kudos WHERE from_employee_id = ${score.userId}
          `);
          if (parseInt(String((kudosCount as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0')) >= 10) {
            const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'team_player')!;
            toAward.push(def);
          }
        }

        if (!existing.has('helpful_hero')) {
          const received = await db.execute(sql`
            SELECT COUNT(*) as cnt FROM kudos WHERE to_employee_id = ${score.userId}
          `);
          if (parseInt(String((received as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0')) >= 20) {
            const def = ACHIEVEMENT_DEFINITIONS.find(d => d.key === 'helpful_hero')!;
            toAward.push(def);
          }
        }
      } catch {}

      for (const ach of toAward) {
        try {
          await db.execute(sql`
            INSERT INTO user_achievements (user_id, achievement_key, achievement_name, achievement_description, achievement_icon)
            VALUES (${score.userId}, ${ach.key}, ${ach.name}, ${ach.description}, ${ach.icon})
            ON CONFLICT (user_id, achievement_key) DO NOTHING
          `);

          try {
            const globalSettings = await this.getSettings();
            if (globalSettings.scoreNotificationsEnabled ?? true) {
              const userPref = await db.select({ scoreNotificationsEnabled: users.scoreNotificationsEnabled }).from(users).where(eq(users.id, score.userId)).limit(1);
              if (!(userPref.length > 0 && userPref[0].scoreNotificationsEnabled === false)) {
                await notificationService.sendToUser(score.userId, {
                  title: '🏆 Achievement Unlocked!',
                  body: `${ach.icon} ${ach.name} — ${ach.description}`,
                  data: { type: 'achievement_unlocked', achievementKey: ach.key, url: '/my-score' },
                });
              }
            }
          } catch {}
        } catch {}
      }
    }
  }

  async sendScoreNotifications(scores: UserScore[]): Promise<void> {
    const settings = await this.getSettings();
    if (!(settings.scoreNotificationsEnabled ?? true)) return;

    for (const score of scores) {
      try {
        const userRow = await db.select({ scoreNotificationsEnabled: users.scoreNotificationsEnabled }).from(users).where(eq(users.id, score.userId)).limit(1);
        if (userRow.length > 0 && userRow[0].scoreNotificationsEnabled === false) continue;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const prevSnapshot = await db.select()
          .from(scoreHistory)
          .where(and(
            eq(scoreHistory.userId, score.userId),
            eq(scoreHistory.snapshotDate, yesterdayStr)
          ))
          .limit(1);

        if (prevSnapshot.length > 0) {
          const prevTier = prevSnapshot[0].tier;
          if (prevTier !== score.tier) {
            const tierOrder = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
            const promoted = tierOrder.indexOf(score.tier) > tierOrder.indexOf(prevTier);
            await notificationService.sendToUser(score.userId, {
              title: promoted ? '🎉 Tier Promotion!' : '📉 Tier Change',
              body: promoted
                ? `Congratulations! You've been promoted to ${score.tier.charAt(0).toUpperCase() + score.tier.slice(1)} tier!`
                : `Your tier has changed to ${score.tier.charAt(0).toUpperCase() + score.tier.slice(1)}. Keep pushing!`,
              data: { type: 'tier_change', newTier: score.tier, oldTier: prevTier, url: '/my-score' },
            });
          }

          if (score.rank <= 3 && (prevSnapshot[0].rank || 99) > 3) {
            await notificationService.sendToUser(score.userId, {
              title: '🏅 Top 3!',
              body: `You're now ranked #${score.rank} on your team! Amazing work!`,
              data: { type: 'top_rank', rank: score.rank, url: '/my-score' },
            });
          }
        }

        const dayOfWeek = new Date().getDay();
        if (dayOfWeek === 1) {
          await notificationService.sendToUser(score.userId, {
            title: '📊 Weekly Score Update',
            body: `Your score is ${score.overallScore}/100 (${score.tier.charAt(0).toUpperCase() + score.tier.slice(1)}). You're ranked #${score.rank} of ${score.totalMembers}.`,
            data: { type: 'weekly_score_summary', url: '/my-score' },
          });
        }
      } catch (err) {
        console.error(`[Gamification] Notification error for ${score.userId}:`, err);
      }
    }
  }

  async updateSettings(data: Partial<GamificationSettingsData>, updatedBy: string) {
    const existing = await db.select().from(gamificationSettings).limit(1);
    if (existing.length > 0) {
      await db.execute(sql`
        UPDATE gamification_settings SET
          tier_thresholds = ${JSON.stringify(data.tierThresholds || DEFAULT_THRESHOLDS)},
          prize_descriptions = ${JSON.stringify(data.prizeDescriptions || {})},
          category_weights = ${JSON.stringify(data.categoryWeights || DEFAULT_WEIGHTS)},
          score_notifications_enabled = ${data.scoreNotificationsEnabled ?? true},
          updated_by = ${updatedBy},
          updated_at = NOW()
        WHERE id = ${existing[0].id}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO gamification_settings (tier_thresholds, prize_descriptions, category_weights, score_notifications_enabled, updated_by)
        VALUES (${JSON.stringify(data.tierThresholds || DEFAULT_THRESHOLDS)}, ${JSON.stringify(data.prizeDescriptions || {})}, ${JSON.stringify(data.categoryWeights || DEFAULT_WEIGHTS)}, ${data.scoreNotificationsEnabled ?? true}, ${updatedBy})
      `);
    }
    return this.getSettings();
  }

  getAchievementDefinitions() {
    return ACHIEVEMENT_DEFINITIONS;
  }

  async getNextTierInfo(score: number) {
    const settings = await this.getSettings();
    const thresholds = (settings.tierThresholds as unknown as Record<string, number>) || DEFAULT_THRESHOLDS;
    return getNextTierInfo(score, thresholds as any);
  }

  async generateAndSaveNotices(userId: string): Promise<void> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const scoreData = await this.computeUserScore(userId);
    const breakdown = scoreData.breakdown;
    const freshNotices: { category: string; severity: string; message: string }[] = [];

    const schedulesResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM schedules
      WHERE user_id = ${userId}
      AND start_time >= ${thirtyDaysAgo.toISOString()}
      AND start_time <= ${now.toISOString()}
    `);
    const scheduledShifts = parseInt(String((schedulesResult as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));

    if (breakdown.attendance.normalized < 30) {
      if (scheduledShifts === 0) {
        freshNotices.push({
          category: 'attendance',
          severity: 'info',
          message: 'No shifts were scheduled for you this period — attendance score will update once you\'re on the schedule',
        });
      } else {
        const clockedInResult = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM clock_events
          WHERE user_id = ${userId}
          AND event_type = 'shift-start'
          AND created_at >= ${thirtyDaysAgo.toISOString()}
        `);
        const clockedInCount = parseInt(String((clockedInResult as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));
        const missedShifts = Math.max(0, scheduledShifts - clockedInCount);

        if (missedShifts > 0) {
          const timeOffCoveredResult = await db.execute(sql`
            SELECT COUNT(*) as cnt FROM schedules s
            WHERE s.user_id = ${userId}
            AND s.start_time >= ${thirtyDaysAgo.toISOString()}
            AND s.start_time <= ${now.toISOString()}
            AND EXISTS (
              SELECT 1 FROM time_off_requests tor
              WHERE tor.user_id = ${userId}
              AND tor.status = 'approved'
              AND tor.start_date <= s.start_time
              AND tor.end_date >= s.start_time
            )
          `);
          const timeOffCoveredCount = parseInt(String((timeOffCoveredResult as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));
          const uncoveredMissedShifts = Math.max(0, missedShifts - timeOffCoveredCount);

          if (uncoveredMissedShifts > 0) {
            freshNotices.push({
              category: 'attendance',
              severity: 'warning',
              message: `You missed clock-ins for ${uncoveredMissedShifts} scheduled shift${uncoveredMissedShifts !== 1 ? 's' : ''} this period`,
            });
          }
        } else {
          freshNotices.push({
            category: 'attendance',
            severity: 'warning',
            message: 'Your attendance score is low. Late or missed clock-outs may be affecting your score — review your recent shifts',
          });
        }
      }
    }

    const assignedTasksResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM tasks
      WHERE assigned_to = ${userId}
      AND created_at >= ${thirtyDaysAgo.toISOString()}
    `);
    const assignedTasks = parseInt(String((assignedTasksResult as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));

    if (breakdown.tasks.normalized < 30 && assignedTasks > 0) {
      freshNotices.push({
        category: 'tasks',
        severity: 'warning',
        message: 'Your task completion rate is low. Try completing assigned tasks before their due dates to boost your score',
      });
    }

    if (breakdown.sops.normalized < 30) {
      freshNotices.push({
        category: 'sops',
        severity: 'warning',
        message: 'Your SOP completion rate is below 30%. Review and complete outstanding SOPs to improve your score',
      });
    }

    if (breakdown.engagement.normalized < 30) {
      freshNotices.push({
        category: 'engagement',
        severity: 'warning',
        message: 'Your engagement score is low. Try participating in daily debriefs and giving kudos to teammates to improve',
      });
    }

    const freshCategories = new Set(freshNotices.map(n => n.category));
    const allCategories = ['attendance', 'tasks', 'sops', 'engagement'];
    const categoriesNoLongerActive = allCategories.filter(c => !freshCategories.has(c));

    if (categoriesNoLongerActive.length > 0) {
      await db.execute(sql`
        DELETE FROM score_notices
        WHERE user_id = ${userId}
        AND category = ANY(${categoriesNoLongerActive})
      `);
    }

    for (const notice of freshNotices) {
      await db.execute(sql`
        INSERT INTO score_notices (user_id, category, severity, message, is_read)
        VALUES (${userId}, ${notice.category}, ${notice.severity}, ${notice.message}, false)
        ON CONFLICT (user_id, category) DO UPDATE SET
          severity = EXCLUDED.severity,
          message = EXCLUDED.message
        WHERE score_notices.message != EXCLUDED.message
      `);
    }
  }

  async getNotices(userId: string): Promise<ScoreNotice[]> {
    try {
      const result = await db.execute(sql`
        SELECT id, user_id, category, severity, message, is_read, created_at
        FROM score_notices
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 50
      `);
      return ((result as { rows: DbRow[] }).rows || []).map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        category: String(r.category),
        severity: String(r.severity),
        message: String(r.message),
        isRead: (r.is_read as any) === true || r.is_read === 't' || r.is_read === 'true' || (r.is_read as any) === 1,
        createdAt: r.created_at ? new Date(String(r.created_at)) : new Date(),
      }));
    } catch (err) {
      console.warn('[Gamification] Failed to fetch notices:', err);
      return [];
    }
  }

  async getUnreadNoticeCount(userId: string): Promise<number> {
    try {
      const result = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM score_notices
        WHERE user_id = ${userId} AND is_read = false
      `);
      return parseInt(String((result as { rows: DbRow[] }).rows?.[0]?.cnt ?? '0'));
    } catch {
      return 0;
    }
  }

  async markNoticeRead(noticeId: string, userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE score_notices SET is_read = true
      WHERE id = ${noticeId} AND user_id = ${userId}
    `);
  }

  async markAllNoticesRead(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE score_notices SET is_read = true
      WHERE user_id = ${userId}
    `);
  }
}

export const gamificationService = new GamificationService();
