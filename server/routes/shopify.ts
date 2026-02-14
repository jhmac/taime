import type { Express } from "express";
import type { IStorage } from "../storage";
import { shops, userShops, shopifyDailySales, users } from "@shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "../db";
import crypto from "crypto";
import { ShopifyService } from "../services/shopifyService";
import { claudeService } from "../services/claudeService";
import { encryptToken, decryptToken } from "../utils/tokenEncryption";
import rateLimit from "express-rate-limit";

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many AI requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const processedAuthCodes = new Map<string, { timestamp: number; status: string }>();
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(processedAuthCodes.entries());
  entries.forEach(([code, data]) => {
    if (now - data.timestamp > 600000) processedAuthCodes.delete(code);
  });
}, 300000);

function getAppUrl(requestHostname?: string): string {
  if (requestHostname) {
    const protocol = requestHostname.includes('replit.dev')
      || requestHostname.includes('.replit.app') ? 'https' : 'http';
    return `${protocol}://${requestHostname}`;
  }
  return 'http://localhost:5000';
}

async function getShopifyCredentials(shopDomain: string): Promise<{ shopDomain: string; accessToken: string } | null> {
  try {
    const normalizedDomain = shopDomain.trim().toLowerCase();
    const shopResult = await db.select()
      .from(shops)
      .where(eq(shops.shopDomain, normalizedDomain))
      .limit(1);

    if (shopResult.length > 0 && shopResult[0].accessToken) {
      let token = shopResult[0].accessToken;
      try {
        token = decryptToken(token);
      } catch {
      }
      return { shopDomain: shopResult[0].shopDomain, accessToken: token };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching credentials for ${shopDomain}:`, error);
    return null;
  }
}

export function registerShopifyRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get("/api/shopify/auth", isAuthenticated, async (req: any, res) => {
    try {
      const shop = req.query.shop as string;
      if (!shop) {
        return res.status(400).json({ error: "Shop domain is required" });
      }

      const shopDomain = shop.includes('.myshopify.com')
        ? shop.trim().toLowerCase()
        : `${shop.trim().toLowerCase()}.myshopify.com`;

      const apiKey = process.env.SHOPIFY_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Shopify API key not configured" });
      }

      const state = crypto.randomBytes(16).toString('hex');
      (req.session as any).oauthState = state;
      (req.session as any).oauthUserId = req.user.id;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => err ? reject(err) : resolve());
      });

      const baseUrl = getAppUrl(req.get('host'));
      const redirectUri = `${baseUrl}/api/shopify/auth/callback`;
      const scopes = 'read_orders,read_products';

      const authUrl = `https://${shopDomain}/admin/oauth/authorize?` +
        `client_id=${apiKey}` +
        `&scope=${scopes}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}`;

      res.json({ authUrl });
    } catch (error) {
      console.error('[Shopify OAuth] Init error:', error);
      res.status(500).json({ error: "Failed to initiate Shopify connection" });
    }
  });

  app.get("/api/shopify/auth/callback", async (req: any, res) => {
    try {
      const { code, hmac, shop, state } = req.query;

      if (code && typeof code === 'string') {
        const existingCode = processedAuthCodes.get(code);
        if (existingCode) {
          if (existingCode.status === 'success') {
            return res.redirect(`/admin?shopify=connected&shop=${encodeURIComponent(String(shop))}`);
          }
          if (existingCode.status === 'processing') {
            for (let i = 0; i < 10; i++) {
              await new Promise(resolve => setTimeout(resolve, 500));
              const updated = processedAuthCodes.get(code);
              if (updated?.status === 'success') {
                return res.redirect(`/admin?shopify=connected&shop=${encodeURIComponent(String(shop))}`);
              }
              if (updated?.status === 'failed') break;
            }
          }
        }
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'processing' });
      }

      if (state !== (req.session as any)?.oauthState) {
        console.error('[Shopify OAuth] State mismatch');
        if (code && typeof code === 'string') {
          processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
        }
        return res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Session expired. Please try again.')}`);
      }

      if (!shop || !code || typeof shop !== 'string' || typeof code !== 'string') {
        return res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Missing OAuth parameters')}`);
      }

      const shopDomain = shop.toLowerCase().trim();
      const apiKey = process.env.SHOPIFY_API_KEY;
      const apiSecret = process.env.SHOPIFY_API_SECRET;

      if (hmac && apiSecret) {
        const queryParams = { ...req.query } as Record<string, any>;
        delete queryParams.hmac;
        delete queryParams.__clerk_handshake;

        const message = Object.keys(queryParams)
          .sort()
          .map(key => `${key}=${queryParams[key]}`)
          .join('&');

        const hash = crypto.createHmac('sha256', apiSecret)
          .update(message)
          .digest('hex');

        const hashBuffer = Buffer.from(hash, 'hex');
        const hmacBuffer = Buffer.from(String(hmac), 'hex');
        if (hashBuffer.length !== hmacBuffer.length || !crypto.timingSafeEqual(hashBuffer, hmacBuffer)) {
          console.error('[Shopify OAuth] HMAC verification failed');
          return res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Security verification failed')}`);
        }
      }

      const tokenBody = new URLSearchParams({
        client_id: apiKey || '',
        client_secret: apiSecret || '',
        code: code,
      });

      const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorBody}`);
      }

      const tokenData = await tokenResponse.json() as any;
      const { access_token: accessToken } = tokenData;
      if (!accessToken) {
        throw new Error('No access token received from Shopify');
      }

      const shopifyService = new ShopifyService(shopDomain, accessToken);
      const shopInfo = await shopifyService.getShopInfo().catch(() => null);

      let encryptedToken: string;
      try {
        encryptedToken = encryptToken(accessToken);
      } catch {
        encryptedToken = accessToken;
      }

      const existing = await db.select()
        .from(shops)
        .where(eq(shops.shopDomain, shopDomain))
        .limit(1);

      if (existing.length > 0) {
        await db.update(shops)
          .set({
            accessToken: encryptedToken,
            isActive: true,
            shopName: shopInfo?.name || existing[0].shopName,
            shopEmail: shopInfo?.email || existing[0].shopEmail,
            currency: shopInfo?.currencyCode || existing[0].currency,
            timezone: shopInfo?.timezoneAbbreviation || existing[0].timezone,
            updatedAt: new Date(),
          })
          .where(eq(shops.shopDomain, shopDomain));
      } else {
        await db.insert(shops).values({
          shopDomain,
          accessToken: encryptedToken,
          isActive: true,
          shopName: shopInfo?.name || null,
          shopEmail: shopInfo?.email || null,
          currency: shopInfo?.currencyCode || 'USD',
          timezone: shopInfo?.timezoneAbbreviation || null,
        });
      }

      const userId = (req.session as any)?.oauthUserId;
      if (userId) {
        const existingLink = await db.select()
          .from(userShops)
          .where(and(eq(userShops.userId, userId), eq(userShops.shopDomain, shopDomain)))
          .limit(1);

        if (!existingLink || existingLink.length === 0) {
          await db.insert(userShops).values({ userId, shopDomain });
        }
        delete (req.session as any).oauthUserId;
      }

      delete (req.session as any).oauthState;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => err ? reject(err) : resolve());
      });

      if (code) {
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'success' });
      }

      res.redirect(`/admin?shopify=connected&shop=${encodeURIComponent(shopDomain)}`);
    } catch (error) {
      const { code } = req.query;
      if (code && typeof code === 'string') {
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
      }
      console.error('[Shopify OAuth] Callback error:', error);
      if (!res.headersSent) {
        res.redirect(`/admin?shopify=error&message=${encodeURIComponent('Connection failed. Please try again.')}`);
      }
    }
  });

  app.get("/api/shopify/shops", isAuthenticated, async (req: any, res) => {
    try {
      const allShops = await db.select({
        id: shops.id,
        shopDomain: shops.shopDomain,
        shopName: shops.shopName,
        shopEmail: shops.shopEmail,
        currency: shops.currency,
        timezone: shops.timezone,
        isActive: shops.isActive,
        lastSyncAt: shops.lastSyncAt,
        createdAt: shops.createdAt,
      }).from(shops).where(eq(shops.isActive, true));

      res.json(allShops);
    } catch (error) {
      console.error("Error fetching shops:", error);
      res.status(500).json({ message: "Failed to fetch connected shops" });
    }
  });

  app.post("/api/shopify/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const { shopDomain: domain } = req.body;
      if (!domain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      await db.update(shops)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(shops.shopDomain, domain.toLowerCase().trim()));

      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting shop:", error);
      res.status(500).json({ message: "Failed to disconnect shop" });
    }
  });

  app.post("/api/shopify/sync-sales", isAuthenticated, async (req: any, res) => {
    try {
      const { shopDomain: domain, daysBack = 365 } = req.body;
      if (!domain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const credentials = await getShopifyCredentials(domain);
      if (!credentials) {
        return res.status(400).json({ error: "No credentials found for this shop" });
      }

      const shopifyService = new ShopifyService(credentials.shopDomain, credentials.accessToken);

      const now = new Date();
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

      const orders = await shopifyService.getOrders({
        first: 250,
        createdAtMin: startDate.toISOString(),
        createdAtMax: now.toISOString(),
        maxPages: 20,
      });

      const dailyAggregation: Record<string, {
        date: Date;
        dayOfWeek: number;
        orderCount: number;
        totalRevenue: number;
        itemCount: number;
      }> = {};

      for (const order of orders) {
        const orderDate = new Date(order.createdAt);
        const dateKey = orderDate.toISOString().split('T')[0];

        if (!dailyAggregation[dateKey]) {
          const d = new Date(dateKey + 'T00:00:00Z');
          dailyAggregation[dateKey] = {
            date: d,
            dayOfWeek: d.getUTCDay(),
            orderCount: 0,
            totalRevenue: 0,
            itemCount: 0,
          };
        }

        dailyAggregation[dateKey].orderCount++;
        dailyAggregation[dateKey].totalRevenue += parseFloat(order.totalPriceSet?.shopMoney?.amount || '0');

        for (const lineItem of (order.lineItems?.nodes || [])) {
          dailyAggregation[dateKey].itemCount += lineItem.quantity || 1;
        }
      }

      let syncedDays = 0;
      for (const [dateKey, dayData] of Object.entries(dailyAggregation)) {
        const existing = await db.select()
          .from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, credentials.shopDomain),
            eq(shopifyDailySales.date, dayData.date)
          ))
          .limit(1);

        const avgOrderValue = dayData.orderCount > 0
          ? Math.round((dayData.totalRevenue / dayData.orderCount) * 100) / 100
          : 0;

        if (existing.length > 0) {
          await db.update(shopifyDailySales)
            .set({
              orderCount: dayData.orderCount,
              totalRevenue: String(Math.round(dayData.totalRevenue * 100) / 100),
              itemCount: dayData.itemCount,
              averageOrderValue: String(avgOrderValue),
              dayOfWeek: dayData.dayOfWeek,
            })
            .where(eq(shopifyDailySales.id, existing[0].id));
        } else {
          await db.insert(shopifyDailySales).values({
            shopDomain: credentials.shopDomain,
            date: dayData.date,
            dayOfWeek: dayData.dayOfWeek,
            orderCount: dayData.orderCount,
            totalRevenue: String(Math.round(dayData.totalRevenue * 100) / 100),
            itemCount: dayData.itemCount,
            averageOrderValue: String(avgOrderValue),
          });
        }
        syncedDays++;
      }

      await db.update(shops)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(shops.shopDomain, credentials.shopDomain));

      res.json({
        success: true,
        ordersProcessed: orders.length,
        daysSynced: syncedDays,
        dateRange: {
          from: startDate.toISOString().split('T')[0],
          to: now.toISOString().split('T')[0],
        },
      });
    } catch (error) {
      console.error("Error syncing sales data:", error);
      res.status(500).json({ message: "Failed to sync sales data" });
    }
  });

  app.get("/api/shopify/sales-data", isAuthenticated, async (req: any, res) => {
    try {
      const shopDomain = req.query.shop as string;
      if (!shopDomain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const daysBack = parseInt(req.query.daysBack as string || '365');
      const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(desc(shopifyDailySales.date));

      const dayOfWeekAverages: Record<number, { totalRevenue: number; totalOrders: number; count: number }> = {};
      for (let i = 0; i < 7; i++) {
        dayOfWeekAverages[i] = { totalRevenue: 0, totalOrders: 0, count: 0 };
      }

      let totalRevenue = 0;
      let totalOrders = 0;

      for (const day of salesData) {
        const rev = parseFloat(day.totalRevenue || '0');
        const orders = day.orderCount || 0;
        totalRevenue += rev;
        totalOrders += orders;

        dayOfWeekAverages[day.dayOfWeek].totalRevenue += rev;
        dayOfWeekAverages[day.dayOfWeek].totalOrders += orders;
        dayOfWeekAverages[day.dayOfWeek].count++;
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const weekdayAnalysis = Object.entries(dayOfWeekAverages).map(([dow, data]) => ({
        dayOfWeek: parseInt(dow),
        dayName: dayNames[parseInt(dow)],
        avgRevenue: data.count > 0 ? Math.round((data.totalRevenue / data.count) * 100) / 100 : 0,
        avgOrders: data.count > 0 ? Math.round((data.totalOrders / data.count) * 100) / 100 : 0,
        sampleDays: data.count,
      }));

      res.json({
        dailySales: salesData,
        weekdayAnalysis,
        summary: {
          totalDays: salesData.length,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalOrders,
          avgDailyRevenue: salesData.length > 0 ? Math.round((totalRevenue / salesData.length) * 100) / 100 : 0,
          avgDailyOrders: salesData.length > 0 ? Math.round((totalOrders / salesData.length) * 100) / 100 : 0,
        },
      });
    } catch (error) {
      console.error("Error fetching sales data:", error);
      res.status(500).json({ message: "Failed to fetch sales data" });
    }
  });

  app.get("/api/shopify/staffing-recommendations", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const shopDomain = req.query.shop as string;
      const targetDate = req.query.date as string;

      if (!shopDomain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(desc(shopifyDailySales.date));

      if (salesData.length === 0) {
        return res.json({
          recommendations: [],
          message: "No sales data available. Please sync your Shopify store first.",
        });
      }

      const dayOfWeekStats: Record<number, { revenues: number[]; orders: number[] }> = {};
      for (let i = 0; i < 7; i++) {
        dayOfWeekStats[i] = { revenues: [], orders: [] };
      }

      for (const day of salesData) {
        dayOfWeekStats[day.dayOfWeek].revenues.push(parseFloat(day.totalRevenue || '0'));
        dayOfWeekStats[day.dayOfWeek].orders.push(day.orderCount || 0);
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const weekAnalysis = Object.entries(dayOfWeekStats).map(([dow, stats]) => {
        const avgRev = stats.revenues.length > 0
          ? stats.revenues.reduce((a, b) => a + b, 0) / stats.revenues.length : 0;
        const avgOrders = stats.orders.length > 0
          ? stats.orders.reduce((a, b) => a + b, 0) / stats.orders.length : 0;
        const maxRev = stats.revenues.length > 0 ? Math.max(...stats.revenues) : 0;

        return {
          dayOfWeek: parseInt(dow),
          dayName: dayNames[parseInt(dow)],
          avgRevenue: Math.round(avgRev * 100) / 100,
          avgOrders: Math.round(avgOrders * 100) / 100,
          maxRevenue: Math.round(maxRev * 100) / 100,
          sampleSize: stats.revenues.length,
        };
      });

      const allAvgRevenues = weekAnalysis.map(d => d.avgRevenue);
      const overallAvg = allAvgRevenues.reduce((a, b) => a + b, 0) / allAvgRevenues.length;

      const recommendations = weekAnalysis.map(day => {
        const ratio = overallAvg > 0 ? day.avgRevenue / overallAvg : 1;
        let staffingLevel: string;
        let staffMultiplier: number;

        if (ratio >= 1.4) {
          staffingLevel = 'high';
          staffMultiplier = 1.5;
        } else if (ratio >= 1.15) {
          staffingLevel = 'above_average';
          staffMultiplier = 1.25;
        } else if (ratio >= 0.85) {
          staffingLevel = 'normal';
          staffMultiplier = 1.0;
        } else if (ratio >= 0.6) {
          staffingLevel = 'below_average';
          staffMultiplier = 0.75;
        } else {
          staffingLevel = 'low';
          staffMultiplier = 0.5;
        }

        return {
          ...day,
          staffingLevel,
          staffMultiplier,
          revenueRatio: Math.round(ratio * 100) / 100,
        };
      });

      let aiInsight = '';
      try {
        const prompt = `You are a staffing advisor for a retail business. Based on the following weekly sales pattern data from last year, provide a brief 2-3 sentence recommendation for optimal staffing.

Sales data by day of week:
${recommendations.map(r => `${r.dayName}: avg $${r.avgRevenue} revenue, ${r.avgOrders} orders (${r.staffingLevel} staffing recommended)`).join('\n')}

Overall average daily revenue: $${Math.round(overallAvg * 100) / 100}

${targetDate ? `The user is specifically asking about scheduling for ${targetDate}.` : 'Provide a general weekly staffing overview.'}

Keep your response concise, practical, and focused on actionable staffing advice.`;

        const response = await claudeService.chat(prompt);
        aiInsight = response || '';
      } catch (aiError) {
        console.error('AI insight generation failed:', aiError);
        aiInsight = 'AI analysis unavailable. Review the day-by-day breakdown below to plan your staffing.';
      }

      res.json({
        recommendations,
        aiInsight,
        overallAvgRevenue: Math.round(overallAvg * 100) / 100,
        dataPoints: salesData.length,
      });
    } catch (error) {
      console.error("Error generating staffing recommendations:", error);
      res.status(500).json({ message: "Failed to generate staffing recommendations" });
    }
  });

  app.get("/api/shopify/labor-cost-ratio", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canView = userPermissions.some(p => p.name === 'admin.manage_all');

      if (!canView) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const shopDomain = req.query.shop as string;
      if (!shopDomain) {
        return res.status(400).json({ error: "Shop domain required" });
      }

      const daysBack = parseInt(req.query.daysBack as string || '30');
      const now = new Date();
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(shopifyDailySales.date);

      const allTimeEntries = await storage.getAllTimeEntries(startDate, now);
      const allUsers = await db.select().from(users).where(eq(users.isActive, true));

      const userRateMap = new Map<string, number>();
      allUsers.forEach(u => {
        userRateMap.set(u.id, parseFloat(u.hourlyRate || '15'));
      });

      const revenueByDate = new Map<string, number>();
      for (const day of salesData) {
        const dateKey = new Date(day.date).toISOString().split('T')[0];
        revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + parseFloat(day.totalRevenue || '0'));
      }

      const laborByDate = new Map<string, number>();
      for (const entry of allTimeEntries) {
        if (!entry.clockOutTime) continue;
        const clockIn = new Date(entry.clockInTime);
        const clockOut = new Date(entry.clockOutTime);
        const hours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes || 0) / 60);
        const rate = userRateMap.get(entry.userId) || 15;
        const dateKey = clockIn.toISOString().split('T')[0];
        laborByDate.set(dateKey, (laborByDate.get(dateKey) || 0) + hours * rate);
      }

      const allDates = new Set([...revenueByDate.keys(), ...laborByDate.keys()]);
      const dailyBreakdown = Array.from(allDates)
        .sort()
        .map(date => {
          const revenue = Math.round((revenueByDate.get(date) || 0) * 100) / 100;
          const laborCost = Math.round((laborByDate.get(date) || 0) * 100) / 100;
          const percentage = revenue > 0 ? Math.round((laborCost / revenue) * 10000) / 100 : 0;
          return { date, revenue, laborCost, percentage };
        });

      const totalRevenue = dailyBreakdown.reduce((sum, d) => sum + d.revenue, 0);
      const totalLaborCost = dailyBreakdown.reduce((sum, d) => sum + d.laborCost, 0);
      const laborCostPercentage = totalRevenue > 0
        ? Math.round((totalLaborCost / totalRevenue) * 10000) / 100
        : 0;

      res.json({
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
        laborCostPercentage,
        daysBack,
        dailyBreakdown,
      });
    } catch (error) {
      console.error("Error calculating labor cost ratio:", error);
      res.status(500).json({ message: "Failed to calculate labor cost ratio" });
    }
  });
}
