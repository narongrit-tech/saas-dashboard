'use server'

import { getDailyCashflow, getDailyCashflowRange, DailyCashflowData } from '@/lib/cashflow'
import { createClient } from '@/lib/supabase/server'
import { addDays } from 'date-fns'
import { getBangkokNow, toBangkokTime, formatBangkok } from '@/lib/bangkok-time'

interface CashflowResult {
  success: boolean
  error?: string
  data?: DailyCashflowData
}

interface CashflowRangeResult {
  success: boolean
  error?: string
  data?: (DailyCashflowData & { running_balance: number })[]
}

/**
 * Get Daily Cashflow data for a specific date
 */
export async function getDailyCashflowForDate(date: string): Promise<CashflowResult> {
  try {
    const cashflowData = await getDailyCashflow(date)

    if (!cashflowData) {
      return { success: false, error: 'ไม่สามารถโหลดข้อมูล Cashflow ได้' }
    }

    return { success: true, data: cashflowData }
  } catch (error) {
    console.error('Error in getDailyCashflowForDate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Get Cashflow data for a date range with running balance
 */
export async function getCashflowRange(
  startDate: string,
  endDate: string
): Promise<CashflowRangeResult> {
  try {
    const rangeData = await getDailyCashflowRange(startDate, endDate)

    if (!rangeData || rangeData.length === 0) {
      return { success: false, error: 'ไม่พบข้อมูลในช่วงวันที่ที่เลือก' }
    }

    return { success: true, data: rangeData }
  } catch (error) {
    console.error('Error in getCashflowRange:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Get Unsettled Transactions Summary for date range
 */
export async function getUnsettledSummary(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data, error } = await supabase
      .from('unsettled_transactions')
      .select('estimated_settlement_amount')
      .eq('created_by', user.id)
      .eq('status', 'unsettled')
      .gte('estimated_settle_time', startDate.toISOString())
      .lte('estimated_settle_time', endDate.toISOString())

    if (error) {
      console.error('Error fetching unsettled summary:', error)
      return { success: false, error: error.message }
    }

    const pendingAmount =
      data?.reduce((sum, txn) => sum + (txn.estimated_settlement_amount || 0), 0) || 0

    return {
      success: true,
      data: {
        pending_amount: pendingAmount,
        transaction_count: data?.length || 0,
      },
    }
  } catch (err) {
    console.error('Error in getUnsettledSummary:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Get Unsettled Transactions for date range
 */
export async function getUnsettledTransactions(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data, error } = await supabase
      .from('unsettled_transactions')
      .select('*')
      .eq('created_by', user.id)
      .eq('status', 'unsettled')
      .gte('estimated_settle_time', startDate.toISOString())
      .lte('estimated_settle_time', endDate.toISOString())
      .order('estimated_settle_time', { ascending: true })

    if (error) {
      console.error('Error fetching unsettled transactions:', error)
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: data || [],
    }
  } catch (err) {
    console.error('Error in getUnsettledTransactions:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Get Next 7 Days Forecast
 */
export async function getNext7DaysForecast() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const now = getBangkokNow()
    const sevenDaysLater = addDays(now, 7)

    const { data, error } = await supabase
      .from('unsettled_transactions')
      .select('estimated_settle_time, estimated_settlement_amount')
      .eq('created_by', user.id)
      .eq('status', 'unsettled')
      .gte('estimated_settle_time', now.toISOString())
      .lte('estimated_settle_time', sevenDaysLater.toISOString())
      .order('estimated_settle_time', { ascending: true })

    if (error) {
      console.error('Error fetching next 7 days forecast:', error)
      return { success: false, error: error.message }
    }

    // Group by date
    const grouped = new Map<string, { amount: number; count: number }>()

    data?.forEach((txn) => {
      if (!txn.estimated_settle_time) return

      const bangkokDate = toBangkokTime(txn.estimated_settle_time)
      const date = formatBangkok(bangkokDate, 'yyyy-MM-dd')
      const existing = grouped.get(date) || { amount: 0, count: 0 }
      grouped.set(date, {
        amount: existing.amount + (txn.estimated_settlement_amount || 0),
        count: existing.count + 1,
      })
    })

    const forecast = Array.from(grouped.entries())
      .map(([date, { amount, count }]) => ({
        date,
        expected_amount: amount,
        transaction_count: count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      success: true,
      data: forecast,
    }
  } catch (err) {
    console.error('Error in getNext7DaysForecast:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Get Settled Transactions Summary for date range
 */
export async function getSettledSummary(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data, error } = await supabase
      .from('settlement_transactions')
      .select('settlement_amount')
      .eq('created_by', user.id)
      .gte('settled_time', startDate.toISOString())
      .lte('settled_time', endDate.toISOString())

    if (error) {
      console.error('Error fetching settled summary:', error)
      return { success: false, error: error.message }
    }

    const settledAmount =
      data?.reduce((sum, txn) => sum + (txn.settlement_amount || 0), 0) || 0

    return {
      success: true,
      data: {
        settled_amount: settledAmount,
        transaction_count: data?.length || 0,
      },
    }
  } catch (err) {
    console.error('Error in getSettledSummary:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Get Settled Transactions for date range
 */
export async function getSettledTransactions(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data, error } = await supabase
      .from('settlement_transactions')
      .select('*')
      .eq('created_by', user.id)
      .gte('settled_time', startDate.toISOString())
      .lte('settled_time', endDate.toISOString())
      .order('settled_time', { ascending: false })

    if (error) {
      console.error('Error fetching settled transactions:', error)
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: data || [],
    }
  } catch (err) {
    console.error('Error in getSettledTransactions:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Get Overdue Forecast (unsettled past estimated_settle_time)
 */
export async function getOverdueForecast() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const now = getBangkokNow()

    const { data, error } = await supabase
      .from('unsettled_transactions')
      .select('*')
      .eq('created_by', user.id)
      .eq('status', 'unsettled')
      .lt('estimated_settle_time', now.toISOString())
      .order('estimated_settle_time', { ascending: true })

    if (error) {
      console.error('Error fetching overdue forecast:', error)
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: data || [],
    }
  } catch (err) {
    console.error('Error in getOverdueForecast:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Get Settled Without Forecast (settled but no matching unsettled record)
 */
export async function getSettledWithoutForecast(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    // Get all settled transactions in range
    const { data: settled, error: settledError } = await supabase
      .from('settlement_transactions')
      .select('*')
      .eq('created_by', user.id)
      .gte('settled_time', startDate.toISOString())
      .lte('settled_time', endDate.toISOString())

    if (settledError) {
      console.error('Error fetching settled transactions:', settledError)
      return { success: false, error: settledError.message }
    }

    // Filter those without matching unsettled record
    const withoutForecast = []
    for (const settlement of settled || []) {
      const { data: unsettled } = await supabase
        .from('unsettled_transactions')
        .select('id')
        .eq('marketplace', settlement.marketplace)
        .eq('txn_id', settlement.txn_id)
        .eq('created_by', user.id)
        .single()

      if (!unsettled) {
        withoutForecast.push(settlement)
      }
    }

    return {
      success: true,
      data: withoutForecast,
    }
  } catch (err) {
    console.error('Error in getSettledWithoutForecast:', err)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Daily Reconciliation Data (Forecast vs Actual)
 */
export interface DailyReconciliationRow {
  date: string
  forecast_amount: number
  forecast_count: number
  actual_amount: number
  actual_count: number
  gap: number
  status: 'forecast-only' | 'actual-only' | 'matched' | 'overdue'
}

/**
 * Get Daily Reconciliation (grouped by date)
 * For debugging and reconciliation with TikTok daily reports
 */
export async function getDailyReconciliation(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const now = getBangkokNow()

    // Fetch unsettled transactions (forecast)
    const { data: unsettledData, error: unsettledError } = await supabase
      .from('unsettled_transactions')
      .select('estimated_settle_time, estimated_settlement_amount')
      .eq('created_by', user.id)
      .eq('status', 'unsettled')
      .gte('estimated_settle_time', startDate.toISOString())
      .lte('estimated_settle_time', endDate.toISOString())

    if (unsettledError) {
      console.error('Error fetching unsettled for daily reconciliation:', unsettledError)
      return { success: false, error: unsettledError.message }
    }

    // Fetch settled transactions (actual)
    const { data: settledData, error: settledError } = await supabase
      .from('settlement_transactions')
      .select('settled_time, settlement_amount')
      .eq('created_by', user.id)
      .gte('settled_time', startDate.toISOString())
      .lte('settled_time', endDate.toISOString())

    if (settledError) {
      console.error('Error fetching settled for daily reconciliation:', settledError)
      return { success: false, error: settledError.message }
    }

    // Group unsettled by date (forecast)
    const forecastByDate = new Map<string, { amount: number; count: number }>()
    unsettledData?.forEach((txn) => {
      if (!txn.estimated_settle_time) return

      const bangkokDate = toBangkokTime(txn.estimated_settle_time)
      const date = formatBangkok(bangkokDate, 'yyyy-MM-dd')
      const existing = forecastByDate.get(date) || { amount: 0, count: 0 }
      forecastByDate.set(date, {
        amount: existing.amount + (txn.estimated_settlement_amount || 0),
        count: existing.count + 1,
      })
    })

    // Group settled by date (actual)
    const actualByDate = new Map<string, { amount: number; count: number }>()
    settledData?.forEach((txn) => {
      if (!txn.settled_time) return

      const bangkokDate = toBangkokTime(txn.settled_time)
      const date = formatBangkok(bangkokDate, 'yyyy-MM-dd')
      const existing = actualByDate.get(date) || { amount: 0, count: 0 }
      actualByDate.set(date, {
        amount: existing.amount + (txn.settlement_amount || 0),
        count: existing.count + 1,
      })
    })

    // Merge both maps to create daily reconciliation
    const allDates = new Set([
      ...Array.from(forecastByDate.keys()),
      ...Array.from(actualByDate.keys())
    ])
    const dailyData: DailyReconciliationRow[] = []

    allDates.forEach((date) => {
      const forecast = forecastByDate.get(date) || { amount: 0, count: 0 }
      const actual = actualByDate.get(date) || { amount: 0, count: 0 }
      const gap = actual.amount - forecast.amount

      // Determine status
      let status: DailyReconciliationRow['status']
      const dateObj = toBangkokTime(date)
      const isOverdue = dateObj < now

      if (forecast.count > 0 && actual.count === 0) {
        status = isOverdue ? 'overdue' : 'forecast-only'
      } else if (forecast.count === 0 && actual.count > 0) {
        status = 'actual-only'
      } else {
        status = 'matched'
      }

      dailyData.push({
        date,
        forecast_amount: forecast.amount,
        forecast_count: forecast.count,
        actual_amount: actual.amount,
        actual_count: actual.count,
        gap,
        status,
      })
    })

    // Sort by date descending (newest first)
    dailyData.sort((a, b) => b.date.localeCompare(a.date))

    return {
      success: true,
      data: dailyData,
    }
  } catch (err) {
    console.error('Error in getDailyReconciliation:', err)
    return { success: false, error: 'Internal server error' }
  }
}
