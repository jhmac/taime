import type { Express } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { cache } from "../lib/cache";
import { db } from "../db";
import { roles, users, companies, companySettings } from "@shared/schema";
import { eq } from "drizzle-orm";

const onboardingSchema = z.object({
  companyName: z.string().min(1, "Company name is required").max(200),
  address1: z.string().min(1, "Address is required").max(200),
  city: z.string().min(1, "City is required").max(100),
  stateProvince: z.string().min(1, "State/Province is required").max(100),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  numberOfEmployees: z.number().int().min(1).max(10000),
  shopifyUrl: z.string().url().optional().or(z.literal("")),
});

export function registerOnboardingRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/companies/status', isAuthenticated, asyncHandler(async (req: any, res) => {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.json({ needsOnboarding: true });
    }
    const company = await storage.getCompany(companyId);
    if (!company || company.isDefault) {
      return res.json({ needsOnboarding: true });
    }
    res.json({ needsOnboarding: false });
  }));

  app.post('/api/companies', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    }

    const currentCompany = await storage.getCompany(req.user.companyId);
    if (currentCompany && !currentCompany.isDefault) {
      throw new AppError(409, "Your company is already set up.", "CONFLICT");
    }

    const validated = onboardingSchema.parse(req.body);

    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, 'owner')).limit(1);

    const { newCompany, settings } = await db.transaction(async (tx) => {
      const [created] = await tx.insert(companies).values({
        name: validated.companyName,
        plan: "starter",
        employeeCount: validated.numberOfEmployees,
        shopifyUrl: validated.shopifyUrl || null,
        isDefault: false,
      }).returning();

      await tx.update(users)
        .set({ companyId: created.id, updatedAt: new Date() })
        .where(eq(users.id, userId));

      if (ownerRole) {
        await tx.update(users)
          .set({ roleId: ownerRole.id, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }

      const [createdSettings] = await tx.insert(companySettings).values({
        companyId: created.id,
        companyName: validated.companyName,
        address1: validated.address1,
        city: validated.city,
        stateProvince: validated.stateProvince,
        zipCode: validated.zipCode || null,
        country: validated.country || "United States",
        website: validated.shopifyUrl || null,
        version: 1,
      }).returning();

      return { newCompany: created, settings: createdSettings };
    });

    cache.invalidate(`company:settings:${newCompany.id}`);

    await storage.createActivityLog({
      userId,
      action: 'create',
      targetType: 'company',
      details: `Company "${validated.companyName}" created via onboarding`,
      companyId: newCompany.id,
    });

    res.json({ success: true, companyId: newCompany.id, settings });
  }));
}
