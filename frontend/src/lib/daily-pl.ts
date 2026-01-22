/**
 * Daily P&L (Profit & Loss) Utilities
 *
 * ⚠️ BUSINESS-CRITICAL: This file calculates the core P&L used by business owner
 * Backend-only utilities for calculating daily P&L metrics.
 * NO UI - Pure server-side calculation functions.
 *
 * Business Logic (DO NOT CHANGE WITHOUT APPROVAL):
 * - Revenue: Sum of sales_orders.total_amount (excluding cancelled)
 * - Advertising Cost: Sum of expenses where category = 'Advertising'
 * - COGS: Sum of expenses where category = 'COGS'
 * - Operating Expenses: Sum of expenses where category = 'Operating'
 * - Net Profit: Revenue - Advertising Cost - COGS - Operating Expenses
 *
 * AUDIT SAFETY:
 * - All calculations use RLS-protected queries (user authentication required)
 * - NaN safety guards on all arithmetic operations
 * - Returns 0 for empty data (never null)
 */

import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toBangkokTime, formatBangkok } from '@/lib/bangkok-time'

/**
 * Daily P&L Data Structure
 */
export interface DailyPLData {
  date: string // ISO date string (YYYY-MM-DD)
  revenue: number
  advertising_cost: number
  cogs: number
  operating_expenses: number
  net_profit: number
}

/**
 * Calculate daily revenue (excluding cancelled orders)
 *
 * @param supabase - Authenticated Supabase client (RLS enforced)
 * @param date - Date in YYYY-MM-DD format
 * @returns Total revenue for the date (0 if no data)
 */
async function getDailyRevenue(
  supabase: SupabaseClient,
  date: string
): Promise<number> {
  const startTimestamp = `${date}T00:00:00+07:00`
  const endTimestamp = `${date}T23:59:59+07:00`

  const { data, error } = await supabase
    .from('sales_orders')
    .select('total_amount')
    .gte('order_date', startTimestamp)
    .lte('order_date', endTimestamp)
    .neq('status', 'cancelled')

  if (error) {
    console.error('Error fetching daily revenue:', error)
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
 * Calculate daily expenses by category
 *
 * @param supabase - Authenticated Supabase client (RLS enforced)
 * @param date - Date in YYYY-MM-DD format
 * @param category - Expense category ('Advertising', 'COGS', 'Operating')
 * @returns Total expenses for the category and date (0 if no data)
 */
async function getDailyExpensesByCategory(
  supabase: SupabaseClient,
  date: string,
  category: 'Advertising' | 'COGS' | 'Operating'
): Promise<number> {
  const { data, error } = await supabase
    .from('expenses')
    .select('amount')
    .eq('expense_date', date)
    .eq('category', category)

  if (error) {
    console.error(`Error fetching ${category} expenses:`, error)
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
 * Calculate complete Daily P&L for a specific date
 *
 * NOTE: Uses Bangkok timezone for all date calculations.
 *
 * @param date - Date in YYYY-MM-DD format (Bangkok timezone)
 * @returns Complete P&L data with all components and net profit
 */
export async function getDailyPL(date: string): Promise<DailyPLData | null> {
  try {
    // Create server client (RLS enforced)
    const supabase = createClient()

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed in getDailyPL')
      return null
    }

    // Fetch all components in parallel for performance
    const [revenue, advertisingCost, cogs, operatingExpenses] = await Promise.all([
      getDailyRevenue(supabase, date),
      getDailyExpensesByCategory(supabase, date, 'Advertising'),
      getDailyExpensesByCategory(supabase, date, 'COGS'),
      getDailyExpensesByCategory(supabase, date, 'Operating'),
    ])

    // Calculate net profit (with NaN safety and precision rounding)
    let netProfit = 0
    if (
      Number.isFinite(revenue) &&
      Number.isFinite(advertisingCost) &&
      Number.isFinite(cogs) &&
      Number.isFinite(operatingExpenses)
    ) {
      const rawProfit = revenue - advertisingCost - cogs - operatingExpenses
      // Round to 2 decimal places (currency precision)
      netProfit = Math.round(rawProfit * 100) / 100
    }

    return {
      date,
      revenue,
      advertising_cost: advertisingCost,
      cogs,
      operating_expenses: operatingExpenses,
      net_profit: netProfit,
    }
  } catch (error) {
    console.error('Unexpected error in getDailyPL:', error)
    return null
  }
}

/**
 * Calculate Daily P&L for a date range
 *
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Array of P&L data for each day (empty days return 0 values)
 */
export async function getDailyPLRange(
  startDate: string,
  endDate: string
): Promise<DailyPLData[]> {
  try {
    // Generate array of dates using Bangkok timezone
    const start = toBangkokTime(startDate)
    const end = toBangkokTime(endDate)
    const dates: string[] = []

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(formatBangkok(d, 'yyyy-MM-dd'))
    }

    // Fetch P&L for each date in parallel
    const results = await Promise.all(dates.map((date) => getDailyPL(date)))

    // Filter out null results and return
    return results.filter((r): r is DailyPLData => r !== null)
  } catch (error) {
    console.error('Unexpected error in getDailyPLRange:', error)
    return []
  }
}
