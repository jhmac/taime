import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { shopifyDailySales, middayPulses, shops, userShops, timeEntries } from '@shared/schema';
import { config } from '../lib/config';
import logger from '../lib/logger';
import { cache } from '../lib/cache';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = 'claude-sonnet-4-20250514';

export interface MiddayPulseData {
  headline: string;
  detail: string;
  suggestion?: string;
  revenue: number;
  transactionCount: number;
  averageOrderValue: number;
  targetRevenue?: number;
  lastWeekRevenue?: number;
  paceToTarget?: number;
  staleData: boolean;
  generatedAt: string;
}

async function getShopDomainForStore(storeId: string): Promise<string | null> {
  const result = await db.select({ shopDomain: shops.shopDomain })
    .from(shops)
    .limit(1);
  return result.length > 0 ? result[0].shopDomain : null;
}

async function getTodaySales(shopDomain: string): Promise<{
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  lastSyncTime: Date | null;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const salesRows = await db.select()
    .from(shopifyDailySales)
    .where(and(
      eq(shopifyDailySales.shopDomain, shopDomain),
      gte(shopifyDailySales.date, today),
      lte(shopifyDailySales.date, tomorrow)
    ))
    .orderBy(desc(shopifyDailySales.date))
    .limit(1);

  if (salesRows.length === 0) {
    return { revenue: 0, orderCount: 0, avgOrderValue: 0, lastSyncTime: null };
  }

  const row = salesRows[0];
  return {
    revenue: parseFloat(row.totalRevenue || '0'),
    orderCount: row.orderCount || 0,
    avgOrderValue: parseFloat(row.averageOrderValue || '0'),
    lastSyncTime: row.createdAt,
  };
}

async function getLastWeekSales(shopDomain: string): Promise<number> {
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  lastWeek.setHours(0, 0, 0, 0);
  const lastWeekEnd = new Date(lastWeek);
  lastWeekEnd.setDate(lastWeekEnd.getDate() + 1);

  const rows = await db.select({ totalRevenue: shopifyDailySales.totalRevenue })
    .from(shopifyDailySales)
    .where(and(
      eq(shopifyDailySales.shopDomain, shopDomain),
      gte(shopifyDailySales.date, lastWeek),
      lte(shopifyDailySales.date, lastWeekEnd)
    ))
    .limit(1);

  return rows.length > 0 ? parseFloat(rows[0].totalRevenue || '0') : 0;
}

export async function generateMiddayPulse(storeId: string): Promise<MiddayPulseData> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cacheKey = `pulse:${storeId}:${todayStr}`;

  const cached = cache.get<MiddayPulseData>(cacheKey);
  if (cached) return cached;

  const existing = await db.select()
    .from(middayPulses)
    .where(and(
      eq(middayPulses.storeId, storeId),
      eq(middayPulses.pulseDate, todayStr)
    ))
    .limit(1);

  if (existing.length > 0) {
    const data = existing[0].data as MiddayPulseData;
    cache.set(cacheKey, data, 3600_000);
    return data;
  }

  const shopDomain = await getShopDomainForStore(storeId);
  if (!shopDomain) {
    const fallback: MiddayPulseData = {
      headline: "No Shopify data available",
      detail: "Connect your Shopify store to get midday sales pulse updates.",
      revenue: 0,
      transactionCount: 0,
      averageOrderValue: 0,
      staleData: false,
      generatedAt: new Date().toISOString(),
    };
    return fallback;
  }

  const todaySales = await getTodaySales(shopDomain);
  const lastWeekRevenue = await getLastWeekSales(shopDomain);

  const now = new Date();
  const staleData = todaySales.lastSyncTime
    ? (now.getTime() - new Date(todaySales.lastSyncTime).getTime()) > 2 * 60 * 60 * 1000
    : true;

  const hoursIntoDay = now.getHours() + now.getMinutes() / 60;
  const operatingHours = 12;
  const fractionComplete = Math.min(hoursIntoDay / operatingHours, 1);
  const paceToTarget = lastWeekRevenue > 0 && fractionComplete > 0
    ? (todaySales.revenue / fractionComplete) / lastWeekRevenue
    : undefined;

  let aiContent: { headline: string; detail: string; suggestion?: string } | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `You are MAinager's Midday Pulse. Generate a brief, encouraging midday sales check-in for a retail boutique team.

Tone: honest but encouraging. If sales are behind, frame it as an opportunity, not a failure. If ahead, celebrate.

Return JSON only:
{
  "headline": "One punchy line summarizing the day so far (max 15 words)",
  "detail": "2-3 sentences with specific numbers and context",
  "suggestion": "One actionable suggestion based on the data (optional, only if genuinely helpful)"
}`,
      messages: [{
        role: 'user',
        content: `Today's sales so far:
- Revenue: $${todaySales.revenue.toFixed(2)}
- Transactions: ${todaySales.orderCount}
- Average order: $${todaySales.avgOrderValue.toFixed(2)}
- Same day last week: $${lastWeekRevenue.toFixed(2)}
- Day is ${(fractionComplete * 100).toFixed(0)}% through
${paceToTarget ? `- Pace vs last week: ${(paceToTarget * 100).toFixed(0)}%` : ''}
${staleData ? '- Note: sales data may be delayed' : ''}`,
      }],
    });

    clearTimeout(timeout);

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      aiContent = JSON.parse(jsonMatch[0]);
    }
  } catch (err: any) {
    logger.warn({ storeId, error: err.message }, 'Midday pulse AI generation failed, using fallback');
  }

  const pulseData: MiddayPulseData = {
    headline: aiContent?.headline || `$${todaySales.revenue.toFixed(0)} so far today`,
    detail: aiContent?.detail || `${todaySales.orderCount} transactions with $${todaySales.avgOrderValue.toFixed(2)} average. Last week same day: $${lastWeekRevenue.toFixed(2)}.`,
    suggestion: aiContent?.suggestion || undefined,
    revenue: todaySales.revenue,
    transactionCount: todaySales.orderCount,
    averageOrderValue: todaySales.avgOrderValue,
    lastWeekRevenue: lastWeekRevenue > 0 ? lastWeekRevenue : undefined,
    paceToTarget: paceToTarget ? Math.round(paceToTarget * 100) : undefined,
    staleData,
    generatedAt: new Date().toISOString(),
  };

  try {
    await db.insert(middayPulses).values({
      storeId,
      pulseDate: todayStr,
      data: pulseData,
    });
  } catch (err: any) {
    logger.warn({ storeId, error: err.message }, 'Failed to persist midday pulse (may already exist)');
  }

  cache.set(cacheKey, pulseData, 3600_000);
  return pulseData;
}

let pulseTimer: ReturnType<typeof setInterval> | null = null;
let lastPulseDate = '';

export function startMiddayPulseCron(broadcastToAll: (data: any) => void) {
  if (pulseTimer) return;

  async function checkAndGenerate() {
    const now = new Date();
    const hour = now.getHours();
    const todayStr = now.toISOString().slice(0, 10);

    if (hour < 12 || lastPulseDate === todayStr) return;

    try {
      const { workLocations } = await import('@shared/schema');
      const stores = await db.select({ id: workLocations.id })
        .from(workLocations)
        .where(eq(workLocations.isActive, true));

      for (const store of stores) {
        try {
          const pulse = await generateMiddayPulse(store.id);
          broadcastToAll({ type: 'midday_pulse', data: pulse });
          logger.info({ storeId: store.id }, 'Midday pulse generated and broadcast');
        } catch (err: any) {
          logger.error({ storeId: store.id, error: err.message }, 'Midday pulse generation failed');
        }
      }

      lastPulseDate = todayStr;
    } catch (err: any) {
      logger.error({ error: err.message }, 'Midday pulse cron error');
    }
  }

  pulseTimer = setInterval(checkAndGenerate, 5 * 60 * 1000);
  logger.info('Midday pulse cron started (checks every 5 minutes)');
  setTimeout(checkAndGenerate, 10000);
}

export function stopMiddayPulseCron() {
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
}
