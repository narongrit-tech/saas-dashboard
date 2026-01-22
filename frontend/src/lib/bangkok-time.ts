/**
 * Bangkok Timezone Utilities
 *
 * Central utility for all timezone-related operations.
 * Ensures all date calculations use Asia/Bangkok (UTC+7).
 *
 * CRITICAL: Always use these functions instead of new Date() directly
 * to prevent timezone-related bugs in daily reports and calculations.
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay, format as formatDate } from 'date-fns';

const BANGKOK_TIMEZONE = 'Asia/Bangkok';

/**
 * Get current time in Bangkok timezone
 * Use this instead of new Date() for all business logic
 */
export function getBangkokNow(): Date {
  return toZonedTime(new Date(), BANGKOK_TIMEZONE);
}

/**
 * Convert any Date to Bangkok timezone
 */
export function toBangkokTime(date: Date | string): Date {
  const parsedDate = typeof date === 'string' ? new Date(date) : date;
  return toZonedTime(parsedDate, BANGKOK_TIMEZONE);
}

/**
 * Get start of day (00:00:00) in Bangkok timezone
 * Used for daily report boundaries
 */
export function startOfDayBangkok(date?: Date | string): Date {
  const bangkokDate = date ? toBangkokTime(date) : getBangkokNow();
  return startOfDay(bangkokDate);
}

/**
 * Get end of day (23:59:59.999) in Bangkok timezone
 * Used for daily report boundaries
 */
export function endOfDayBangkok(date?: Date | string): Date {
  const bangkokDate = date ? toBangkokTime(date) : getBangkokNow();
  return endOfDay(bangkokDate);
}

/**
 * Format date in Bangkok timezone
 * @param date - Date to format
 * @param formatStr - date-fns format string (default: 'yyyy-MM-dd')
 */
export function formatBangkok(date: Date | string, formatStr: string = 'yyyy-MM-dd'): string {
  const bangkokDate = toBangkokTime(date);
  return formatDate(bangkokDate, formatStr);
}

/**
 * Get date range for "today" in Bangkok timezone
 * Returns [startOfDay, endOfDay]
 */
export function getTodayRangeBangkok(): [Date, Date] {
  const now = getBangkokNow();
  return [startOfDayBangkok(now), endOfDayBangkok(now)];
}

/**
 * Get date range for a specific date in Bangkok timezone
 * Returns [startOfDay, endOfDay]
 */
export function getDateRangeBangkok(date: Date | string): [Date, Date] {
  const bangkokDate = toBangkokTime(date);
  return [startOfDayBangkok(bangkokDate), endOfDayBangkok(bangkokDate)];
}

/**
 * Convert Bangkok time back to UTC for database storage
 * Use when creating timestamps for database
 */
export function fromBangkokTime(bangkokDate: Date): Date {
  return fromZonedTime(bangkokDate, BANGKOK_TIMEZONE);
}

/**
 * Dev/Debug: Print current Bangkok time info
 * For verification during development
 */
export function debugBangkokTime(): void {
  const now = getBangkokNow();
  const [start, end] = getTodayRangeBangkok();

  console.log('=== Bangkok Time Debug ===');
  console.log('Current Bangkok Time:', formatDate(now, 'yyyy-MM-dd HH:mm:ss'));
  console.log('Today Start (Bangkok):', formatDate(start, 'yyyy-MM-dd HH:mm:ss'));
  console.log('Today End (Bangkok):', formatDate(end, 'yyyy-MM-dd HH:mm:ss'));
  console.log('Server Local Time:', formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss'));
  console.log('========================');
}
