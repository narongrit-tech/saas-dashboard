/**
 * Cashflow Utilities
 *
 * ⚠️ BUSINESS-CRITICAL: This file calculates actual cash movement
 * Backend-only utilities for calculating daily cash movement.
 * This shows REAL money in/out, not accounting profit.
 *
 * Business Logic (DO NOT CHANGE WITHOUT APPROVAL):
 * - Inflow: Sum of completed sales ONLY (actual revenue received)
 * - Outflow: Sum of all expenses (actual money spent)
 * - Net Cash Change: Inflow - Outflow
 * - Running Balance: Simple cumulative sum (no bank API)
 *
 * DIFFERENCE FROM P&L:
 * - P&L: Includes all sales (completed + pending), excludes cancelled
 * - Cashflow: ONLY completed sales (actual cash received)
 *
 * AUDIT SAFETY:
 * - All calculations use RLS-protected queries (user authentication required)
 * - NaN safety guards on all arithmetic operations
 * - Returns 0 for empty data (never null)
 */

import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily Cashflow Data Structure
 */
export interface DailyCashflowData {
  date: string // ISO date string (YYYY-MM-DD)
  cash_in: number // Revenue from completed sales
  cash_out: number // All expenses
  net_change: number // cash_in - cash_out
}

/**
 * Calculate daily cash inflow (completed sales only)
 * BUSINESS RULE: Only completed orders count as cash received
 * Pending and cancelled orders do not affect cashflow
 *
 * @param supabase - Authenticated Supabase client (RLS enforced)
 * @param date - Date in YYYY-MM-DD format
 * @returns Total cash inflow for the date (0 if no data)
 */
async function getDailyCashIn(
  supabase: SupabaseClient,
  date: string
): Promise<number> {
  const startTimestamp = `${date}T00:00:00+07:00`
  const endTimestamp = `${date}T23:59:59+07:00`

  // BUSINESS RULE: Only completed sales = actual cash received
  const { data, error } = await supabase
    .from('sales_orders')
    .select('total_amount')
    .gte('order_date', startTimestamp)
    .lte('order_date', endTimestamp)
    .eq('status', 'completed') // Only completed orders

  if (error) {
    console.error('Error fetching cash in:', error)
    return 0
  }

  // FINANCIAL SAFETY: Ensure non-negative, finite, and properly rounded
  const total = data?.reduce((sum, row) => {
    const amount = row.total_amount || 0
    // Reject negative amounts (data corruption protection)
    return sum + Math.max(0, amount)
  }, 0) || 0

  // Round to 2 decimal places (currency precision)
  const rounded = Math.round(total * 100) / 100
  return Number.isFinite(rounded) && rounded >= 0 ? rounded : 0
}

/**
 * Calculate daily cash outflow (all expenses)
 * BUSINESS RULE: All expenses are considered paid immediately
 *
 * @param supabase - Authenticated Supabase client (RLS enforced)
 * @param date - Date in YYYY-MM-DD format
 * @returns Total cash outflow for the date (0 if no data)
 */
async function getDailyCashOut(
  supabase: SupabaseClient,
  date: string
): Promise<number> {
  const { data, error } = await supabase
    .from('expenses')
    .select('amount')
    .eq('expense_date', date)

  if (error) {
    console.error('Error fetching cash out:', error)
    return 0
  }

  // FINANCIAL SAFETY: Ensure non-negative, finite, and properly rounded
  const total = data?.reduce((sum, row) => {
    const amount = row.amount || 0
    // Reject negative expenses (data corruption protection)
    return sum + Math.max(0, amount)
  }, 0) || 0

  // Round to 2 decimal places (currency precision)
  const rounded = Math.round(total * 100) / 100
  return Number.isFinite(rounded) && rounded >= 0 ? rounded : 0
}

/**
 * Calculate complete Daily Cashflow for a specific date
 *
 * NOTE: Uses server's local time for date. If server is UTC, may need date-fns-tz.
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns Complete cashflow data with cash in/out and net change
 */
export async function getDailyCashflow(date: string): Promise<DailyCashflowData | null> {
  try {
    // Create server client (RLS enforced)
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in getDailyCashflow')
      return null
    }

    // Fetch cash in/out in parallel for performance
    const [cashIn, cashOut] = await Promise.all([
      getDailyCashIn(supabase, date),
      getDailyCashOut(supabase, date),
    ])

    // Calculate net change (with NaN safety and precision rounding)
    let netChange = 0
    if (Number.isFinite(cashIn) && Number.isFinite(cashOut)) {
      const rawChange = cashIn - cashOut
      // Round to 2 decimal places (currency precision)
      netChange = Math.round(rawChange * 100) / 100
    }

    return {
      date,
      cash_in: cashIn,
      cash_out: cashOut,
      net_change: netChange,
    }
  } catch (error) {
    console.error('Unexpected error in getDailyCashflow:', error)
    return null
  }
}

/**
 * Calculate Daily Cashflow for a date range
 * Returns array with running balance
 *
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Array of cashflow data with running balance
 */
export async function getDailyCashflowRange(
  startDate: string,
  endDate: string
): Promise<(DailyCashflowData & { running_balance: number })[]> {
  try {
    // Generate array of dates
    const start = new Date(startDate)
    const end = new Date(endDate)
    const dates: string[] = []

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0])
    }

    // Fetch cashflow for each date in parallel
    const results = await Promise.all(dates.map((date) => getDailyCashflow(date)))

    // Filter out null results and add running balance
    const validResults = results.filter((r): r is DailyCashflowData => r !== null)

    let runningBalance = 0
    return validResults.map((item) => {
      // Add net change and round to prevent floating point accumulation errors
      runningBalance += item.net_change
      // Round running balance to 2 decimal places
      runningBalance = Math.round(runningBalance * 100) / 100

      return {
        ...item,
        running_balance: runningBalance,
      }
    })
  } catch (error) {
    console.error('Unexpected error in getDailyCashflowRange:', error)
    return []
  }
}
