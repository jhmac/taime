/**
 * Returns the date exactly 52 weeks (364 days) before the given date.
 *
 * Why 364 and not 365?
 *   52 × 7 = 364. Subtracting 364 days always lands on the same weekday,
 *   making year-over-year comparisons weekday-accurate (e.g. Thursday → Thursday).
 *   Subtracting 365 (or 366 in a leap year) shifts the weekday by one or two days,
 *   comparing apples to oranges for retail traffic patterns.
 *
 * Example: Thursday May 7, 2026 − 364 days = Thursday May 8, 2025 ✓
 *          (setFullYear would give Wednesday May 7, 2025 ✗)
 */
export function sameWeekdayLastYear(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 364);
  return d;
}
