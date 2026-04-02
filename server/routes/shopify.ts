import type { Express, Response } from "express";
import type { IStorage } from "../storage";
import { shops, userShops, shopifyDailySales, shopifyOrders, users } from "@shared/schema";
import { eq, and, or, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "../db";
import crypto from "crypto";
import { ShopifyService } from "../services/shopifyService";
import { claudeService } from "../services/claudeService";
import { encryptToken, decryptToken } from "../utils/tokenEncryption";
import rateLimit from "express-rate-limit";
import { config } from "../lib/config";

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many AI requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const processedAuthCodes = new Map<string, { timestamp: number; status: string }>();
const oauthStates = new Map<string, { userId: string; timestamp: number }>();
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(processedAuthCodes.entries());
  entries.forEach(([code, data]) => {
    if (now - data.timestamp > 600000) processedAuthCodes.delete(code);
  });
  const stateEntries = Array.from(oauthStates.entries());
  stateEntries.forEach(([state, data]) => {
    if (now - data.timestamp > 600000) oauthStates.delete(state);
  });
}, 300000);

function getAppUrl(requestHostname?: string): string {
  if (config.server.appUrl) {
    return config.server.appUrl.replace(/\/$/, "");
  }
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const primaryDomain = replitDomains.split(",")[0].trim();
    return `https://${primaryDomain}`;
  }
  if (requestHostname) {
    const protocol = requestHostname.includes('replit.dev')
      || requestHostname.includes('.replit.app') ? 'https' : 'http';
    return `${protocol}://${requestHostname}`;
  }
  return 'http://localhost:5000';
}

function getProductionWebhookUrl(): string | null {
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS.split(',');
    const primaryDomain = domains[0]?.trim();
    if (primaryDomain) {
      return `https://${primaryDomain}/api/webhooks/shopify`;
    }
  }
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/api/webhooks/shopify`;
  }
  return null;
}

function verifyShopifyWebhookHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const hashBuffer = Buffer.from(hash, 'base64');
  const hmacBuffer = Buffer.from(hmacHeader, 'base64');
  if (hashBuffer.length !== hmacBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
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
  app.post("/api/webhooks/shopify", async (req: any, res) => {
    try {
      const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
      const shopDomain = req.headers['x-shopify-shop-domain'] as string;
      const topic = req.headers['x-shopify-topic'] as string;

      if (!hmacHeader || !shopDomain || !topic) {
        return res.status(401).json({ error: "Missing required webhook headers" });
      }

      const apiSecret = config.shopify.apiSecret;
      if (!apiSecret) {
        console.error('[Shopify Webhook] API secret not configured');
        return res.status(500).json({ error: "Webhook validation not configured" });
      }

      const rawBody: Buffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
      if (!verifyShopifyWebhookHmac(rawBody, hmacHeader, apiSecret)) {
        console.warn(`[Shopify Webhook] HMAC verification failed for shop: ${shopDomain}`);
        return res.status(401).json({ error: "Webhook signature verification failed" });
      }

      res.status(200).json({ received: true });

      if (topic === 'app/uninstalled') {
        try {
          const normalizedDomain = shopDomain.trim().toLowerCase();
          await db.update(shops)
            .set({ isActive: false, accessToken: null, updatedAt: new Date() })
            .where(eq(shops.shopDomain, normalizedDomain));
          console.log(`[Shopify Webhook] app/uninstalled: deactivated shop ${normalizedDomain}`);
        } catch (processingError) {
          console.error('[Shopify Webhook] Error processing app/uninstalled payload:', processingError);
        }
      }

      if (topic === 'orders/create') {
        const order = req.body;
        try {
          const normalizedDomain = shopDomain.trim().toLowerCase();
          const orderDate = new Date(order.created_at);
          const dateKey = orderDate.toISOString().split('T')[0];
          const date = new Date(dateKey + 'T00:00:00Z');
          const dayOfWeek = date.getUTCDay();

          const orderTotal = parseFloat(order.total_price || order.subtotal_price || '0');
          let itemCount = 0;
          if (order.line_items && Array.isArray(order.line_items)) {
            for (const item of order.line_items) {
              itemCount += item.quantity || 1;
            }
          }

          const existing = await db.select()
            .from(shopifyDailySales)
            .where(and(
              eq(shopifyDailySales.shopDomain, normalizedDomain),
              eq(shopifyDailySales.date, date)
            ))
            .limit(1);

          if (existing.length > 0) {
            const currentOrderCount = existing[0].orderCount || 0;
            const currentRevenue = parseFloat(existing[0].totalRevenue || '0');
            const currentItems = existing[0].itemCount || 0;
            const newOrderCount = currentOrderCount + 1;
            const newRevenue = currentRevenue + orderTotal;
            const newItems = currentItems + itemCount;
            const newAvgOrderValue = newOrderCount > 0 ? Math.round((newRevenue / newOrderCount) * 100) / 100 : 0;

            await db.update(shopifyDailySales)
              .set({
                orderCount: newOrderCount,
                totalRevenue: String(Math.round(newRevenue * 100) / 100),
                itemCount: newItems,
                averageOrderValue: String(newAvgOrderValue),
              })
              .where(eq(shopifyDailySales.id, existing[0].id));
          } else {
            const avgOrderValue = Math.round(orderTotal * 100) / 100;
            await db.insert(shopifyDailySales).values({
              shopDomain: normalizedDomain,
              date,
              dayOfWeek,
              orderCount: 1,
              totalRevenue: String(Math.round(orderTotal * 100) / 100),
              itemCount,
              averageOrderValue: String(avgOrderValue),
            });
          }

          await db.update(shops)
            .set({ lastSyncAt: new Date(), updatedAt: new Date() })
            .where(eq(shops.shopDomain, normalizedDomain));

          console.log(`[Shopify Webhook] Processed orders/create for ${normalizedDomain} on ${dateKey}`);
        } catch (processingError) {
          console.error('[Shopify Webhook] Error processing order payload:', processingError);
        }
      }
    } catch (error) {
      console.error('[Shopify Webhook] Handler error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/api/shopify/auth", isAuthenticated, async (req: any, res) => {
    try {
      const shop = req.query.shop as string;
      if (!shop) {
        return res.status(400).json({ error: "Shop domain is required" });
      }

      const shopDomain = shop.includes('.myshopify.com')
        ? shop.trim().toLowerCase()
        : `${shop.trim().toLowerCase()}.myshopify.com`;

      const apiKey = config.shopify.apiKey;
      if (!apiKey) {
        return res.status(500).json({ error: "Shopify API key not configured" });
      }

      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.set(state, { userId: req.user.id, timestamp: Date.now() });

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
            return res.redirect(`/shopify-callback-success?shop=${encodeURIComponent(String(shop))}`);
          }
          if (existingCode.status === 'processing') {
            for (let i = 0; i < 10; i++) {
              await new Promise(resolve => setTimeout(resolve, 500));
              const updated = processedAuthCodes.get(code);
              if (updated?.status === 'success') {
                return res.redirect(`/shopify-callback-success?shop=${encodeURIComponent(String(shop))}`);
              }
              if (updated?.status === 'failed') break;
            }
          }
        }
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'processing' });
      }

      const stateData = state && typeof state === 'string' ? oauthStates.get(state) : null;
      if (!stateData) {
        console.error('[Shopify OAuth] State mismatch or expired');
        if (code && typeof code === 'string') {
          processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
        }
        return res.redirect(`/shopify-callback-success?error=1&message=${encodeURIComponent('Session expired. Please try again.')}`);
      }
      oauthStates.delete(state as string);

      if (!shop || !code || typeof shop !== 'string' || typeof code !== 'string') {
        return res.redirect(`/shopify-callback-success?error=1&message=${encodeURIComponent('Missing OAuth parameters')}`);
      }

      const shopDomain = shop.toLowerCase().trim();
      const apiKey = config.shopify.apiKey;
      const apiSecret = config.shopify.apiSecret;

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
          return res.redirect(`/shopify-callback-success?error=1&message=${encodeURIComponent('Security verification failed')}`);
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

      const userId = stateData.userId;
      if (userId) {
        const existingLink = await db.select()
          .from(userShops)
          .where(and(eq(userShops.userId, userId), eq(userShops.shopDomain, shopDomain)))
          .limit(1);

        if (!existingLink || existingLink.length === 0) {
          await db.insert(userShops).values({ userId, shopDomain });
        }
      }

      if (code) {
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'success' });
      }

      const webhookUrl = getProductionWebhookUrl();
      if (webhookUrl) {
        try {
          const shopifyService = new ShopifyService(shopDomain, accessToken);
          const webhooksToRegister = ['orders/create', 'app/uninstalled'];
          for (const webhookTopic of webhooksToRegister) {
            try {
              const webhookResult = await shopifyService.registerWebhook(webhookUrl, webhookTopic);
              if (webhookResult?.userErrors?.length > 0) {
                console.warn(`[Shopify OAuth] Webhook registration warnings for ${webhookTopic}:`, webhookResult.userErrors);
              } else {
                console.log(`[Shopify OAuth] Webhook registered for ${shopDomain} topic=${webhookTopic} -> ${webhookUrl}`);
              }
            } catch (topicError) {
              console.error(`[Shopify OAuth] Webhook registration failed for topic ${webhookTopic} (non-fatal):`, topicError);
            }
          }
        } catch (webhookError) {
          console.error('[Shopify OAuth] Webhook registration failed (non-fatal):', webhookError);
        }
      } else {
        console.log('[Shopify OAuth] Skipping webhook registration: no production URL available');
      }

      res.redirect(`/shopify-callback-success?shop=${encodeURIComponent(shopDomain)}`);
    } catch (error) {
      const { code } = req.query;
      if (code && typeof code === 'string') {
        processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
      }
      console.error('[Shopify OAuth] Callback error:', error);
      if (!res.headersSent) {
        res.redirect(`/shopify-callback-success?error=1&message=${encodeURIComponent('Connection failed. Please try again.')}`);
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

      const allDates = new Set([...Array.from(revenueByDate.keys()), ...Array.from(laborByDate.keys())]);
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

  app.get("/api/shopify/yoy-comparison", isAuthenticated, async (req: any, res) => {
    try {
      const shopDomain = req.query.shop as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (!shopDomain || !startDate || !endDate) {
        return res.status(400).json({ error: "Shop domain, startDate, and endDate are required" });
      }

      const domain = shopDomain.toLowerCase().trim();
      const currentStart = new Date(startDate + 'T00:00:00Z');
      const currentEnd = new Date(endDate + 'T23:59:59Z');

      const prevStart = new Date(currentStart);
      prevStart.setFullYear(prevStart.getFullYear() - 1);
      const prevEnd = new Date(currentEnd);
      prevEnd.setFullYear(prevEnd.getFullYear() - 1);

      const [currentYearSales, previousYearSales] = await Promise.all([
        db.select().from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, domain),
            gte(shopifyDailySales.date, currentStart),
            lte(shopifyDailySales.date, currentEnd)
          ))
          .orderBy(shopifyDailySales.date),
        db.select().from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, domain),
            gte(shopifyDailySales.date, prevStart),
            lte(shopifyDailySales.date, prevEnd)
          ))
          .orderBy(shopifyDailySales.date),
      ]);

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const formatDay = (sale: any) => ({
        date: new Date(sale.date).toISOString().split('T')[0],
        dayOfWeek: sale.dayOfWeek,
        dayName: dayNames[sale.dayOfWeek],
        revenue: parseFloat(sale.totalRevenue || '0'),
        orders: sale.orderCount || 0,
        items: sale.itemCount || 0,
        avgOrderValue: parseFloat(sale.averageOrderValue || '0'),
      });

      const currentDays = currentYearSales.map(formatDay);
      const previousDays = previousYearSales.map(formatDay);

      const currentTotal = currentDays.reduce((s, d) => s + d.revenue, 0);
      const previousTotal = previousDays.reduce((s, d) => s + d.revenue, 0);
      const currentOrders = currentDays.reduce((s, d) => s + d.orders, 0);
      const previousOrders = previousDays.reduce((s, d) => s + d.orders, 0);

      const revenueGrowth = previousTotal > 0
        ? Math.round(((currentTotal - previousTotal) / previousTotal) * 10000) / 100
        : null;
      const orderGrowth = previousOrders > 0
        ? Math.round(((currentOrders - previousOrders) / previousOrders) * 10000) / 100
        : null;

      res.json({
        currentYear: {
          startDate,
          endDate,
          days: currentDays,
          totalRevenue: Math.round(currentTotal * 100) / 100,
          totalOrders: currentOrders,
          avgDailyRevenue: currentDays.length > 0 ? Math.round((currentTotal / currentDays.length) * 100) / 100 : 0,
        },
        previousYear: {
          startDate: prevStart.toISOString().split('T')[0],
          endDate: prevEnd.toISOString().split('T')[0],
          days: previousDays,
          totalRevenue: Math.round(previousTotal * 100) / 100,
          totalOrders: previousOrders,
          avgDailyRevenue: previousDays.length > 0 ? Math.round((previousTotal / previousDays.length) * 100) / 100 : 0,
        },
        trends: {
          revenueGrowthPercent: revenueGrowth,
          orderGrowthPercent: orderGrowth,
          hasCurrentData: currentDays.length > 0,
          hasPreviousData: previousDays.length > 0,
        },
      });
    } catch (error) {
      console.error("Error fetching YoY comparison:", error);
      res.status(500).json({ message: "Failed to fetch year-over-year comparison" });
    }
  });

  app.get("/api/shopify/ai-staffing", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const shopDomain = req.query.shop as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (!shopDomain || !startDate || !endDate) {
        return res.status(400).json({ error: "Shop domain, startDate, and endDate are required" });
      }

      const domain = shopDomain.toLowerCase().trim();
      const currentStart = new Date(startDate + 'T00:00:00Z');
      const currentEnd = new Date(endDate + 'T23:59:59Z');
      const prevStart = new Date(currentStart);
      prevStart.setFullYear(prevStart.getFullYear() - 1);
      const prevEnd = new Date(currentEnd);
      prevEnd.setFullYear(prevEnd.getFullYear() - 1);

      const [previousYearSales, historicalSales, activeEmployees] = await Promise.all([
        db.select().from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, domain),
            gte(shopifyDailySales.date, prevStart),
            lte(shopifyDailySales.date, prevEnd)
          ))
          .orderBy(shopifyDailySales.date),
        db.select().from(shopifyDailySales)
          .where(and(
            eq(shopifyDailySales.shopDomain, domain),
            gte(shopifyDailySales.date, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))
          ))
          .orderBy(desc(shopifyDailySales.date)),
        db.select().from(users).where(eq(users.isActive, true)),
      ]);

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const teamSize = activeEmployees.length;

      const dayOfWeekAvg: Record<number, { revenues: number[]; orders: number[] }> = {};
      for (let i = 0; i < 7; i++) dayOfWeekAvg[i] = { revenues: [], orders: [] };
      for (const day of historicalSales) {
        dayOfWeekAvg[day.dayOfWeek].revenues.push(parseFloat(day.totalRevenue || '0'));
        dayOfWeekAvg[day.dayOfWeek].orders.push(day.orderCount || 0);
      }

      const prevDayData = previousYearSales.map(d => ({
        date: new Date(d.date).toISOString().split('T')[0],
        dayName: dayNames[d.dayOfWeek],
        dayOfWeek: d.dayOfWeek,
        revenue: parseFloat(d.totalRevenue || '0'),
        orders: d.orderCount || 0,
      }));

      const scheduleDays: string[] = [];
      const cursor = new Date(currentStart);
      while (cursor <= currentEnd) {
        scheduleDays.push(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 1);
      }

      const scheduleDayDetails = scheduleDays.map(dateStr => {
        const d = new Date(dateStr + 'T00:00:00Z');
        const dow = d.getUTCDay();
        const lastYearDate = new Date(d);
        lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
        const lastYearKey = lastYearDate.toISOString().split('T')[0];
        const lastYearMatch = prevDayData.find(p => p.date === lastYearKey);

        const dowAvgRev = dayOfWeekAvg[dow].revenues.length > 0
          ? dayOfWeekAvg[dow].revenues.reduce((a, b) => a + b, 0) / dayOfWeekAvg[dow].revenues.length : 0;
        const dowAvgOrders = dayOfWeekAvg[dow].orders.length > 0
          ? dayOfWeekAvg[dow].orders.reduce((a, b) => a + b, 0) / dayOfWeekAvg[dow].orders.length : 0;

        return {
          date: dateStr,
          dayName: dayNames[dow],
          dayOfWeek: dow,
          lastYearRevenue: lastYearMatch?.revenue || null,
          lastYearOrders: lastYearMatch?.orders || null,
          avgDowRevenue: Math.round(dowAvgRev * 100) / 100,
          avgDowOrders: Math.round(dowAvgOrders * 100) / 100,
          dataSamples: dayOfWeekAvg[dow].revenues.length,
        };
      });

      let aiRecommendations: any[] = [];
      let aiSummary = '';

      try {
        const prompt = `You are a staffing advisor for a boutique retail business. Based on the following data, recommend specific employee counts for each day in the scheduling period.

TEAM SIZE: ${teamSize} total active employees

SCHEDULING PERIOD: ${startDate} to ${endDate}

DATA FOR EACH DAY:
${scheduleDayDetails.map(d => {
  let info = `${d.date} (${d.dayName}):`;
  if (d.lastYearRevenue !== null) {
    info += ` Last year same date: $${d.lastYearRevenue} revenue, ${d.lastYearOrders} orders.`;
  } else {
    info += ` No data for same date last year.`;
  }
  info += ` ${d.dayName} historical average: $${d.avgDowRevenue} revenue, ${d.avgDowOrders} orders (from ${d.dataSamples} samples).`;
  return info;
}).join('\n')}

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "recommendedStaff": <number>,
      "staffingLevel": "high|above_average|normal|below_average|low",
      "reason": "<brief 1-sentence reason>"
    }
  ],
  "summary": "<2-3 sentence overall staffing recommendation>"
}

Rules:
- recommendedStaff must be between 1 and ${teamSize}
- Base recommendations on revenue and order patterns
- Higher revenue days need more staff
- Consider day-of-week patterns when same-date data is missing`;

        const response = await claudeService.chat(prompt);
        if (response) {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            aiRecommendations = parsed.days || [];
            aiSummary = parsed.summary || '';
          }
        }
      } catch (aiError) {
        console.error('AI staffing analysis failed:', aiError);
        aiSummary = 'AI analysis unavailable. Use the historical data below to plan your staffing.';
      }

      const finalDays = scheduleDayDetails.map(day => {
        const aiDay = aiRecommendations.find((r: any) => r.date === day.date);
        return {
          ...day,
          recommendedStaff: aiDay?.recommendedStaff || null,
          staffingLevel: aiDay?.staffingLevel || null,
          reason: aiDay?.reason || null,
        };
      });

      res.json({
        days: finalDays,
        aiSummary,
        teamSize,
        dateRange: { startDate, endDate },
        dataAvailability: {
          previousYearDays: previousYearSales.length,
          historicalDays: historicalSales.length,
        },
      });
    } catch (error) {
      console.error("Error generating AI staffing recommendations:", error);
      res.status(500).json({ message: "Failed to generate staffing recommendations" });
    }
  });

  /**
   * GDPR Mandatory Webhooks — Required for Shopify App Store compliance.
   *
   * All three endpoints validate the Shopify HMAC-SHA256 signature (base64)
   * from the X-Shopify-Hmac-Sha256 header using the SHOPIFY_API_SECRET.
   *
   * Configure in Shopify Partner Dashboard > App setup > GDPR mandatory webhooks:
   *   Customer data request: POST /api/webhooks/shopify/customers/data_request
   *   Customer erasure:      POST /api/webhooks/shopify/customers/redact
   *   Shop erasure:          POST /api/webhooks/shopify/shop/redact
   */

  app.post("/api/webhooks/shopify/customers/data_request", async (req: any, res: Response) => {
    try {
      const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
      const apiSecret = config.shopify.apiSecret;
      const rawBody: Buffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
      if (!apiSecret || !hmacHeader || !verifyShopifyWebhookHmac(rawBody, hmacHeader, apiSecret)) {
        console.warn("[GDPR] Customer data request: HMAC verification failed");
        return res.status(401).json({ error: "Invalid HMAC signature" });
      }

      const { shop_domain, customer, orders_requested } = req.body;
      const normalizedDomain = (shop_domain || "").toLowerCase().trim();
      const customerId: string | null = customer?.id ? String(customer.id) : null;
      const customerEmail: string | null = customer?.email || null;
      const requestedOrderIds: string[] = (orders_requested || []).map((o: any) => String(o.id || o));

      console.log(
        `[GDPR] Customer data request — shop: ${normalizedDomain}, customerId: ${customerId}, email: ${customerEmail}`
      );

      const shopRecord = await db.select({
        shopDomain: shops.shopDomain,
        shopName: shops.shopName,
        isActive: shops.isActive,
        installedAt: shops.installedAt,
      }).from(shops).where(eq(shops.shopDomain, normalizedDomain)).limit(1);

      const salesData = await db.select({
        id: shopifyDailySales.id,
        date: shopifyDailySales.date,
        orderCount: shopifyDailySales.orderCount,
        totalRevenue: shopifyDailySales.totalRevenue,
      }).from(shopifyDailySales).where(eq(shopifyDailySales.shopDomain, normalizedDomain));

      const customerConditions: any[] = [];
      if (customerId) {
        customerConditions.push(
          sql`${shopifyOrders.customerData}->>'id' = ${customerId}`
        );
      }
      if (customerEmail) {
        customerConditions.push(eq(shopifyOrders.email, customerEmail));
      }
      for (const orderId of requestedOrderIds) {
        customerConditions.push(eq(shopifyOrders.orderId, orderId));
      }

      let customerOrderData: any[] = [];
      if (customerConditions.length > 0) {
        customerOrderData = await db.select({
          id: shopifyOrders.id,
          orderId: shopifyOrders.orderId,
          orderNumber: shopifyOrders.orderNumber,
          email: shopifyOrders.email,
          totalPrice: shopifyOrders.totalPrice,
          orderCreatedAt: shopifyOrders.orderCreatedAt,
        }).from(shopifyOrders).where(
          and(eq(shopifyOrders.shopDomain, normalizedDomain), or(...customerConditions)!)
        );
      }

      console.log(`[GDPR] Data held for customer at shop ${normalizedDomain}:`, {
        shopExists: shopRecord.length > 0,
        aggregatedSalesDaysCount: salesData.length,
        customerOrderRecordsCount: customerOrderData.length,
        customerIdentifier: { id: customerId, email: customerEmail },
        requestedOrderIds,
        dataHeld: {
          tables: ["shops", "user_shops", "shopify_daily_sales", "shopify_orders"],
          note: "shopify_daily_sales contains aggregated daily totals (no per-customer PII); shopify_orders may contain customer email and order data.",
        },
      });

      return res.status(200).json({ message: "Data request received and logged" });
    } catch (error) {
      console.error("[GDPR] Customer data request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/webhooks/shopify/customers/redact", async (req: any, res: Response) => {
    try {
      const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
      const apiSecret = config.shopify.apiSecret;
      const rawBody: Buffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
      if (!apiSecret || !hmacHeader || !verifyShopifyWebhookHmac(rawBody, hmacHeader, apiSecret)) {
        console.warn("[GDPR] Customer redact: HMAC verification failed");
        return res.status(401).json({ error: "Invalid HMAC signature" });
      }

      const { shop_domain, customer, orders_to_redact } = req.body;
      const normalizedDomain = (shop_domain || "").toLowerCase().trim();
      const orderIds: string[] = (orders_to_redact || []).map((o: any) => String(o.id || o));
      const customerId: string | null = customer?.id ? String(customer.id) : null;
      const customerEmail: string | null = customer?.email || null;

      console.log(
        `[GDPR] Customer redact request — shop: ${normalizedDomain}, customerId: ${customerId}, email: ${customerEmail}`
      );

      if (orderIds.length > 0) {
        for (const orderId of orderIds) {
          await db.update(shopifyOrders)
            .set({ email: null, customerData: null })
            .where(and(eq(shopifyOrders.shopDomain, normalizedDomain), eq(shopifyOrders.orderId, orderId)));
        }
      }

      const identityConditions: any[] = [];
      if (customerId) {
        identityConditions.push(sql`${shopifyOrders.customerData}->>'id' = ${customerId}`);
      }
      if (customerEmail) {
        identityConditions.push(eq(shopifyOrders.email, customerEmail));
      }
      if (identityConditions.length > 0) {
        await db.update(shopifyOrders)
          .set({ email: null, customerData: null })
          .where(and(eq(shopifyOrders.shopDomain, normalizedDomain), or(...identityConditions)!));
      }

      console.log(`[GDPR] Customer redaction completed for shop: ${normalizedDomain}`, {
        customerId,
        customerEmail,
        orderIdsRedacted: orderIds,
        identityFieldsUsed: [customerId ? "customerId" : null, customerEmail ? "email" : null].filter(Boolean),
      });

      return res.status(200).json({ message: "Customer data redaction request processed" });
    } catch (error) {
      console.error("[GDPR] Customer redact error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/webhooks/shopify/shop/redact", async (req: any, res: Response) => {
    try {
      const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
      const apiSecret = config.shopify.apiSecret;
      const rawBody: Buffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
      if (!apiSecret || !hmacHeader || !verifyShopifyWebhookHmac(rawBody, hmacHeader, apiSecret)) {
        console.warn("[GDPR] Shop redact: HMAC verification failed");
        return res.status(401).json({ error: "Invalid HMAC signature" });
      }

      const { shop_domain } = req.body;
      const normalizedDomain = (shop_domain || "").toLowerCase().trim();

      console.log(`[GDPR] Shop redact request — shop: ${normalizedDomain}`);

      await db.delete(shopifyOrders).where(eq(shopifyOrders.shopDomain, normalizedDomain));
      await db.delete(shopifyDailySales).where(eq(shopifyDailySales.shopDomain, normalizedDomain));
      await db.delete(userShops).where(eq(userShops.shopDomain, normalizedDomain));
      await db.delete(shops).where(eq(shops.shopDomain, normalizedDomain));

      console.log(`[GDPR] Shop redaction completed for: ${normalizedDomain}`, {
        tablesCleared: ["shopify_orders", "shopify_daily_sales", "user_shops", "shops"],
      });

      return res.status(200).json({ message: "Shop data redacted successfully" });
    } catch (error) {
      console.error("[GDPR] Shop redact error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
