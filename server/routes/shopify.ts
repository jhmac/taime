import type { Express, Response } from "express";
import type { IStorage } from "../storage";
import { shops, userShops, shopifyDailySales, shopifyOrders, shopifyReportSchedules, timeEntries, users, companies } from "@shared/schema";
import { eq, and, or, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "../db";
import crypto from "crypto";
import { ShopifyService } from "../services/shopifyService";
import { claudeService } from "../services/claudeService";
import { sendShopifyAnalyticsReport } from "../services/emailService";
import { encryptToken, decryptToken } from "../utils/tokenEncryption";
import rateLimit from "express-rate-limit";
import { config } from "../lib/config";
import { resolvePermission, resolveAnyPermission } from "../services/permissionResolver";

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many AI requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Dedup Shopify's occasional double-callback (in-memory is fine; worst case
// is a harmless second token-exchange attempt that Shopify will reject).
const processedAuthCodes = new Map<string, { timestamp: number; status: string }>();
setInterval(() => {
  const now = Date.now();
  Array.from(processedAuthCodes.entries()).forEach(([code, data]) => {
    if (now - data.timestamp > 600000) processedAuthCodes.delete(code);
  });
}, 300000);

// ── OAuth state: HMAC-signed, stateless — survives server restarts ────────────
// Previously we stored state in an in-memory Map. Any server restart (common
// in Replit's production environment) between auth-init and callback caused
// "session expired" errors. Signed state encodes userId + timestamp in the
// state parameter itself; no server memory required.
const STATE_SECRET =
  config.encryption.sessionSecret ||
  config.shopify.apiSecret ||
  'taime-shopify-state-fallback';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function signOAuthState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}

function verifyOAuthState(state: string): { userId: string } | null {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 32);
  try {
    // Timing-safe comparison prevents timing attacks on state tokens
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'ascii'), Buffer.from(expected, 'ascii'))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || !data.t || typeof data.t !== 'number') return null;
    if (Date.now() - data.t > STATE_TTL_MS) return null; // expired
    return { userId: data.u };
  } catch {
    return null;
  }
}

// ── Callback URL resolution ───────────────────────────────────────────────────
// Priority: (1) explicit APP_URL env var, (2) actual request host header —
// the most reliable signal for the domain the user is actually on —
// (3) REPLIT_DOMAINS fallback (can be an internal domain, not the custom one).
function getAppUrl(req: any): string {
  if (config.server.appUrl) {
    return config.server.appUrl.replace(/\/$/, '');
  }
  const host = req?.get?.('host') as string | undefined;
  if (host && !host.startsWith('localhost')) {
    const proto = (req.get('x-forwarded-proto') as string) || (req.secure ? 'https' : 'http');
    return `${proto}://${host}`;
  }
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    return `https://${replitDomains.split(',')[0].trim()}`;
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

// ── Helper: verify caller owns/is-linked to a shop (mirrors existing auth) ────
async function assertUserShopAccess(userId: string, shopDomain: string): Promise<boolean> {
  const domain = shopDomain.toLowerCase().trim();

  // Primary: explicit userShops link
  const explicit = await db.select({ id: userShops.id })
    .from(userShops)
    .where(and(eq(userShops.userId, userId), eq(userShops.shopDomain, domain)))
    .limit(1);
  if (explicit.length > 0) return true;

  // Fallback: same company owns the shop
  const userRow = await db.select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const userCompanyId = userRow[0]?.companyId;
  if (!userCompanyId) return false;

  const companyShop = await db.select({ shopDomain: shops.shopDomain })
    .from(shops)
    .where(and(eq(shops.shopDomain, domain), eq(shops.companyId, userCompanyId)))
    .limit(1);
  return companyShop.length > 0;
}

// ── Helper: build CSV from daily breakdown ───────────────────────────────────
function buildAnalyticsCsv(dailyBreakdown: { date: string; revenue: number; laborCost: number; percentage: number }[]): string {
  const header = 'Date,Revenue,Labor Cost,Labor %';
  const lines = dailyBreakdown.map(d =>
    [d.date, d.revenue.toFixed(2), d.laborCost.toFixed(2), d.percentage.toFixed(2)].join(',')
  );
  return [header, ...lines].join('\n');
}

// ── Helper: fetch analytics data and send report email ───────────────────────
async function sendScheduledReport(shopDomain: string, frequency: string, recipientEmail: string, userId?: string): Promise<boolean> {
  try {
    const daysBack = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 30;
    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);

    const salesData = await db.select()
      .from(shopifyDailySales)
      .where(and(
        eq(shopifyDailySales.shopDomain, shopDomain.toLowerCase().trim()),
        gte(shopifyDailySales.date, startDate),
      ))
      .orderBy(shopifyDailySales.date);

    const allUsers = await db.select({ id: users.id, hourlyRate: users.hourlyRate }).from(users).where(eq(users.isActive, true));
    const userRateMap = new Map<string, number>();
    allUsers.forEach(u => userRateMap.set(u.id, parseFloat(u.hourlyRate || '15')));

    const timeEntryRows = await db.select().from(timeEntries).where(gte(timeEntries.clockInTime, startDate));

    const revenueByDate = new Map<string, number>();
    for (const day of salesData) {
      const dateKey = new Date(day.date).toISOString().split('T')[0];
      revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + parseFloat(day.totalRevenue || '0'));
    }

    const laborByDate = new Map<string, number>();
    for (const entry of timeEntryRows) {
      if (!entry.clockOutTime) continue;
      const clockIn = new Date(entry.clockInTime);
      const clockOut = new Date(entry.clockOutTime);
      const hours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000 - (entry.breakMinutes || 0) / 60);
      const rate = userRateMap.get(entry.userId) || 15;
      const dateKey = clockIn.toISOString().split('T')[0];
      laborByDate.set(dateKey, (laborByDate.get(dateKey) || 0) + hours * rate);
    }

    const allDates = new Set([...Array.from(revenueByDate.keys()), ...Array.from(laborByDate.keys())]);
    const dailyBreakdown = Array.from(allDates).sort().map(date => {
      const revenue = Math.round((revenueByDate.get(date) || 0) * 100) / 100;
      const laborCost = Math.round((laborByDate.get(date) || 0) * 100) / 100;
      const percentage = revenue > 0 ? Math.round((laborCost / revenue) * 10000) / 100 : 0;
      return { date, revenue, laborCost, percentage };
    });

    const totalRevenue = Math.round(dailyBreakdown.reduce((s, d) => s + d.revenue, 0) * 100) / 100;
    const totalLaborCost = Math.round(dailyBreakdown.reduce((s, d) => s + d.laborCost, 0) * 100) / 100;
    const laborCostPercentage = totalRevenue > 0
      ? Math.round((totalLaborCost / totalRevenue) * 10000) / 100
      : 0;

    const csvContent = buildAnalyticsCsv(dailyBreakdown);
    return await sendShopifyAnalyticsReport(recipientEmail, shopDomain, frequency, csvContent, {
      totalRevenue, totalLaborCost, laborCostPercentage, daysBack,
    });
  } catch (err) {
    console.error('[ReportSchedule] sendScheduledReport error:', err);
    return false;
  }
}

// ── Scheduler: check and send due reports every hour ─────────────────────────
export function startShopifyReportScheduler(): () => void {
  async function runScheduler() {
    try {
      const schedules = await db.select().from(shopifyReportSchedules).where(eq(shopifyReportSchedules.enabled, true));
      const now = new Date();

      for (const schedule of schedules) {
        const lastSent = schedule.lastSentAt ? new Date(schedule.lastSentAt) : null;
        let isDue = false;

        if (schedule.frequency === 'daily') {
          isDue = !lastSent || (now.getTime() - lastSent.getTime()) >= 24 * 60 * 60 * 1000;
        } else if (schedule.frequency === 'weekly') {
          isDue = !lastSent || (now.getTime() - lastSent.getTime()) >= 7 * 24 * 60 * 60 * 1000;
        } else if (schedule.frequency === 'monthly') {
          isDue = !lastSent || (now.getTime() - lastSent.getTime()) >= 30 * 24 * 60 * 60 * 1000;
        }

        if (isDue) {
          console.log(`[ReportScheduler] Sending ${schedule.frequency} report for ${schedule.shopDomain} to ${schedule.recipientEmail}`);
          const sent = await sendScheduledReport(schedule.shopDomain, schedule.frequency, schedule.recipientEmail);
          if (sent) {
            await db.update(shopifyReportSchedules)
              .set({ lastSentAt: now, updatedAt: now })
              .where(eq(shopifyReportSchedules.id, schedule.id));
          }
        }
      }
    } catch (err) {
      console.error('[ReportScheduler] Error during scheduled run:', err);
    }
  }

  // Run immediately (after migrations have created the table), then every hour
  runScheduler();
  const intervalId = setInterval(runScheduler, 60 * 60 * 1000);
  console.log('[ReportScheduler] Shopify analytics report scheduler started');

  // Return a stop function for graceful shutdown
  return () => {
    clearInterval(intervalId);
    console.log('[ReportScheduler] Shopify analytics report scheduler stopped');
  };
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

          // Idempotency: Shopify retries webhooks (e.g. on transient 5xx),
          // and a naive +1 increment per delivery would double-count. Insert
          // the per-order row first with onConflictDoNothing on the
          // (shop_domain, order_id) unique index — if 0 rows are returned
          // the order is already recorded, so skip the aggregate update.
          // This also keeps shopify_orders authoritative for the per-order
          // sum used by /historical-sales.
          const rawOrderId = String(order.id ?? order.admin_graphql_api_id ?? '');
          const orderId = rawOrderId.includes('/') ? rawOrderId.split('/').pop()! : rawOrderId;
          if (!orderId) {
            console.warn(`[Shopify Webhook] orders/create missing id; skipping aggregate update`);
          } else {
            const insertedOrder = await db.insert(shopifyOrders)
              .values({
                shopDomain: normalizedDomain,
                orderId,
                orderNumber: order.name ?? order.order_number?.toString() ?? null,
                totalPrice: String(Math.round(orderTotal * 100) / 100),
                currency: order.currency ?? 'USD',
                financialStatus: order.financial_status ?? null,
                fulfillmentStatus: order.fulfillment_status ?? null,
                lineItems: (order.line_items ?? []) as any,
                customerData: null,
                orderCreatedAt: orderDate,
              })
              .onConflictDoNothing({ target: [shopifyOrders.shopDomain, shopifyOrders.orderId] })
              .returning({ id: shopifyOrders.id });

            if (insertedOrder.length === 0) {
              console.log(`[Shopify Webhook] orders/create duplicate for ${normalizedDomain}/${orderId} — skipping aggregate increment`);
            } else {
              // Atomic incremental upsert keyed on (shop_domain, date) — see
              // uq_shopify_daily_sales_shop_date.
              await db.insert(shopifyDailySales)
                .values({
                  shopDomain: normalizedDomain,
                  date,
                  dayOfWeek,
                  orderCount: 1,
                  totalRevenue: String(Math.round(orderTotal * 100) / 100),
                  itemCount,
                  averageOrderValue: String(Math.round(orderTotal * 100) / 100),
                })
                .onConflictDoUpdate({
                  target: [shopifyDailySales.shopDomain, shopifyDailySales.date],
                  set: {
                    orderCount: sql`COALESCE(${shopifyDailySales.orderCount}, 0) + 1`,
                    totalRevenue: sql`ROUND((COALESCE(${shopifyDailySales.totalRevenue}, 0) + ${orderTotal})::numeric, 2)`,
                    itemCount: sql`COALESCE(${shopifyDailySales.itemCount}, 0) + ${itemCount}`,
                    averageOrderValue: sql`ROUND(((COALESCE(${shopifyDailySales.totalRevenue}, 0) + ${orderTotal}) / (COALESCE(${shopifyDailySales.orderCount}, 0) + 1))::numeric, 2)`,
                  },
                });
            }
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

      // Signed state — no server memory required; survives restarts
      const state = signOAuthState(req.user.id);

      const baseUrl = getAppUrl(req);
      const redirectUri = `${baseUrl}/api/shopify/auth/callback`;
      console.log(`[Shopify OAuth] Initiating for shop=${shopDomain} redirectUri=${redirectUri}`);
      const scopes = 'read_orders,read_products,read_cash_tracking';

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
      console.log(`[Shopify OAuth] Callback received — shop=${shop}, hasCode=${!!code}, hasState=${!!state}, hasHmac=${!!hmac}, host=${req.get('host')}`);

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

      // Verify signed state — no in-memory map required; survives server restarts
      const stateData = state && typeof state === 'string' ? verifyOAuthState(state) : null;
      if (!stateData) {
        console.error('[Shopify OAuth] State verification failed (invalid signature, expired, or missing)');
        if (code && typeof code === 'string') {
          processedAuthCodes.set(code, { timestamp: Date.now(), status: 'failed' });
        }
        return res.redirect(`/shopify-callback-success?error=1&message=${encodeURIComponent('Session expired. Please try again.')}`);
      }

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

      // Resolve the installing user's company so we can scope the shop to the right tenant
      const userId = stateData.userId;
      let installingUserCompanyId: string | null = null;
      if (userId) {
        const installingUser = await db.select({ companyId: users.companyId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        installingUserCompanyId = installingUser[0]?.companyId ?? null;

        // If user has no company yet, seed the default company and link them
        if (!installingUserCompanyId) {
          const defaultCompany = await db.select({ id: companies.id }).from(companies).limit(1);
          if (defaultCompany.length > 0) {
            installingUserCompanyId = defaultCompany[0].id;
            await db.update(users).set({ companyId: installingUserCompanyId }).where(eq(users.id, userId));
            console.warn(`[Shopify OAuth] Auto-assigned user ${userId} to company ${installingUserCompanyId}`);
          }
        }
      }

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
            // Set companyId if not already set
            ...(installingUserCompanyId && !existing[0].companyId
              ? { companyId: installingUserCompanyId }
              : {}),
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
          companyId: installingUserCompanyId,
        });
      }

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
          const webhookResult = await shopifyService.registerWebhook(webhookUrl, 'orders/create');
          if (webhookResult?.userErrors?.length > 0) {
            console.warn('[Shopify OAuth] Webhook registration warnings:', webhookResult.userErrors);
          } else {
            console.log(`[Shopify OAuth] Webhook registered for ${shopDomain} -> ${webhookUrl}`);
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
      const userId = req.user?.id || req.auth?.userId;

      // PRIMARY: return shops explicitly linked to this user via userShops.
      let userShopRows = await db
        .select({
          id: shops.id,
          shopDomain: shops.shopDomain,
          shopName: shops.shopName,
          shopEmail: shops.shopEmail,
          currency: shops.currency,
          timezone: shops.timezone,
          isActive: shops.isActive,
          lastSyncAt: shops.lastSyncAt,
        })
        .from(shops)
        .innerJoin(userShops, eq(shops.shopDomain, userShops.shopDomain))
        .where(and(eq(shops.isActive, true), eq(userShops.userId, userId)));

      // FALLBACK (company-scoped): same logic as connection-status — find shops for the
      // user's company and backfill userShops so both endpoints always agree.
      if (!userShopRows.length) {
        const userRow = await db.select({ companyId: users.companyId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const userCompanyId = userRow[0]?.companyId;
        if (userCompanyId) {
          const companyShops = await db
            .select({
              id: shops.id,
              shopDomain: shops.shopDomain,
              shopName: shops.shopName,
              shopEmail: shops.shopEmail,
              currency: shops.currency,
              timezone: shops.timezone,
              isActive: shops.isActive,
              lastSyncAt: shops.lastSyncAt,
            })
            .from(shops)
            .where(and(eq(shops.isActive, true), eq(shops.companyId, userCompanyId)));

          for (const shop of companyShops) {
            try {
              await db.insert(userShops).values({ userId, shopDomain: shop.shopDomain });
              console.warn(`[Shopify] Backfilled userShops for user ${userId} → ${shop.shopDomain}`);
            } catch {
              // Already exists — safe to ignore
            }
          }
          userShopRows = companyShops;
        }
      }

      res.json(userShopRows);
    } catch (error) {
      console.error("Error fetching shops:", error);
      res.status(500).json({ message: "Failed to fetch connected shops" });
    }
  });

  app.get("/api/shopify/connection-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;

      // PRIMARY: Find shop via userShops (explicit authorization, fastest path).
      let activeShopRows = await db
        .select({
          id: shops.id,
          shopDomain: shops.shopDomain,
          shopName: shops.shopName,
          accessToken: shops.accessToken,
          lastSyncAt: shops.lastSyncAt,
          isActive: shops.isActive,
        })
        .from(shops)
        .innerJoin(userShops, eq(shops.shopDomain, userShops.shopDomain))
        .where(and(eq(shops.isActive, true), eq(userShops.userId, userId)))
        .limit(1);

      // FALLBACK (company-scoped): if no userShops entry, find an active shop belonging
      // to the same company as the requesting user. This safely repairs stale data left
      // by the multi-tenancy migration without crossing tenant boundaries.
      if (!activeShopRows.length) {
        const userRow = await db.select({ companyId: users.companyId })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const userCompanyId = userRow[0]?.companyId;
        if (userCompanyId) {
          const companyShops = await db
            .select({
              id: shops.id,
              shopDomain: shops.shopDomain,
              shopName: shops.shopName,
              accessToken: shops.accessToken,
              lastSyncAt: shops.lastSyncAt,
              isActive: shops.isActive,
            })
            .from(shops)
            .where(and(eq(shops.isActive, true), eq(shops.companyId, userCompanyId)))
            .limit(1);

          if (companyShops.length > 0) {
            const fallbackShop = companyShops[0];
            console.warn(
              `[Shopify] user ${userId} has no userShops entry but company ${userCompanyId} owns ` +
              `shop ${fallbackShop.shopDomain}. Backfilling userShops link.`
            );
            // Backfill the missing link so this path is only hit once per user
            try {
              await db.insert(userShops).values({ userId, shopDomain: fallbackShop.shopDomain });
            } catch {
              // Unique constraint may fire on a concurrent request — not fatal
            }
            activeShopRows = companyShops;
          }
        }
      }

      if (!activeShopRows.length) {
        return res.json({ connected: false, live: false });
      }
      const shop = activeShopRows[0];
      const credentials = await getShopifyCredentials(shop.shopDomain);
      if (!credentials) {
        return res.json({
          connected: true,
          live: false,
          shopDomain: shop.shopDomain,
          shopName: shop.shopName,
          lastSyncAt: shop.lastSyncAt,
          error: "Access token not available",
        });
      }
      try {
        const shopifyService = new ShopifyService(credentials.shopDomain, credentials.accessToken);
        const shopInfo = await shopifyService.getShopInfo();
        return res.json({
          connected: true,
          live: true,
          shopDomain: shop.shopDomain,
          shopName: shopInfo?.name || shop.shopName,
          lastSyncAt: shop.lastSyncAt,
        });
      } catch (apiError: any) {
        return res.json({
          connected: true,
          live: false,
          shopDomain: shop.shopDomain,
          shopName: shop.shopName,
          lastSyncAt: shop.lastSyncAt,
          error: apiError?.message || "Could not reach Shopify API",
        });
      }
    } catch (error) {
      console.error("[Shopify] connection-status error:", error);
      res.status(500).json({ error: "Failed to check connection status" });
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

  /**
   * Admin-only: explicitly link a user to a shop by creating a userShops row.
   * Used to fix stale data (e.g. shops installed before multi-tenancy migration).
   * Requires admin.manage_all permission. Never auto-runs; always requires explicit admin action.
   */
  app.post("/api/shopify/admin/link-user-shop", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = req.user?.id || req.auth?.userId;
      const isAdmin = await resolvePermission(requesterId, 'admin.manage_all', storage);

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { userId, shopDomain } = req.body;
      if (!userId || !shopDomain) {
        return res.status(400).json({ error: "userId and shopDomain are required" });
      }

      const normalizedDomain = shopDomain.trim().toLowerCase();

      // Verify the shop exists and is active before linking
      const shopRow = await db.select({ shopDomain: shops.shopDomain })
        .from(shops)
        .where(and(eq(shops.shopDomain, normalizedDomain), eq(shops.isActive, true)))
        .limit(1);

      if (!shopRow.length) {
        return res.status(404).json({ error: "Active shop not found for the given domain" });
      }

      // Upsert: insert only if the link doesn't already exist
      const existing = await db.select()
        .from(userShops)
        .where(and(eq(userShops.userId, userId), eq(userShops.shopDomain, normalizedDomain)))
        .limit(1);

      if (existing.length > 0) {
        return res.json({ success: true, created: false, message: "Link already exists" });
      }

      await db.insert(userShops).values({ userId, shopDomain: normalizedDomain });

      console.log(`[Shopify Admin] User ${requesterId} linked user ${userId} to shop ${normalizedDomain}`);
      res.json({ success: true, created: true, userId, shopDomain: normalizedDomain });
    } catch (error) {
      console.error("[Shopify Admin] Error linking user to shop:", error);
      res.status(500).json({ error: "Failed to link user to shop" });
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
        const avgOrderValue = dayData.orderCount > 0
          ? Math.round((dayData.totalRevenue / dayData.orderCount) * 100) / 100
          : 0;
        const totalRevenueStr = String(Math.round(dayData.totalRevenue * 100) / 100);

        // Atomic full-overwrite upsert keyed on (shop_domain, date) — see
        // uq_shopify_daily_sales_shop_date. Sync recomputes the day's
        // totals from the entire fetched batch, so the conflict path
        // overwrites rather than incrementing.
        await db.insert(shopifyDailySales)
          .values({
            shopDomain: credentials.shopDomain,
            date: dayData.date,
            dayOfWeek: dayData.dayOfWeek,
            orderCount: dayData.orderCount,
            totalRevenue: totalRevenueStr,
            itemCount: dayData.itemCount,
            averageOrderValue: String(avgOrderValue),
          })
          .onConflictDoUpdate({
            target: [shopifyDailySales.shopDomain, shopifyDailySales.date],
            set: {
              orderCount: dayData.orderCount,
              totalRevenue: totalRevenueStr,
              itemCount: dayData.itemCount,
              averageOrderValue: String(avgOrderValue),
              dayOfWeek: dayData.dayOfWeek,
            },
          });
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

  // ── Backfill a single calendar day from Shopify GraphQL ─────────────────────
  app.post("/api/shopify/backfill-day", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
      const { shopDomain: domain, date } = req.body as { shopDomain?: string; date?: string };
      if (!domain || !date) {
        return res.status(400).json({ error: "shopDomain and date (YYYY-MM-DD) required" });
      }
      if (!(await assertUserShopAccess(userId, domain))) {
        return res.status(403).json({ error: "No access to this shop" });
      }
      const credentials = await getShopifyCredentials(domain);
      if (!credentials) {
        return res.status(400).json({ error: "No credentials found for this shop" });
      }

      const service = new ShopifyService(credentials.shopDomain, credentials.accessToken);
      const startIso = `${date}T00:00:00Z`;
      const endIso   = `${date}T23:59:59Z`;

      const orders = await service.getOrders({ first: 250, createdAtMin: startIso, createdAtMax: endIso, maxPages: 5 });

      if (orders.length === 0) {
        return res.json({ ordersFound: 0, dayRevenue: 0, date });
      }

      let dayRevenue = 0;
      let itemCount  = 0;
      const normalizedDomain = credentials.shopDomain;
      const dateObj = new Date(`${date}T00:00:00Z`);

      for (const order of orders) {
        const rawId   = (order as any).id ?? '';
        const orderId = rawId.includes('/') ? rawId.split('/').pop()! : rawId;
        const orderPrice = parseFloat((order as any).totalPriceSet?.shopMoney?.amount ?? '0');
        dayRevenue += orderPrice;
        const lineItems = (order as any).lineItems?.nodes ?? [];
        for (const li of lineItems) itemCount += li.quantity || 1;
        const orderCreatedAt = (order as any).createdAt ? new Date((order as any).createdAt) : dateObj;

        const existing = await db.select({ id: shopifyOrders.id })
          .from(shopifyOrders)
          .where(and(eq(shopifyOrders.shopDomain, normalizedDomain), eq(shopifyOrders.orderId, orderId)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(shopifyOrders).set({
            totalPrice: String(Math.round(orderPrice * 100) / 100),
            financialStatus: (order as any).displayFinancialStatus ?? null,
            fulfillmentStatus: (order as any).displayFulfillmentStatus ?? null,
            lineItems: lineItems as any,
            orderCreatedAt,
            updatedAt: new Date(),
          }).where(eq(shopifyOrders.id, existing[0].id));
        } else {
          await db.insert(shopifyOrders).values({
            shopDomain: normalizedDomain,
            orderId,
            orderNumber: (order as any).name ?? null,
            totalPrice: String(Math.round(orderPrice * 100) / 100),
            currency: (order as any).totalPriceSet?.shopMoney?.currencyCode ?? 'USD',
            financialStatus: (order as any).displayFinancialStatus ?? null,
            fulfillmentStatus: (order as any).displayFulfillmentStatus ?? null,
            lineItems: lineItems as any,
            customerData: null,
            orderCreatedAt,
          });
        }
      }

      // Upsert daily aggregate
      const dayOfWeek = dateObj.getUTCDay();
      const avgOrderValue = orders.length > 0 ? Math.round((dayRevenue / orders.length) * 100) / 100 : 0;
      const existingDay = await db.select({ id: shopifyDailySales.id })
        .from(shopifyDailySales)
        .where(and(eq(shopifyDailySales.shopDomain, normalizedDomain), eq(shopifyDailySales.date, dateObj)))
        .limit(1);

      if (existingDay.length > 0) {
        await db.update(shopifyDailySales).set({
          orderCount: orders.length, totalRevenue: String(Math.round(dayRevenue * 100) / 100),
          itemCount, averageOrderValue: String(avgOrderValue), dayOfWeek,
        }).where(eq(shopifyDailySales.id, existingDay[0].id));
      } else {
        await db.insert(shopifyDailySales).values({
          shopDomain: normalizedDomain, date: dateObj, dayOfWeek,
          orderCount: orders.length, totalRevenue: String(Math.round(dayRevenue * 100) / 100),
          itemCount, averageOrderValue: String(avgOrderValue),
        });
      }

      res.json({ ordersFound: orders.length, dayRevenue: Math.round(dayRevenue * 100) / 100, date });
    } catch (error) {
      console.error("Error in backfill-day:", error);
      res.status(500).json({ message: "Failed to backfill day orders", detail: String(error) });
    }
  });

  app.get("/api/shopify/sales-data", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;

            const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      if (!isAdminOrOwner && !(await resolveAnyPermission(userId, ['sales.view_all', 'admin.manage_all'], storage))) {
        return res.status(403).json({ message: "You don't have access to sales data" });
      }

      // Resolve shop domain: use explicit param first, then auto-resolve from the user
      let resolvedDomain = (req.query.shop as string)?.trim().toLowerCase() || '';

      if (!resolvedDomain) {
        // Look up the shop linked to this user
        const linked = await db
          .select({ shopDomain: shops.shopDomain })
          .from(shops)
          .innerJoin(userShops, eq(shops.shopDomain, userShops.shopDomain))
          .where(and(eq(shops.isActive, true), eq(userShops.userId, userId)))
          .limit(1);

        if (!linked.length) {
          // Company-scoped fallback
          const userRow = await db.select({ companyId: users.companyId }).from(users).where(eq(users.id, userId)).limit(1);
          const companyId = userRow[0]?.companyId;
          if (companyId) {
            const companyShop = await db
              .select({ shopDomain: shops.shopDomain })
              .from(shops)
              .where(and(eq(shops.isActive, true), eq(shops.companyId, companyId)))
              .limit(1);
            resolvedDomain = companyShop[0]?.shopDomain || '';
          }
        } else {
          resolvedDomain = linked[0].shopDomain;
        }
      }

      if (!resolvedDomain) {
        return res.json({
          connected: false,
          dailySales: [],
          weekdayAnalysis: [],
          summary: { totalDays: 0, totalRevenue: 0, totalOrders: 0, avgDailyRevenue: 0, avgDailyOrders: 0 },
          todayRevenue: 0, lastWeekRevenue: 0, orderCount: 0,
        });
      }

      const daysBack = parseInt(req.query.daysBack as string || '365');
      const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      // Auto-sync today's data from Shopify if missing from the DB.
      // This self-heals on every first load of the day without a manual trigger.
      const todayKeyCheck = new Date().toISOString().split('T')[0];
      const todayRow = await db.select({ id: shopifyDailySales.id })
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, resolvedDomain),
          gte(shopifyDailySales.date, new Date(todayKeyCheck + 'T00:00:00Z'))
        ))
        .limit(1);

      if (!todayRow.length) {
        // Today is missing — pull the last 7 days from Shopify and upsert silently.
        try {
          const creds = await getShopifyCredentials(resolvedDomain);
          if (creds) {
            const svc = new ShopifyService(creds.shopDomain, creds.accessToken);
            const syncStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const orders = await svc.getOrders({ first: 250, createdAtMin: syncStart.toISOString(), createdAtMax: new Date().toISOString(), maxPages: 5 });
            const agg: Record<string, { date: Date; dayOfWeek: number; orderCount: number; totalRevenue: number; itemCount: number }> = {};
            for (const o of orders) {
              const d = new Date(o.createdAt);
              const k = d.toISOString().split('T')[0];
              if (!agg[k]) agg[k] = { date: new Date(k + 'T00:00:00Z'), dayOfWeek: new Date(k + 'T00:00:00Z').getUTCDay(), orderCount: 0, totalRevenue: 0, itemCount: 0 };
              agg[k].orderCount++;
              agg[k].totalRevenue += parseFloat(o.totalPriceSet?.shopMoney?.amount || '0');
              for (const li of (o.lineItems?.nodes || [])) agg[k].itemCount += li.quantity || 1;
            }
            for (const dayData of Object.values(agg)) {
              const aov = dayData.orderCount > 0 ? Math.round((dayData.totalRevenue / dayData.orderCount) * 100) / 100 : 0;
              await db.insert(shopifyDailySales).values({
                shopDomain: resolvedDomain,
                date: dayData.date,
                dayOfWeek: dayData.dayOfWeek,
                orderCount: dayData.orderCount,
                totalRevenue: String(Math.round(dayData.totalRevenue * 100) / 100),
                itemCount: dayData.itemCount,
                averageOrderValue: String(aov),
              }).onConflictDoUpdate({
                target: [shopifyDailySales.shopDomain, shopifyDailySales.date],
                set: { orderCount: dayData.orderCount, totalRevenue: String(Math.round(dayData.totalRevenue * 100) / 100), itemCount: dayData.itemCount, averageOrderValue: String(aov) },
              });
            }
          }
        } catch (syncErr) {
          console.warn('[shopify/sales-data] Auto-sync failed, returning DB cache:', syncErr instanceof Error ? syncErr.message : syncErr);
        }
      }

      const salesData = await db.select()
        .from(shopifyDailySales)
        .where(and(
          eq(shopifyDailySales.shopDomain, resolvedDomain),
          gte(shopifyDailySales.date, startDate)
        ))
        .orderBy(desc(shopifyDailySales.date));

      const dayOfWeekAverages: Record<number, { totalRevenue: number; totalOrders: number; count: number }> = {};
      for (let i = 0; i < 7; i++) {
        dayOfWeekAverages[i] = { totalRevenue: 0, totalOrders: 0, count: 0 };
      }

      let totalRevenue = 0;
      let totalOrders = 0;

      const todayKey = new Date().toISOString().split('T')[0];
      const lastWeekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const prevWeekStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      let todayRevenue = 0;
      let todayOrderCount = 0;
      let lastWeekRevenue = 0;

      for (const day of salesData) {
        const rev = parseFloat(day.totalRevenue || '0');
        const orders = day.orderCount || 0;
        totalRevenue += rev;
        totalOrders += orders;

        const dow = day.dayOfWeek ?? 0;
        dayOfWeekAverages[dow].totalRevenue += rev;
        dayOfWeekAverages[dow].totalOrders += orders;
        dayOfWeekAverages[dow].count++;

        // Dashboard quick-stats
        const dayKey = day.date instanceof Date
          ? day.date.toISOString().split('T')[0]
          : String(day.date).split('T')[0];
        if (dayKey === todayKey) {
          todayRevenue += rev;
          todayOrderCount += orders;
        }
        const dayTime = new Date(dayKey).getTime();
        if (dayTime >= lastWeekStart.getTime() && dayTime < prevWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000) {
          lastWeekRevenue += rev;
        }
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
        connected: true,
        shopDomain: resolvedDomain,
        dailySales: salesData,
        weekdayAnalysis,
        summary: {
          totalDays: salesData.length,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalOrders,
          avgDailyRevenue: salesData.length > 0 ? Math.round((totalRevenue / salesData.length) * 100) / 100 : 0,
          avgDailyOrders: salesData.length > 0 ? Math.round((totalOrders / salesData.length) * 100) / 100 : 0,
        },
        // Convenience fields for the owner dashboard quick-stats
        todayRevenue: Math.round(todayRevenue * 100) / 100,
        lastWeekRevenue: Math.round(lastWeekRevenue * 100) / 100,
        orderCount: todayOrderCount,
      });
    } catch (error) {
      console.error("Error fetching sales data:", error);
      res.status(500).json({ message: "Failed to fetch sales data" });
    }
  });

  app.get("/api/shopify/staffing-recommendations", isAuthenticated, aiRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.auth?.userId;
            const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      if (!isAdminOrOwner && !(await resolveAnyPermission(userId, ['sales.view_all', 'admin.manage_all'], storage))) {
        return res.status(403).json({ message: "You don't have access to sales data" });
      }

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
        dayOfWeekStats[day.dayOfWeek!].revenues.push(parseFloat(day.totalRevenue || '0'));
        dayOfWeekStats[day.dayOfWeek!].orders.push(day.orderCount || 0);
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
            const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      const canView = isAdminOrOwner || (await resolveAnyPermission(userId, ['sales.view_all', 'admin.manage_all'], storage));

      if (!canView) {
        return res.status(403).json({ message: "You don't have access to sales data" });
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
        dayOfWeekAvg[day.dayOfWeek!].revenues.push(parseFloat(day.totalRevenue || '0'));
        dayOfWeekAvg[day.dayOfWeek!].orders.push(day.orderCount || 0);
      }

      const prevDayData = previousYearSales.map(d => ({
        date: new Date(d.date).toISOString().split('T')[0],
        dayName: dayNames[d.dayOfWeek!],
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

  // ── Report Schedule CRUD ──────────────────────────────────────────────────
  // All four routes enforce: (1) admin/owner role, (2) caller is linked to the
  // requested shop via userShops or same-company fallback (same pattern as the
  // rest of the Shopify route set so cross-tenant access is impossible).

  app.get("/api/shopify/report-schedule", isAuthenticated, async (req: any, res: Response) => {
    try {
      const shopDomain = req.query.shop as string;
      if (!shopDomain) return res.status(400).json({ error: "shop parameter required" });

      const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      if (!isAdminOrOwner) return res.status(403).json({ error: "Admin access required" });

      const userId = req.user?.id || req.auth?.userId;
      const hasAccess = await assertUserShopAccess(userId, shopDomain);
      if (!hasAccess) return res.status(403).json({ error: "You don't have access to this shop" });

      const rows = await db.select()
        .from(shopifyReportSchedules)
        .where(eq(shopifyReportSchedules.shopDomain, shopDomain.toLowerCase().trim()))
        .limit(1);

      res.json(rows[0] ?? null);
    } catch (error) {
      console.error("[ReportSchedule] GET error:", error);
      res.status(500).json({ error: "Failed to fetch report schedule" });
    }
  });

  app.post("/api/shopify/report-schedule", isAuthenticated, async (req: any, res: Response) => {
    try {
      const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      if (!isAdminOrOwner) return res.status(403).json({ error: "Admin access required" });

      const { shopDomain, frequency, recipientEmail, enabled } = req.body;
      if (!shopDomain || !frequency || !recipientEmail) {
        return res.status(400).json({ error: "shopDomain, frequency, and recipientEmail are required" });
      }

      const validFrequencies = ['daily', 'weekly', 'monthly'];
      if (!validFrequencies.includes(frequency)) {
        return res.status(400).json({ error: "frequency must be daily, weekly, or monthly" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(recipientEmail)) {
        return res.status(400).json({ error: "recipientEmail is not a valid email address" });
      }

      const userId = req.user?.id || req.auth?.userId;
      const hasAccess = await assertUserShopAccess(userId, shopDomain);
      if (!hasAccess) return res.status(403).json({ error: "You don't have access to this shop" });

      const domain = shopDomain.toLowerCase().trim();

      const existing = await db.select({ id: shopifyReportSchedules.id })
        .from(shopifyReportSchedules)
        .where(eq(shopifyReportSchedules.shopDomain, domain))
        .limit(1);

      let result;
      if (existing.length > 0) {
        const updated = await db.update(shopifyReportSchedules)
          .set({ frequency, recipientEmail, enabled: enabled !== false, updatedAt: new Date() })
          .where(eq(shopifyReportSchedules.shopDomain, domain))
          .returning();
        result = updated[0];
      } else {
        const inserted = await db.insert(shopifyReportSchedules)
          .values({ shopDomain: domain, frequency, recipientEmail, enabled: enabled !== false })
          .returning();
        result = inserted[0];
      }

      res.json(result);
    } catch (error) {
      console.error("[ReportSchedule] POST error:", error);
      res.status(500).json({ error: "Failed to save report schedule" });
    }
  });

  app.delete("/api/shopify/report-schedule", isAuthenticated, async (req: any, res: Response) => {
    try {
      const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      if (!isAdminOrOwner) return res.status(403).json({ error: "Admin access required" });

      const shopDomain = req.query.shop as string;
      if (!shopDomain) return res.status(400).json({ error: "shop parameter required" });

      const userId = req.user?.id || req.auth?.userId;
      const hasAccess = await assertUserShopAccess(userId, shopDomain);
      if (!hasAccess) return res.status(403).json({ error: "You don't have access to this shop" });

      await db.delete(shopifyReportSchedules)
        .where(eq(shopifyReportSchedules.shopDomain, shopDomain.toLowerCase().trim()));

      res.json({ success: true });
    } catch (error) {
      console.error("[ReportSchedule] DELETE error:", error);
      res.status(500).json({ error: "Failed to delete report schedule" });
    }
  });

  app.post("/api/shopify/report-schedule/send-now", isAuthenticated, async (req: any, res: Response) => {
    try {
      const roleName = req.user?.role?.name ?? '';
      const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
      if (!isAdminOrOwner) return res.status(403).json({ error: "Admin access required" });

      const { shopDomain } = req.body;
      if (!shopDomain) return res.status(400).json({ error: "shopDomain required" });

      const userId = req.user?.id || req.auth?.userId;
      const hasAccess = await assertUserShopAccess(userId, shopDomain);
      if (!hasAccess) return res.status(403).json({ error: "You don't have access to this shop" });

      const domain = shopDomain.toLowerCase().trim();

      const scheduleRows = await db.select()
        .from(shopifyReportSchedules)
        .where(and(
          eq(shopifyReportSchedules.shopDomain, domain),
          eq(shopifyReportSchedules.enabled, true),
        ))
        .limit(1);

      if (!scheduleRows.length) {
        return res.status(404).json({ error: "No active schedule found for this shop" });
      }

      const schedule = scheduleRows[0];
      const sent = await sendScheduledReport(schedule.shopDomain, schedule.frequency, schedule.recipientEmail);
      if (sent) {
        await db.update(shopifyReportSchedules)
          .set({ lastSentAt: new Date(), updatedAt: new Date() })
          .where(eq(shopifyReportSchedules.id, schedule.id));
        res.json({ success: true });
      } else {
        res.status(500).json({ error: "Failed to send report email. Check SENDGRID_API_KEY configuration." });
      }
    } catch (error) {
      console.error("[ReportSchedule] Send-now error:", error);
      res.status(500).json({ error: "Failed to send report" });
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
