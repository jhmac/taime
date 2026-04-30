import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, companies, workLocations } from "./identity";

// Shopify Store table
export const shops = pgTable("shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().unique(),
  shopName: varchar("shop_name"),
  shopEmail: varchar("shop_email"),
  accessToken: varchar("access_token"),
  scope: varchar("scope"),
  currency: varchar("currency").default("USD"),
  timezone: varchar("timezone"),
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  installedAt: timestamp("installed_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  companyId: varchar("company_id").references(() => companies.id),
}, (table) => [
  index("idx_shops_company_id").on(table.companyId),
]);

// User to Shop junction table — this is the authorization boundary for multi-tenancy.
// Every shop access must be verified through this table. A user can only see/manage
// shops they have an explicit link to.
export const userShops = pgTable("user_shops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  shopDomain: varchar("shop_domain").references(() => shops.shopDomain).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_shops_unique").on(table.userId, table.shopDomain),
]);

// Shopify Daily Sales
export const shopifyDailySales = pgTable("shopify_daily_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  date: timestamp("date").notNull(),
  dayOfWeek: integer("day_of_week"),
  orderCount: integer("order_count").default(0),
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }).default("0.00"),
  itemCount: integer("item_count").default(0),
  averageOrderValue: decimal("average_order_value", { precision: 10, scale: 2 }).default("0.00"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // One aggregate row per (shop, date). Backfill code does select-then-insert
  // which is not atomic — concurrent backfills (e.g. /historical-sales and
  // /suggest hit at the same time) used to produce multiple rows per day,
  // and each successive backfill summed the duplicated per-order rows
  // beneath it, inflating the cached daily total to several times the
  // actual figure (e.g. $5.3k displayed when the real number was ~$1.5k).
  uniqueIndex("uq_shopify_daily_sales_shop_date").on(table.shopDomain, table.date),
]);

// Shopify Orders
export const shopifyOrders = pgTable("shopify_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  orderId: varchar("order_id").notNull(),
  orderNumber: varchar("order_number"),
  email: varchar("email"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }),
  currency: varchar("currency"),
  financialStatus: varchar("financial_status"),
  fulfillmentStatus: varchar("fulfillment_status"),
  lineItems: jsonb("line_items"),
  customerData: jsonb("customer_data"),
  orderCreatedAt: timestamp("order_created_at"),
  processedAt: timestamp("processed_at"),
  syncedAt: timestamp("synced_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_shopify_orders_shop_date").on(table.shopDomain, table.orderCreatedAt),
  index("IDX_shopify_orders_order_id").on(table.orderId),
  // One row per Shopify order. Without this, the non-atomic upsert in
  // backfillDayOrdersFromShopify produced duplicate per-order rows whenever
  // the same date was backfilled concurrently or twice in quick succession.
  uniqueIndex("uq_shopify_orders_shop_order").on(table.shopDomain, table.orderId),
]);

// Shopify Analytics Report Schedules
export const shopifyReportSchedules = pgTable("shopify_report_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().references(() => shops.shopDomain),
  frequency: varchar("frequency").notNull().default("weekly"), // 'daily' | 'weekly' | 'monthly'
  recipientEmail: varchar("recipient_email").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastSentAt: timestamp("last_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("uq_shopify_report_schedules_shop").on(table.shopDomain),
]);

// Shopify Register Sessions (snapshot from Shopify POS cashTrackingSessions API)
export const shopifyRegisterSessions = pgTable("shopify_register_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: text("store_id").notNull(),
  sessionDate: text("session_date").notNull(),
  registerName: text("register_name").notNull(),
  shopifySessionId: text("shopify_session_id").notNull(),
  status: text("status"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  openingFloat: decimal("opening_float", { precision: 10, scale: 2 }),
  expectedClosingCash: decimal("expected_closing_cash", { precision: 10, scale: 2 }),
  reportedClosingCash: decimal("reported_closing_cash", { precision: 10, scale: 2 }),
  cashSales: decimal("cash_sales", { precision: 10, scale: 2 }),
  cashRefunds: decimal("cash_refunds", { precision: 10, scale: 2 }),
  cashAdjustments: decimal("cash_adjustments", { precision: 10, scale: 2 }),
  totalSales: decimal("total_sales", { precision: 10, scale: 2 }),
  tenderBreakdown: jsonb("tender_breakdown"),
  cashMovements: jsonb("cash_movements"),
  rawPayload: jsonb("raw_payload"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_shopify_register_sessions_store_date").on(table.storeId, table.sessionDate),
  uniqueIndex("idx_shopify_register_sessions_shopify_id").on(table.shopifySessionId),
]);

// Insert schemas
export const insertShopSchema = createInsertSchema(shops).omit({ id: true, installedAt: true, updatedAt: true });
export const insertUserShopSchema = createInsertSchema(userShops).omit({ id: true, createdAt: true });
export const insertShopifyDailySalesSchema = createInsertSchema(shopifyDailySales).omit({ id: true, createdAt: true });
export const insertShopifyOrderSchema = createInsertSchema(shopifyOrders).omit({ id: true, syncedAt: true, createdAt: true, updatedAt: true });
export const insertShopifyReportScheduleSchema = createInsertSchema(shopifyReportSchedules).omit({ id: true, createdAt: true, updatedAt: true, lastSentAt: true });
export const insertShopifyRegisterSessionSchema = createInsertSchema(shopifyRegisterSessions).omit({ id: true, createdAt: true });

// Types
export type Shop = typeof shops.$inferSelect;
export type UserShop = typeof userShops.$inferSelect;
export type ShopifyDailySale = typeof shopifyDailySales.$inferSelect;
export type ShopifyOrder = typeof shopifyOrders.$inferSelect;
export type ShopifyReportSchedule = typeof shopifyReportSchedules.$inferSelect;
export type InsertShopifyReportSchedule = z.infer<typeof insertShopifyReportScheduleSchema>;
export type ShopifyRegisterSession = typeof shopifyRegisterSessions.$inferSelect;
export type InsertShopifyRegisterSession = z.infer<typeof insertShopifyRegisterSessionSchema>;
