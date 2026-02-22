'use server'

import { toCSVRow } from '@/lib/csv'

/**
 * Company-level Cashflow Server Actions
 * Tracks actual cash movements (in/out) at company level
 *
 * Data Sources:
 * - Cash In: settlement_transactions (actual marketplace settlements)
 * - Cash Out: expenses + wallet_ledger (TOP_UP = cash out from company)
 */

import { unstable_noStore as noStore } from 'next/cache'
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
 * @param source - 'bank' for bank transactions (truth), 'marketplace' for internal records (default)
 */
export async function getCompanyCashflow(
  startDate: Date,
  endDate: Date,
  source: 'bank' | 'marketplace' = 'marketplace'
): Promise<{ success: boolean; data?: CompanyCashflowSummary; error?: string }> {
  noStore(); // Disable caching - always fetch live data

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

    // Aggregate by date (Bangkok timezone bucketing)
    const dailyMap = new Map<string, { cash_in: number; cash_out: number }>()
    let openingBalance = 0

    if (source === 'bank') {
      // ========================================================================
      // Bank View: Use Single Source of Truth (getCashPosition)
      // Query all bank accounts and aggregate
      // ========================================================================
      const { getCompanyCashPosition } = await import(
        '@/app/(dashboard)/bank/cash-position-actions'
      )

      const cashPositionResult = await getCompanyCashPosition({
        startDate: startDateStr,
        endDate: endDateStr,
      })

      if (!cashPositionResult.success || !cashPositionResult.data) {
        throw new Error(cashPositionResult.error || 'Failed to get company cash position')
      }

      const cashPosition = cashPositionResult.data

      // Convert CashPositionResult to CompanyCashflowSummary format
      return {
        success: true,
        data: {
          total_cash_in: cashPosition.cashInTotal,
          total_cash_out: cashPosition.cashOutTotal,
          net_cashflow: cashPosition.netTotal,
          opening_balance: cashPosition.openingBalance,
          closing_balance: cashPosition.endingBalance,
          daily_data: cashPosition.daily.map((day) => ({
            date: day.date,
            cash_in: day.cashIn,
            cash_out: day.cashOut,
            net: day.net,
            running_balance: day.runningBalance,
          })),
        },
      }
    } else {
      // Marketplace View: Query from internal records with pagination

      // Fetch Cash In (settlement_transactions = actual money received from marketplace)
      let cashInData: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('settlement_transactions')
          .select('settled_time, settlement_amount')
          .gte('settled_time', startDateStr)
          .lte('settled_time', endDateStr)
          .order('settled_time', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw new Error(`Cash In query failed: ${error.message}`);

        if (data && data.length > 0) {
          cashInData = cashInData.concat(data);
          hasMore = data.length === pageSize;
          from += pageSize;
        } else {
          hasMore = false;
        }
      }

      // Fetch Cash Out from Expenses (all categories)
      let expensesData: any[] = [];
      from = 0;
      hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('expenses')
          .select('expense_date, amount')
          .gte('expense_date', startDateStr)
          .lte('expense_date', endDateStr)
          .order('expense_date', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw new Error(`Expenses query failed: ${error.message}`);

        if (data && data.length > 0) {
          expensesData = expensesData.concat(data);
          hasMore = data.length === pageSize;
          from += pageSize;
        } else {
          hasMore = false;
        }
      }

      // Fetch Wallet TOP_UP entries (with wallet type to determine cash flow direction)
      // - DIRECTOR_LOAN TOP_UP = Cash IN (CEO transfers money to company)
      // - Other wallet TOP_UP = Cash OUT (company funds wallets)
      let topupData: any[] = [];
      from = 0;
      hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('wallet_ledger')
          .select('date, amount, wallets!inner(wallet_type)')
          .eq('entry_type', 'TOP_UP')
          .eq('direction', 'IN')
          .gte('date', startDateStr)
          .lte('date', endDateStr)
          .order('date', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw new Error(`Wallet top-up query failed: ${error.message}`);

        if (data && data.length > 0) {
          topupData = topupData.concat(data);
          hasMore = data.length === pageSize;
          from += pageSize;
        } else {
          hasMore = false;
        }
      }

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

      // Process Wallet Top-ups (context-aware based on wallet type)
      topupData?.forEach((row) => {
        const date = formatBangkok(row.date, 'yyyy-MM-dd')
        const existing = dailyMap.get(date) || { cash_in: 0, cash_out: 0 }
        const walletType = row.wallets?.wallet_type

        // Director Loan TOP_UP = Cash IN to company (CEO transfers money)
        // Other wallets TOP_UP = Cash OUT from company (company funds wallets)
        if (walletType === 'DIRECTOR_LOAN') {
          dailyMap.set(date, {
            ...existing,
            cash_in: existing.cash_in + (row.amount || 0),
          })
        } else {
          dailyMap.set(date, {
            ...existing,
            cash_out: existing.cash_out + (row.amount || 0),
          })
        }
      })
    }

    // Convert to sorted array with running balance
    const sortedDates = Array.from(dailyMap.keys()).sort()
    let runningBalance = openingBalance

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
        opening_balance: openingBalance,
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
  endDate: Date,
  source: 'bank' | 'marketplace' = 'marketplace'
): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const result = await getCompanyCashflow(startDate, endDate, source)

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
      ...rows.map((row) => toCSVRow(row)),
    ].join('\n')

    // Generate filename with Bangkok timezone timestamp
    const now = new Date()
    const timestamp = formatBangkok(now, 'yyyyMMdd-HHmmss')
    const filename = `company-cashflow-${source}-${timestamp}.csv`

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
