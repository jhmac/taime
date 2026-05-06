/**
 * Shop timezone helpers.
 *
 * Shopify exposes both `ianaTimezone` (e.g. "America/New_York") and a short
 * `timezoneAbbreviation` ("EST"). Older OAuth callbacks only stored the
 * abbreviation, so we fall back to a small abbrev → IANA map. Anything we
 * can't map falls back to UTC.
 *
 * All Shopify ingestion code paths (webhook, backfill, sync, reconciliation)
 * must bucket orders by the shop's *local* date — not the server's wall clock
 * and not UTC — so the displayed "today's revenue" matches Shopify Analytics
 * for the same calendar day.
 */

const ABBREV_TO_IANA: Record<string, string> = {
  EST: "America/New_York", EDT: "America/New_York",
  CST: "America/Chicago",  CDT: "America/Chicago",
  MST: "America/Denver",   MDT: "America/Denver",
  PST: "America/Los_Angeles", PDT: "America/Los_Angeles",
  AKST: "America/Anchorage", AKDT: "America/Anchorage",
  HST: "Pacific/Honolulu",
  GMT: "Etc/GMT", UTC: "Etc/UTC",
  BST: "Europe/London",
  CET: "Europe/Paris", CEST: "Europe/Paris",
  AEST: "Australia/Sydney", AEDT: "Australia/Sydney",
  JST: "Asia/Tokyo",
};

export function resolveShopTimezone(stored: string | null | undefined): string {
  if (!stored) return "UTC";
  const trimmed = stored.trim();
  if (!trimmed) return "UTC";
  // IANA names always contain a "/" (e.g. "America/New_York"). Trust them.
  if (trimmed.includes("/")) return trimmed;
  const mapped = ABBREV_TO_IANA[trimmed.toUpperCase()];
  return mapped || "UTC";
}

/** YYYY-MM-DD calendar date in the given IANA timezone for `instant`. */
export function dateKeyInTz(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Day-of-week (0=Sun..6=Sat) for `instant` in the given IANA timezone. */
export function dayOfWeekInTz(instant: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(instant);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

/**
 * The DB stores `shopifyDailySales.date` as `YYYY-MM-DDT00:00:00Z` — a UTC
 * timestamp whose date portion is the *shop-local* calendar date. This helper
 * converts a YYYY-MM-DD key into that canonical Date so reads and writes
 * agree.
 */
export function dailySalesRowDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00Z`);
}

/**
 * Returns the shop-local date for "now" plus the previous day. Useful for the
 * nightly reconciliation cron, which targets "yesterday in the shop's tz".
 */
export function shopTodayAndYesterday(tz: string, now: Date = new Date()): { today: string; yesterday: string } {
  const today = dateKeyInTz(now, tz);
  const [y, m, d] = today.split("-").map(Number);
  // Subtract one day from the local calendar date safely (no DST math needed
  // since we never construct a Date at that local instant).
  const prev = new Date(Date.UTC(y, m - 1, d));
  prev.setUTCDate(prev.getUTCDate() - 1);
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const pd = String(prev.getUTCDate()).padStart(2, "0");
  return { today, yesterday: `${py}-${pm}-${pd}` };
}

/**
 * UTC instant boundaries for an entire shop-local calendar day. Used when
 * fetching orders from Shopify for a specific local date — Shopify's
 * `created_at:>=` filter expects an instant.
 */
export function shopDayUtcBounds(dateKey: string, tz: string): { startUtc: Date; endUtc: Date } {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Use noon as a stable probe to avoid DST ambiguity at midnight.
  const probe = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(probe));
  const get = (k: string) => +parts.find(p => p.type === k)!.value;
  // Wall-clock parts at the probe instant in the shop's tz.
  const wallMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour"), get("minute"));
  const offsetMs = wallMs - probe; // local - utc; e.g. -5h for ET in winter
  const startUtc = new Date(Date.UTC(y, m - 1, d) - offsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { startUtc, endUtc };
}
