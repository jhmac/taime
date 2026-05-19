import { sql, relations } from "drizzle-orm";
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

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Companies table — the root tenant entity for multi-tenancy.
// Every user and every Shopify shop belongs to exactly one company.
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().default("My Company"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Roles table for granular permissions
export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  displayName: varchar("display_name").notNull(),
  description: text("description"),
  isSystemRole: boolean("is_system_role").default(false),
  isActive: boolean("is_active").default(true),
  // Fallback hourly rate used by the live margin meter when an individual user's
  // `users.hourlyRate` is null. Decimal so it round-trips without float drift.
  defaultHourlyRate: decimal("default_hourly_rate", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Permissions table
export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  displayName: varchar("display_name").notNull(),
  description: text("description"),
  category: varchar("category").notNull(), // 'time_tracking', 'scheduling', 'hr', 'communication', etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// Role permissions junction table
export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").references(() => roles.id).notNull(),
  permissionId: varchar("permission_id").references(() => permissions.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Work locations for geofencing
// Defined before users because users.locationId references this table.
export const workLocations = pgTable("work_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  address: text("address"),
  phone: varchar("phone"),
  email: varchar("email"),
  timezone: varchar("timezone"),
  hoursOfOperation: jsonb("hours_of_operation").$type<Record<string, { isOpen: boolean; open: string; close: string }>>(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  radius: integer("radius").default(100),
  wifiSsid: varchar("wifi_ssid"),
  isActive: boolean("is_active").default(true),
  geofenceType: varchar("geofence_type", { length: 20 }).default("radius"),
  geofencePolygon: jsonb("geofence_polygon").$type<Array<{ lat: number; lng: number }>>(),
  geofenceGraceMinutes: text("geofence_grace_minutes").default("5.00"),
  geofenceEnabled: boolean("geofence_enabled").default(true),
  autoClockOut: boolean("auto_clock_out").default(true),
  companyId: varchar("company_id").references(() => companies.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  employmentType: varchar("employment_type").default("contractor"),
  roleId: varchar("role_id").references(() => roles.id),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  locationName: varchar("location_name"),
  locationId: varchar("location_id").references(() => workLocations.id),
  payrollClassification: varchar("payroll_classification").default("1099 Contractor"),
  startDate: timestamp("start_date"),
  pin: varchar("pin"),
  showInSchedule: boolean("show_in_schedule").default(true),
  targetWeeklyHours: decimal("target_weekly_hours", { precision: 5, scale: 1 }),
  schedulingClassifications: jsonb("scheduling_classifications").default(sql`'[]'::jsonb`).$type<string[]>(),
  sendLocationAlerts: boolean("send_location_alerts").default(true),
  includeInTimeClockErrors: boolean("include_in_time_clock_errors").default(true),
  eligibleForOpenShifts: boolean("eligible_for_open_shifts").default(true),
  eligibleForAutoScheduling: boolean("eligible_for_auto_scheduling").default(true),
  canWaiveMissedBreaks: boolean("can_waive_missed_breaks").default(false),
  homeLatitude: decimal("home_latitude", { precision: 10, scale: 8 }),
  homeLongitude: decimal("home_longitude", { precision: 11, scale: 8 }),
  legalName: varchar("legal_name"),
  dateOfBirth: varchar("date_of_birth"),
  ssn: varchar("ssn"),
  homeAddress: text("home_address"),
  homeCity: varchar("home_city"),
  homeState: varchar("home_state"),
  homeZip: varchar("home_zip"),
  emergencyContactName: varchar("emergency_contact_name"),
  emergencyContactPhone: varchar("emergency_contact_phone"),
  preferredName: varchar("preferred_name"),
  personalEmail: varchar("personal_email"),
  scoreNotificationsEnabled: boolean("score_notifications_enabled").default(true),
  mileageRateCentsOverride: integer("mileage_rate_cents_override"),
  federalWithholdingPct: decimal("federal_withholding_pct", { precision: 5, scale: 2 }).default("12"),
  stateWithholdingPct: decimal("state_withholding_pct", { precision: 5, scale: 2 }).default("5"),
  otherDeductionsCents: integer("other_deductions_cents").default(0),
  invitedAt: timestamp("invited_at"),
  inviteAcceptedAt: timestamp("invite_accepted_at"),
  inviteToken: varchar("invite_token").unique(),
  inviteCount: integer("invite_count").default(0),
  isActive: boolean("is_active").default(true),
  companyId: varchar("company_id").references(() => companies.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_users_role_id").on(table.roleId),
  index("idx_users_is_active").on(table.isActive),
  index("idx_users_company_id").on(table.companyId),
  index("idx_users_location_id").on(table.locationId),
]);

// User-level permission overrides — grant or revoke a specific permission for an individual user,
// independent of their role. A grant=true row adds the permission; grant=false removes it even if
// the role would otherwise provide it.
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  permissionName: varchar("permission_name").notNull(), // e.g. 'sales.view_all'
  grant: boolean("grant").notNull(), // true = explicitly granted, false = explicitly revoked
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_permission_overrides_unique").on(table.userId, table.permissionName),
]);

// Location permission status — persisted so the manager dashboard survives server restarts.
// Records older than 24 h are treated as stale by the application layer.
export const locationPermissions = pgTable("location_permissions", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull(), // 'granted' | 'denied' | 'prompt' | 'unknown'
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, createdAt: true });
export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true });
export const insertUserPermissionOverrideSchema = createInsertSchema(userPermissionOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkLocationSchema = createInsertSchema(workLocations).omit({ id: true, createdAt: true });
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = InsertUser & { id: string };
export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;
export type InsertUserPermissionOverride = z.infer<typeof insertUserPermissionOverrideSchema>;
export type WorkLocation = typeof workLocations.$inferSelect;
export type InsertWorkLocation = z.infer<typeof insertWorkLocationSchema>;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type UserWithRole = User & { role?: Role };
