import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import {
  morningHuddles, dailyDebriefs, kudos, users, workLocations,
  insertDailyDebriefSchema, insertKudoSchema, gtdInboxItems
} from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { getOrGenerateHuddle } from "../services/morningHuddleAI";
import { generateDailyQuote } from "../services/dailyQuoteAI";
import { generateMiddayPulse } from "../services/middayPulse";
import { triggerClarification } from "../services/gtdClarificationAI";
import type { IStorage } from "../storage";
import logger from "../lib/logger";

async function getFirstStoreId(): Promise<string> {
  const [store] = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
  if (!store) throw new AppError(400, "No store configured", "NO_STORE");
  return store.id;
}

function getUserName(u: { firstName: string | null; lastName: string | null }): string {
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown';
}

export function registerRitualRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void
) {
  app.get('/api/rituals/huddle/today', isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await getFirstStoreId();
    const today = new Date();
    const huddle = await getOrGenerateHuddle(storeId, today);

    let ledByName = null;
    if (huddle.ledBy) {
      const u = await storage.getUser(huddle.ledBy);
      if (u) ledByName = getUserName(u);
    }

    const attendeeIds = (huddle.attendees as string[]) || [];
    let attendeeNames: string[] = [];
    if (attendeeIds.length > 0) {
      const userRows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(attendeeIds.map(id => sql`${id}`), sql`, `)})`);
      attendeeNames = userRows.map(getUserName);
    }

    res.json({
      success: true,
      data: { ...huddle, ledByName, attendeeNames },
    });
  }));

  app.put('/api/rituals/huddle/today', isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await getFirstStoreId();
    const todayStr = new Date().toISOString().slice(0, 10);

    const updateSchema = z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional(),
      ledBy: z.string().optional(),
      attendees: z.array(z.string()).optional(),
      winOfTheDay: z.string().optional(),
      goals: z.array(z.string()).optional(),
      headsUp: z.array(z.string()).optional(),
    });

    const updates = updateSchema.parse(req.body);
    const setPayload: any = { ...updates };

    if (updates.status === 'in_progress') setPayload.startedAt = new Date();
    if (updates.status === 'completed') setPayload.completedAt = new Date();

    const [updated] = await db.update(morningHuddles)
      .set(setPayload)
      .where(and(eq(morningHuddles.storeId, storeId), eq(morningHuddles.huddleDate, todayStr)))
      .returning();

    if (!updated) throw new AppError(404, "No huddle found for today", "NOT_FOUND");

    broadcastToAll({ type: 'huddle_updated', data: { huddle: updated } });
    res.json({ success: true, data: updated });
  }));

  app.get('/api/rituals/pulse/today', isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await getFirstStoreId();
    const now = new Date();
    const hour = now.getHours();

    if (hour < 12) {
      return res.json({ success: true, data: null, message: "Pulse available after noon" });
    }

    const pulse = await generateMiddayPulse(storeId);
    res.json({ success: true, data: pulse });
  }));

  app.get('/api/rituals/quote/today', isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await getFirstStoreId();
    const today = new Date();
    const quote = await generateDailyQuote(storeId, today);
    res.json({ success: true, data: quote });
  }));

  app.post('/api/rituals/debrief', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getFirstStoreId();
    const todayStr = new Date().toISOString().slice(0, 10);

    const body = insertDailyDebriefSchema.parse({
      ...req.body,
      storeId,
      employeeId: userId,
      debriefDate: todayStr,
    });

    const [existing] = await db.select({ id: dailyDebriefs.id }).from(dailyDebriefs)
      .where(and(eq(dailyDebriefs.employeeId, userId), eq(dailyDebriefs.debriefDate, todayStr)));

    let debrief;
    if (existing) {
      [debrief] = await db.update(dailyDebriefs)
        .set({
          whatWentWell: body.whatWentWell,
          whatBuggedYou: body.whatBuggedYou,
          whatBuggedYouCategory: body.whatBuggedYouCategory,
          whatBuggedYouPhotoUrl: body.whatBuggedYouPhotoUrl,
          customerHighlights: body.customerHighlights,
        })
        .where(eq(dailyDebriefs.id, existing.id))
        .returning();
    } else {
      [debrief] = await db.insert(dailyDebriefs).values(body).returning();
    }

    broadcastToAll({ type: 'debrief_submitted', data: { debrief } });

    if (debrief.whatBuggedYou) {
      try {
        const [inboxItem] = await db.insert(gtdInboxItems).values({
          storeId,
          capturedBy: userId,
          rawInput: debrief.whatBuggedYou,
          source: 'debrief',
          status: 'unprocessed',
        }).returning();

        const user = await storage.getUserWithRole(userId);
        const empName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
        const empRole = user?.role?.name || 'employee';

        triggerClarification(inboxItem.id, inboxItem.rawInput, storeId, empName, empRole, broadcastToAll)
          .catch(err => logger.error({ error: err.message, itemId: inboxItem.id }, 'GTD debrief clarification failed'));
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to create GTD inbox item from debrief');
      }
    }

    res.json({ success: true, data: debrief });
  }));

  app.get('/api/rituals/debrief', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);

    const perms = await storage.getUserPermissions(userId);
    const isManager = perms.some(p => p.name === 'admin.manage_all' || p.name === 'hr.view_team');

    let debriefs;
    if (isManager) {
      debriefs = await db.select().from(dailyDebriefs)
        .where(eq(dailyDebriefs.debriefDate, dateStr))
        .orderBy(desc(dailyDebriefs.createdAt));
    } else {
      debriefs = await db.select().from(dailyDebriefs)
        .where(and(eq(dailyDebriefs.employeeId, userId), eq(dailyDebriefs.debriefDate, dateStr)));
    }

    const employeeIds = [...new Set(debriefs.map(d => d.employeeId))];
    let userMap: Record<string, string> = {};
    if (employeeIds.length > 0) {
      const userRows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(employeeIds.map(id => sql`${id}`), sql`, `)})`);
      userMap = Object.fromEntries(userRows.map(u => [u.id, getUserName(u)]));
    }

    const enriched = debriefs.map(d => ({
      ...d,
      employeeName: userMap[d.employeeId] || 'Unknown',
    }));

    res.json({ success: true, data: enriched });
  }));

  app.post('/api/kudos', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const storeId = await getFirstStoreId();

    const messageText = req.body.message?.trim() || '';
    if (messageText.length > 280) {
      throw new AppError(400, "Kudos message must be 280 characters or less", "VALIDATION_ERROR");
    }

    const body = insertKudoSchema.parse({
      ...req.body,
      storeId,
      fromEmployeeId: userId,
      message: messageText,
    });

    const [kudo] = await db.insert(kudos).values(body).returning();

    const sender = await storage.getUser(userId);
    const recipient = await storage.getUser(body.toEmployeeId);

    broadcastToAll({
      type: 'kudo_sent',
      data: {
        kudo: {
          ...kudo,
          fromName: sender ? getUserName(sender) : 'Unknown',
          toName: recipient ? getUserName(recipient) : 'Unknown',
        },
      },
    });

    res.status(201).json({ success: true, data: kudo });
  }));

  app.get('/api/kudos', isAuthenticated, asyncHandler(async (req: any, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const storeId = await getFirstStoreId();

    const kudosList = await db.select().from(kudos)
      .where(and(eq(kudos.storeId, storeId), gte(kudos.createdAt, since)))
      .orderBy(desc(kudos.createdAt));

    const userIds = [...new Set([
      ...kudosList.map(k => k.fromEmployeeId),
      ...kudosList.map(k => k.toEmployeeId),
    ])];

    let userMap: Record<string, { name: string; image: string | null }> = {};
    if (userIds.length > 0) {
      const userRows = await db.select({
        id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl
      }).from(users)
        .where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`);
      userMap = Object.fromEntries(userRows.map(u => [u.id, { name: getUserName(u), image: u.profileImageUrl }]));
    }

    const enriched = kudosList.map(k => ({
      ...k,
      fromName: userMap[k.fromEmployeeId]?.name || 'Unknown',
      fromImage: userMap[k.fromEmployeeId]?.image || null,
      toName: userMap[k.toEmployeeId]?.name || 'Unknown',
      toImage: userMap[k.toEmployeeId]?.image || null,
    }));

    res.json({ success: true, data: enriched });
  }));
}
