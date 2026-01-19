/**
 * Simple test script to validate date range boundaries
 * Run with: tsx scripts/test-date-range.ts
 */

import { getDateRangeFromPreset, BANGKOK_TZ } from '../frontend/src/lib/date-range';
import { toZonedTime } from 'date-fns-tz';

function formatTime(date: Date): string {
  const bangkokTime = toZonedTime(date, BANGKOK_TZ);
  return bangkokTime.toLocaleString('th-TH', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

console.log('🧪 Testing Date Range Boundaries (Asia/Bangkok UTC+7)\n');

// Test with a fixed time for consistency
const testNow = new Date('2026-01-19T14:30:00+07:00'); // 2:30 PM Bangkok time
console.log(`Test time: ${formatTime(testNow)}\n`);

const presets = ['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth'] as const;

presets.forEach((preset) => {
  const result = getDateRangeFromPreset(preset, undefined, undefined, testNow);
  console.log(`📅 ${preset.toUpperCase()}`);
  console.log(`   Start: ${formatTime(result.startDate)}`);
  console.log(`   End:   ${formatTime(result.endDate)}`);
  console.log();
});

// Test custom range
const customStart = new Date('2026-01-01T00:00:00+07:00');
const customEnd = new Date('2026-01-15T00:00:00+07:00');
const customResult = getDateRangeFromPreset('custom', customStart, customEnd);
console.log(`📅 CUSTOM`);
console.log(`   Start: ${formatTime(customResult.startDate)}`);
console.log(`   End:   ${formatTime(customResult.endDate)}`);
console.log();

console.log('✅ Validation complete!');
console.log('Expected:');
console.log('- Start dates should be 00:00:00');
console.log('- End dates for historical presets should be 23:59:59');
console.log('- Today/thisMonth end dates should match current time');
