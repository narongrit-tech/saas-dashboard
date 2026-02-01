/**
 * Bangkok Date Range Utilities
 *
 * STANDARD CONTRACT:
 * - UI sends to server ONLY Bangkok date strings: 'YYYY-MM-DD'
 * - Server actions accept ONLY Bangkok date strings (NOT Date objects)
 * - Never use `new Date('YYYY-MM-DD')` (UTC parsing)
 * - Never use `toISOString().split('T')[0]` (UTC conversion)
 *
 * PURPOSE:
 * Prevent off-by-one errors caused by mixing UTC and Bangkok timezone dates.
 */

import { format, parse } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';

const BANGKOK_TZ = 'Asia/Bangkok';

/**
 * Convert a Date object to Bangkok date string 'YYYY-MM-DD'
 *
 * SAFE: Uses Bangkok timezone explicitly
 * REPLACES: date.toISOString().split('T')[0] (BAD - uses UTC)
 *
 * @param date - Date object to convert
 * @returns Bangkok date string 'YYYY-MM-DD'
 *
 * @example
 * const date = new Date('2026-01-31T17:00:00.000Z') // 00:00 Bangkok (day 32)
 * toBangkokDateString(date) // '2026-02-01' (correct Bangkok date)
 */
export function toBangkokDateString(date: Date): string {
  return formatInTimeZone(date, BANGKOK_TZ, 'yyyy-MM-dd');
}

/**
 * Parse a Bangkok date string to a Date object for UI seeding
 *
 * SAFE: Interprets 'YYYY-MM-DD' as Bangkok midnight (NOT UTC midnight)
 * REPLACES: new Date('YYYY-MM-DD') (BAD - parses as UTC midnight)
 *
 * @param dateString - Bangkok date string 'YYYY-MM-DD'
 * @returns Date object representing Bangkok midnight
 *
 * @example
 * // BAD (UTC parsing):
 * new Date('2026-01-31') // UTC 00:00 = Bangkok 07:00 same day
 *
 * // GOOD (Bangkok parsing):
 * parseBangkokDateStringToLocalDate('2026-01-31') // Bangkok 00:00
 */
export function parseBangkokDateStringToLocalDate(dateString: string): Date {
  // Parse as Bangkok date: 'YYYY-MM-DD' in Bangkok timezone at midnight
  const parsed = parse(dateString, 'yyyy-MM-dd', new Date());

  // Interpret as Bangkok midnight (not UTC midnight)
  const bangkokMidnight = toDate(
    `${dateString}T00:00:00`,
    { timeZone: BANGKOK_TZ }
  );

  return bangkokMidnight;
}

/**
 * Normalize date range input to Bangkok date strings
 *
 * Accepts Date objects or Bangkok date strings, returns Bangkok date strings.
 * Use when component receives mixed date types from props/URL params.
 *
 * @param range - Object with start/end as Date or string
 * @returns Object with startDate/endDate as Bangkok date strings
 *
 * @example
 * normalizeRangeInput({
 *   start: new Date(),
 *   end: '2026-01-31'
 * })
 * // { startDate: '2026-02-02', endDate: '2026-01-31' }
 */
export function normalizeRangeInput(range: {
  start: Date | string;
  end: Date | string;
}): {
  startDate: string;
  endDate: string;
} {
  const startDate =
    typeof range.start === 'string'
      ? range.start
      : toBangkokDateString(range.start);

  const endDate =
    typeof range.end === 'string'
      ? range.end
      : toBangkokDateString(range.end);

  return { startDate, endDate };
}

/**
 * Get today's date as Bangkok date string
 *
 * @returns Today's date in Bangkok timezone as 'YYYY-MM-DD'
 */
export function getTodayBangkokString(): string {
  return toBangkokDateString(new Date());
}

/**
 * Get first day of current month as Bangkok date string
 *
 * @returns First day of month in Bangkok timezone as 'YYYY-MM-DD'
 */
export function getFirstDayOfMonthBangkokString(): string {
  const now = new Date();
  const bangkokNow = toDate(now, { timeZone: BANGKOK_TZ });
  const year = bangkokNow.getFullYear();
  const month = String(bangkokNow.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}
