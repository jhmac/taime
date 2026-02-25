import { db } from "../db";
import { workLocations } from "@shared/schema";

let cachedStoreId: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

export async function resolveStoreId(): Promise<string | null> {
  const now = Date.now();
  if (cachedStoreId && now - cacheTime < CACHE_TTL) {
    return cachedStoreId;
  }
  const [store] = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
  cachedStoreId = store?.id || null;
  cacheTime = now;
  return cachedStoreId;
}
