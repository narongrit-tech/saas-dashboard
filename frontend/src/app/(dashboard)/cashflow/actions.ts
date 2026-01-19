'use server'

import { getDailyCashflow, getDailyCashflowRange, DailyCashflowData } from '@/lib/cashflow'
import { createClient } from '@/lib/supabase/server'
import { addDays } from 'date-fns'

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

    const now = new Date()
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

      const date = new Date(txn.estimated_settle_time).toISOString().split('T')[0]
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
