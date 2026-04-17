import { db } from '../db';
import { workLocations } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getOrGenerateHuddle } from './morningHuddleAI';
import { generateDailyQuote } from './dailyQuoteAI';
import { runAutoAssign } from '../routes/ai';
import { storage } from '../storage';
import logger from '../lib/logger';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let lastQuoteDate = '';
let lastHuddleDate = '';
let lastAutoAssignDate = '';

async function getStoreIds(): Promise<string[]> {
  const stores = await db.select({ id: workLocations.id })
    .from(workLocations)
    .where(eq(workLocations.isActive, true))
    .catch(() => []);
  return stores.map(s => s.id);
}

async function runScheduledTasks() {
  const now = new Date();
  const hour = now.getHours();
  const todayStr = now.toISOString().slice(0, 10);

  const needsQuotes = hour >= 5 && lastQuoteDate !== todayStr;
  const needsHuddles = hour >= 6 && lastHuddleDate !== todayStr;
  const needsAutoAssign = hour >= 7 && lastAutoAssignDate !== todayStr;

  if (!needsQuotes && !needsHuddles && !needsAutoAssign) return;

  try {
    const storeIds = await getStoreIds();

    if (needsQuotes) {
      for (const storeId of storeIds) {
        try {
          await generateDailyQuote(storeId, now);
        } catch (err: any) {
          logger.error({ storeId, error: err.message }, 'Scheduled quote generation failed');
        }
      }
      lastQuoteDate = todayStr;
      logger.info('Daily quotes generated for all stores');
    }

    if (needsHuddles) {
      for (const storeId of storeIds) {
        try {
          await getOrGenerateHuddle(storeId, now);
        } catch (err: any) {
          logger.error({ storeId, error: err.message }, 'Scheduled huddle generation failed');
        }
      }
      lastHuddleDate = todayStr;
      logger.info('Morning huddles generated for all stores');
    }

    if (needsAutoAssign) {
      try {
        const settings = await storage.getCompanySettings();
        if (settings?.taskAutoAssign) {
          const result = await runAutoAssign(storage);
          lastAutoAssignDate = todayStr;
          logger.info({ assignments: result.assignments.length, source: result.source }, 'Daily task auto-assign complete');
        } else {
          lastAutoAssignDate = todayStr; // mark done even if disabled so we don't retry all day
        }
      } catch (err: any) {
        logger.error({ error: err.message }, 'Daily task auto-assign failed');
      }
    }
  } catch (err: any) {
    logger.error({ error: err.message }, 'Ritual scheduler error');
  }
}

export function startRitualScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(runScheduledTasks, 15 * 60 * 1000);
  logger.info('Ritual scheduler started (checks every 15 minutes)');
  setTimeout(runScheduledTasks, 5000);
}

export function stopRitualScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info('Ritual scheduler stopped');
  }
}
