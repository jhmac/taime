import { db } from "../db";
import { workLocations } from "@shared/schema";
import { eq } from "drizzle-orm";

const storeCache = new Map<string, { id: string; time: number }>();
const CACHE_TTL = 60 * 1000;

export async function resolveStoreId(storageOrCompanyId?: { getCompanySettings?: (companyId: string) => Promise<any> } | string, companyId?: string): Promise<string> {
  const resolvedCompanyId: string | undefined =
    typeof storageOrCompanyId === 'string' ? storageOrCompanyId :
    typeof companyId === 'string' ? companyId : undefined;

  if (resolvedCompanyId) {
    const cached = storeCache.get(resolvedCompanyId);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.id;
    }
    const [store] = await db
      .select({ id: workLocations.id })
      .from(workLocations)
      .where(eq(workLocations.companyId, resolvedCompanyId))
      .limit(1);
    const id = store?.id || resolvedCompanyId;
    storeCache.set(resolvedCompanyId, { id, time: Date.now() });
    return id;
  }
  const [store] = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
  return store?.id || 'default';
}
