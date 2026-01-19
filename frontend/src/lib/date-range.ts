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

export interface DateRangeResult {
  preset: DatePreset;
  startDate: Date;
  endDate: Date;
}

/**
 * Get date range from preset with Asia/Bangkok timezone
 * @param preset - The preset type
 * @param customStart - Custom start date (for 'custom' preset)
 * @param customEnd - Custom end date (for 'custom' preset)
 * @param now - Optional current time (for testing)
 * @returns Date range with start and end dates
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
      endDate = currentTime; // Not end of day - use current time
      break;

    case 'yesterday':
      const yesterday = subDays(currentTime, 1);
      startDate = startOfDay(yesterday);
      endDate = endOfDay(yesterday);
      break;

    case 'last7days':
      startDate = startOfDay(subDays(currentTime, 6)); // Today + 6 days ago = 7 days total
      endDate = endOfDay(currentTime);
      break;

    case 'last30days':
      startDate = startOfDay(subDays(currentTime, 29)); // Today + 29 days ago = 30 days total
      endDate = endOfDay(currentTime);
      break;

    case 'thisMonth':
      startDate = startOfMonth(currentTime);
      endDate = currentTime; // Not end of month - use current time (MTD)
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
      endDate = endOfDay(toZonedTime(customEnd, BANGKOK_TZ));
      break;

    default:
      throw new Error(`Unknown preset: ${preset}`);
  }

  // Convert back to UTC for storage/query
  return {
    preset,
    startDate: fromZonedTime(startDate, BANGKOK_TZ),
    endDate: fromZonedTime(endDate, BANGKOK_TZ),
  };
}

/**
 * Format date range for display
 */
export function formatDateRange(startDate: Date, endDate: Date): string {
  const bangkokStart = toZonedTime(startDate, BANGKOK_TZ);
  const bangkokEnd = toZonedTime(endDate, BANGKOK_TZ);

  const startStr = bangkokStart.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const endStr = bangkokEnd.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

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
