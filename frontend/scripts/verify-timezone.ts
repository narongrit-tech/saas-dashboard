/**
 * Timezone Verification Script
 *
 * This script verifies that Bangkok timezone utilities are working correctly.
 * Run with: npx tsx scripts/verify-timezone.ts
 *
 * Checks:
 * 1. Current Bangkok time vs server time
 * 2. Today's date range in Bangkok timezone
 * 3. Date boundary correctness (startOfDay, endOfDay)
 * 4. Date conversion accuracy
 */

import {
  getBangkokNow,
  startOfDayBangkok,
  endOfDayBangkok,
  formatBangkok,
  getTodayRangeBangkok,
  toBangkokTime,
  debugBangkokTime,
} from '../src/lib/bangkok-time'

console.log('╔═══════════════════════════════════════════════════════╗')
console.log('║     Bangkok Timezone Verification Script             ║')
console.log('╚═══════════════════════════════════════════════════════╝')
console.log('')

// Test 1: Current time comparison
console.log('✓ Test 1: Current Time Comparison')
console.log('─────────────────────────────────────────────────────────')
const serverNow = new Date()
const bangkokNow = getBangkokNow()

console.log(`Server Time:   ${serverNow.toISOString()}`)
console.log(`Bangkok Time:  ${bangkokNow.toISOString()}`)
console.log(`Formatted:     ${formatBangkok(bangkokNow, 'yyyy-MM-dd HH:mm:ss')}`)
console.log('')

// Test 2: Today's date range
console.log('✓ Test 2: Today\'s Date Range in Bangkok')
console.log('─────────────────────────────────────────────────────────')
const [todayStart, todayEnd] = getTodayRangeBangkok()
console.log(`Start of Day:  ${todayStart.toISOString()}`)
console.log(`               ${formatBangkok(todayStart, 'yyyy-MM-dd HH:mm:ss')}`)
console.log(`End of Day:    ${todayEnd.toISOString()}`)
console.log(`               ${formatBangkok(todayEnd, 'yyyy-MM-dd HH:mm:ss')}`)
console.log('')

// Test 3: Specific date conversion
console.log('✓ Test 3: Specific Date Conversion')
console.log('─────────────────────────────────────────────────────────')
const testDateStr = '2026-01-23'
const testDate = toBangkokTime(testDateStr)
const testStart = startOfDayBangkok(testDateStr)
const testEnd = endOfDayBangkok(testDateStr)

console.log(`Input Date:    ${testDateStr}`)
console.log(`Bangkok Date:  ${formatBangkok(testDate, 'yyyy-MM-dd HH:mm:ss')}`)
console.log(`Start of Day:  ${formatBangkok(testStart, 'yyyy-MM-dd HH:mm:ss')}`)
console.log(`End of Day:    ${formatBangkok(testEnd, 'yyyy-MM-dd HH:mm:ss')}`)
console.log('')

// Test 4: Date boundary verification
console.log('✓ Test 4: Date Boundary Verification')
console.log('─────────────────────────────────────────────────────────')
const startHour = testStart.getHours()
const startMinute = testStart.getMinutes()
const startSecond = testStart.getSeconds()
const endHour = testEnd.getHours()
const endMinute = testEnd.getMinutes()
const endSecond = testEnd.getSeconds()

console.log(`Start time: ${startHour}:${startMinute}:${startSecond}`)
console.log(`Expected:   0:0:0`)
console.log(`✓ Match: ${startHour === 0 && startMinute === 0 && startSecond === 0 ? 'YES' : 'NO'}`)
console.log('')

console.log(`End time: ${endHour}:${endMinute}:${endSecond}`)
console.log(`Expected: 23:59:59`)
console.log(`✓ Match: ${endHour === 23 && endMinute === 59 && endSecond === 59 ? 'YES' : 'NO'}`)
console.log('')

// Test 5: Multiple date conversions
console.log('✓ Test 5: Multiple Date Conversions')
console.log('─────────────────────────────────────────────────────────')
const testDates = ['2026-01-01', '2026-06-15', '2026-12-31']
testDates.forEach((dateStr) => {
  const bangkokDate = toBangkokTime(dateStr)
  const formatted = formatBangkok(bangkokDate, 'yyyy-MM-dd (EEE)')
  console.log(`${dateStr} → ${formatted}`)
})
console.log('')

// Test 6: Debug output
console.log('✓ Test 6: Debug Bangkok Time')
console.log('─────────────────────────────────────────────────────────')
debugBangkokTime()
console.log('')

// Summary
console.log('╔═══════════════════════════════════════════════════════╗')
console.log('║                  Verification Complete                ║')
console.log('╚═══════════════════════════════════════════════════════╝')
console.log('')
console.log('Expected Results:')
console.log('  1. Bangkok time should be UTC+7 (or match Asia/Bangkok)')
console.log('  2. Start of day should be 00:00:00 Bangkok time')
console.log('  3. End of day should be 23:59:59 Bangkok time')
console.log('  4. All date conversions should preserve Bangkok timezone')
console.log('')
console.log('⚠️  IMPORTANT: If server is in different timezone (e.g., UTC),')
console.log('    Bangkok times will differ from server local times.')
console.log('    This is expected and correct behavior.')
console.log('')
