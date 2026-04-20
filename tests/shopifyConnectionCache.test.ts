import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readShopifyConnectionCache, writeShopifyConnectionCache, SHOPIFY_CACHE_TTL_MS } from '../client/src/lib/shopifyConnectionCache';

const makeStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    store,
  };
};

let storage = makeStorage();

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal('localStorage', storage);
});

const KEY = 'shopify_connected:user123';

describe('readShopifyConnectionCache', () => {
  it('returns false when key is null', () => {
    expect(readShopifyConnectionCache(null)).toBe(false);
  });

  it('returns false when nothing is stored', () => {
    expect(readShopifyConnectionCache(KEY)).toBe(false);
  });

  it('returns true for a fresh connected=true entry', () => {
    writeShopifyConnectionCache(KEY, true);
    expect(readShopifyConnectionCache(KEY)).toBe(true);
  });

  it('returns false for a fresh connected=false entry', () => {
    writeShopifyConnectionCache(KEY, false);
    expect(readShopifyConnectionCache(KEY)).toBe(false);
  });

  it('returns false when the entry is expired', () => {
    const expired = JSON.stringify({ connected: true, cachedAt: Date.now() - SHOPIFY_CACHE_TTL_MS - 1 });
    storage.setItem(KEY, expired);
    expect(readShopifyConnectionCache(KEY)).toBe(false);
  });

  it('returns true when the entry is exactly within the TTL window', () => {
    const fresh = JSON.stringify({ connected: true, cachedAt: Date.now() - SHOPIFY_CACHE_TTL_MS + 5000 });
    storage.setItem(KEY, fresh);
    expect(readShopifyConnectionCache(KEY)).toBe(true);
  });

  it('returns false and does not throw on corrupt JSON', () => {
    storage.setItem(KEY, 'not-valid-json{{{');
    expect(readShopifyConnectionCache(KEY)).toBe(false);
  });

  it('returns false for a JSON object missing required fields', () => {
    storage.setItem(KEY, JSON.stringify({ foo: 'bar' }));
    expect(readShopifyConnectionCache(KEY)).toBe(false);
  });

  it('migrates legacy "true" string and returns true', () => {
    // task #217 stored bare JSON-encoded booleans: JSON.stringify(true) === 'true'
    storage.setItem(KEY, 'true');
    expect(readShopifyConnectionCache(KEY)).toBe(true);
    const migrated = JSON.parse(storage.store[KEY]);
    expect(migrated.connected).toBe(true);
    expect(typeof migrated.cachedAt).toBe('number');
  });

  it('migrates legacy "false" string and returns false', () => {
    storage.setItem(KEY, 'false');
    expect(readShopifyConnectionCache(KEY)).toBe(false);
    const migrated = JSON.parse(storage.store[KEY]);
    expect(migrated.connected).toBe(false);
    expect(typeof migrated.cachedAt).toBe('number');
  });
});

describe('writeShopifyConnectionCache', () => {
  it('writes a well-formed timestamped JSON entry', () => {
    const before = Date.now();
    writeShopifyConnectionCache(KEY, true);
    const after = Date.now();
    const entry = JSON.parse(storage.store[KEY]);
    expect(entry.connected).toBe(true);
    expect(entry.cachedAt).toBeGreaterThanOrEqual(before);
    expect(entry.cachedAt).toBeLessThanOrEqual(after);
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('no storage'); },
      setItem: () => { throw new Error('no storage'); },
    });
    expect(() => writeShopifyConnectionCache(KEY, true)).not.toThrow();
  });
});
