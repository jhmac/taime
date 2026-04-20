/**
 * Shopify connection cache helpers.
 *
 * Format: { connected: boolean, cachedAt: number } (epoch ms).
 * TTL: 30 minutes — expired entries are treated as cache misses so a store
 * that has disconnected Shopify doesn't keep flashing the revenue skeleton.
 *
 * Backward-compat: the previous implementation (task #217) stored a plain
 * "true" / "false" string. Those legacy entries are migrated on first read
 * so existing connected users don't get an extra skeleton flash after the upgrade.
 */

export const SHOPIFY_CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  connected: boolean;
  cachedAt: number;
}

function isValidEntry(v: unknown): v is CacheEntry {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CacheEntry).connected === 'boolean' &&
    typeof (v as CacheEntry).cachedAt === 'number'
  );
}

export function readShopifyConnectionCache(key: string | null): boolean {
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;

    const parsed: unknown = JSON.parse(raw);

    if (isValidEntry(parsed)) {
      if (Date.now() - parsed.cachedAt >= SHOPIFY_CACHE_TTL_MS) return false;
      return parsed.connected;
    }

    // Backward-compat: legacy plain boolean values from task #217.
    // JSON.parse('true') → true, JSON.parse('false') → false.
    if (typeof parsed === 'boolean') {
      writeShopifyConnectionCache(key, parsed);
      return parsed;
    }
  } catch {}
  return false;
}

export function writeShopifyConnectionCache(key: string, connected: boolean): void {
  try {
    localStorage.setItem(key, JSON.stringify({ connected, cachedAt: Date.now() }));
  } catch {}
}
