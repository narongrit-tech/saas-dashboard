'use server'

/**
 * Company-level Cashflow Server Actions
 * Tracks actual cash movements (in/out) at company level
 *
 * Data Sources:
 * - Cash In: settlement_transactions (actual marketplace settlements)
 * - Cash Out: expenses + wallet_ledger (TOP_UP = cash out from company)
 */

import { createClient } from '@/lib/supabase/server'
import { formatBangkok, startOfDayBangkok, endOfDayBangkok } from '@/lib/bangkok-time'

export interface CompanyCashflowRow {
  date: string // YYYY-MM-DD
  cash_in: number
  cash_out: number
  net: number
  running_balance: number
}

export interface CompanyCashflowSummary {
  total_cash_in: number
  total_cash_out: number
  net_cashflow: number
  opening_balance: number // TODO: implement when we have company bank account data
  closing_balance: number
  daily_data: CompanyCashflowRow[]
}

/**
 * Get company cashflow for date range
 */
export async function getCompanyCashflow(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; data?: CompanyCashflowSummary; error?: string }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    const startDateStr = formatBangkok(startOfDayBangkok(startDate), 'yyyy-MM-dd')
    const endDateStr = formatBangkok(endOfDayBangkok(endDate), 'yyyy-MM-dd')

    // Fetch Cash In (settlement_transactions = actual money received from marketplace)
    const { data: cashInData, error: cashInError } = await supabase
      .from('settlement_transactions')
      .select('settled_time, settlement_amount')
      .gte('settled_time', startDateStr)
      .lte('settled_time', endDateStr)
      .order('settled_time', { ascending: true })

    if (cashInError) throw new Error(`Cash In query failed: ${cashInError.message}`)

    // Fetch Cash Out from Expenses (all categories)
    const { data: expensesData, error: expensesError } = await supabase
      .from('expenses')
      .select('expense_date, amount')
      .gte('expense_date', startDateStr)
      .lte('expense_date', endDateStr)
      .order('expense_date', { ascending: true })

    if (expensesError) throw new Error(`Expenses query failed: ${expensesError.message}`)

    // Fetch Cash Out from Wallet TOP_UP (cash transfer from company to wallet)
    const { data: topupData, error: topupError } = await supabase
      .from('wallet_ledger')
      .select('transaction_date, amount')
      .eq('entry_type', 'TOP_UP')
      .eq('direction', 'IN') // IN to wallet = OUT from company
      .gte('transaction_date', startDateStr)
      .lte('transaction_date', endDateStr)
      .order('transaction_date', { ascending: true })

    if (topupError) throw new Error(`Wallet top-up query failed: ${topupError.message}`)

    // Aggregate by date (Bangkok timezone bucketing)
    const dailyMap = new Map<string, { cash_in: number; cash_out: number }>()

    // Process Cash In
    cashInData?.forEach((row) => {
      const date = formatBangkok(row.settled_time, 'yyyy-MM-dd')
      const existing = dailyMap.get(date) || { cash_in: 0, cash_out: 0 }
      dailyMap.set(date, {
        ...existing,
        cash_in: existing.cash_in + (row.settlement_amount || 0),
      })
    })

    // Process Cash Out - Expenses
    expensesData?.forEach((row) => {
      const date = formatBangkok(row.expense_date, 'yyyy-MM-dd')
      const existing = dailyMap.get(date) || { cash_in: 0, cash_out: 0 }
      dailyMap.set(date, {
        ...existing,
        cash_out: existing.cash_out + (row.amount || 0),
      })
    })

    // Process Cash Out - Wallet Top-ups
    topupData?.forEach((row) => {
      const date = formatBangkok(row.transaction_date, 'yyyy-MM-dd')
      const existing = dailyMap.get(date) || { cash_in: 0, cash_out: 0 }
      dailyMap.set(date, {
        ...existing,
        cash_out: existing.cash_out + (row.amount || 0),
      })
    })

    // Convert to sorted array with running balance
    const sortedDates = Array.from(dailyMap.keys()).sort()
    let runningBalance = 0 // TODO: Get opening balance from company bank account when available

    const dailyData: CompanyCashflowRow[] = sortedDates.map((date) => {
      const day = dailyMap.get(date)!
      const net = day.cash_in - day.cash_out
      runningBalance += net

      return {
        date,
        cash_in: day.cash_in,
        cash_out: day.cash_out,
        net,
        running_balance: runningBalance,
      }
    })

    // Calculate totals
    const total_cash_in = dailyData.reduce((sum, d) => sum + d.cash_in, 0)
    const total_cash_out = dailyData.reduce((sum, d) => sum + d.cash_out, 0)
    const net_cashflow = total_cash_in - total_cash_out

    return {
      success: true,
      data: {
        total_cash_in,
        total_cash_out,
        net_cashflow,
        opening_balance: 0, // TODO: implement
        closing_balance: runningBalance,
        daily_data: dailyData,
      },
    }
  } catch (error) {
    console.error('[Company Cashflow] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
    }
  }
}

/**
 * Export company cashflow to CSV
 */
export async function exportCompanyCashflow(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const result = await getCompanyCashflow(startDate, endDate)

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'ไม่สามารถโหลดข้อมูลได้' }
    }

    const { daily_data } = result.data

    // Generate CSV
    const headers = [
      'Date',
      'Cash In',
      'Cash Out',
      'Net',
      'Running Balance',
    ]

    const rows = daily_data.map((row) => [
      row.date,
      row.cash_in.toFixed(2),
      row.cash_out.toFixed(2),
      row.net.toFixed(2),
      row.running_balance.toFixed(2),
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n')

    // Generate filename with Bangkok timezone timestamp
    const now = new Date()
    const timestamp = formatBangkok(now, 'yyyyMMdd-HHmmss')
    const filename = `company-cashflow-${timestamp}.csv`

    return {
      success: true,
      csv: csvContent,
      filename,
    }
  } catch (error) {
    console.error('[Company Cashflow Export] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการ export',
    }
  }
}
