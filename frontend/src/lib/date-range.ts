import {
  startOfDay,
  endOfDay,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const BANGKOK_TZ = 'Asia/Bangkok';

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

// UI state: Bangkok calendar date strings (YYYY-MM-DD)
export interface DateRangeResult {
  preset: DatePreset;
  startDate: string; // YYYY-MM-DD calendar date (Bangkok timezone)
  endDate: string; // YYYY-MM-DD calendar date (Bangkok timezone)
}

// Server query: Date objects with timestamps
export interface DateRangeQuery {
  startDate: Date; // Start of day timestamp
  endDate: Date; // End of day timestamp
}

/**
 * Get date range from preset with Asia/Bangkok timezone
 * Returns calendar date strings (YYYY-MM-DD) for UI state
 *
 * @param preset - The preset type
 * @param customStart - Custom start date (for 'custom' preset)
 * @param customEnd - Custom end date (for 'custom' preset)
 * @param now - Optional current time (for testing)
 * @returns Date range with start and end as YYYY-MM-DD strings
 */
export function getDateRangeFromPreset(
  preset: DatePreset,
  customStart?: Date,
  customEnd?: Date,
  now?: Date
): DateRangeResult {
  // Use provided now or current time in Bangkok timezone
  const currentTime = now ? toZonedTime(now, BANGKOK_TZ) : toZonedTime(new Date(), BANGKOK_TZ);

  let startDate: Date;
  let endDate: Date;

  switch (preset) {
    case 'today':
      startDate = startOfDay(currentTime);
      endDate = startOfDay(currentTime); // Same day for calendar
      break;

    case 'yesterday':
      const yesterday = subDays(currentTime, 1);
      startDate = startOfDay(yesterday);
      endDate = startOfDay(yesterday);
      break;

    case 'last7days':
      startDate = startOfDay(subDays(currentTime, 6)); // Today + 6 days ago = 7 days total
      endDate = startOfDay(currentTime);
      break;

    case 'last30days':
      startDate = startOfDay(subDays(currentTime, 29)); // Today + 29 days ago = 30 days total
      endDate = startOfDay(currentTime);
      break;

    case 'thisMonth':
      startDate = startOfMonth(currentTime);
      endDate = startOfDay(currentTime); // Current day for calendar (MTD)
      break;

    case 'lastMonth':
      const lastMonth = subMonths(currentTime, 1);
      startDate = startOfMonth(lastMonth);
      endDate = endOfMonth(lastMonth);
      break;

    case 'custom':
      if (!customStart || !customEnd) {
        throw new Error('Custom preset requires customStart and customEnd dates');
      }
      startDate = startOfDay(toZonedTime(customStart, BANGKOK_TZ));
      endDate = startOfDay(toZonedTime(customEnd, BANGKOK_TZ));
      break;

    default:
      throw new Error(`Unknown preset: ${preset}`);
  }

  // Return as YYYY-MM-DD calendar date strings (Bangkok timezone)
  const formatCalendarDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    preset,
    startDate: formatCalendarDate(startDate),
    endDate: formatCalendarDate(endDate),
  };
}

/**
 * Convert calendar date string (YYYY-MM-DD) to Date object with Bangkok timezone
 * Used for server queries (adds timestamps)
 * CRITICAL: Explicitly create Date in Bangkok timezone to avoid drift
 */
export function toDateQuery(calendarDate: string, isEndOfDay: boolean = false): Date {
  // Parse YYYY-MM-DD as Bangkok timezone date (midnight)
  const [year, month, day] = calendarDate.split('-').map(Number);

  // Create Date object in UTC first (to avoid local timezone issues)
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  // Convert to Bangkok timezone
  const bangkokDate = toZonedTime(utcDate, BANGKOK_TZ);

  // Apply start/end of day in Bangkok timezone
  const result = isEndOfDay ? endOfDay(bangkokDate) : startOfDay(bangkokDate);

  // Convert back to UTC for server query
  return fromZonedTime(result, BANGKOK_TZ);
}

/**
 * Convert UI date range (calendar strings) to server query (Date objects with timestamps)
 */
export function toDateRangeQuery(range: DateRangeResult): DateRangeQuery {
  return {
    startDate: toDateQuery(range.startDate, false), // Start of day
    endDate: toDateQuery(range.endDate, true), // End of day
  };
}

/**
 * Format date range for display (from calendar date strings)
 * CRITICAL: Format directly from YYYY-MM-DD strings to avoid timezone drift
 */
export function formatDateRange(startDate: string, endDate: string): string {
  // Format YYYY-MM-DD calendar string to Thai format
  const formatCalendarDate = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);

    // Thai month names (short)
    const thaiMonths = [
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ];

    // Convert to Buddhist year (Thai calendar)
    const buddhistYear = year + 543;

    return `${day} ${thaiMonths[month - 1]} ${buddhistYear}`;
  };

  const startStr = formatCalendarDate(startDate);
  const endStr = formatCalendarDate(endDate);

  if (startStr === endStr) {
    return startStr;
  }

  return `${startStr} - ${endStr}`;
}

/**
 * Get current time in Bangkok timezone
 */
export function getBangkokNow(): Date {
  return toZonedTime(new Date(), BANGKOK_TZ);
}

/**
 * Convert date to Bangkok timezone for display
 */
export function toBangkokTime(date: Date): Date {
  return toZonedTime(date, BANGKOK_TZ);
}

/**
 * Convert Bangkok time to UTC for storage
 */
export function fromBangkokTime(date: Date): Date {
  return fromZonedTime(date, BANGKOK_TZ);
}

export { BANGKOK_TZ };
