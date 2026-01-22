'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import { getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'

export interface TodayStats {
  totalSales: number
  totalExpenses: number
  netProfit: number
}

export interface TrendData {
  date: string
  sales: number
  expenses: number
}

export interface DashboardData {
  todayStats: TodayStats
  trends: TrendData[]
}

interface ActionResult {
  success: boolean
  error?: string
  data?: DashboardData
}

export async function getDashboardStats(): Promise<ActionResult> {
  try {
    // 1. Create Supabase server client and get user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Get today's date in Asia/Bangkok timezone
    // Using explicit Bangkok timezone to prevent date boundary issues
    const today = getBangkokNow()
    const todayStr = format(today, 'yyyy-MM-dd')

    // For TIMESTAMP columns, use date range instead of equality
    const todayStart = `${todayStr}T00:00:00+07:00` // Start of day in Bangkok timezone
    const todayEnd = `${todayStr}T23:59:59+07:00`   // End of day in Bangkok timezone

    // 3. Query Sales Today (exclude Cancelled)
    // BUSINESS RULE: Revenue = sum(total_amount) where status != 'cancelled'
    // Cancelled orders must be excluded from revenue calculations
    const { data: salesTodayData, error: salesTodayError } = await supabase
      .from('sales_orders')
      .select('total_amount')
      .gte('order_date', todayStart)
      .lte('order_date', todayEnd)
      .neq('status', 'cancelled')

    if (salesTodayError) {
      console.error('Error fetching sales today:', salesTodayError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${salesTodayError.message}` }
    }

    // FINANCIAL SAFETY: Ensure non-negative, finite, and properly rounded
    const totalSalesToday = salesTodayData?.reduce((sum, row) => {
      const amount = row.total_amount || 0
      return sum + Math.max(0, amount) // Reject negative amounts
    }, 0) || 0
    const roundedSalesToday = Math.round(totalSalesToday * 100) / 100

    // 4. Query Expenses Today
    const { data: expensesTodayData, error: expensesTodayError } = await supabase
      .from('expenses')
      .select('amount')
      .eq('expense_date', todayStr)

    if (expensesTodayError) {
      console.error('Error fetching expenses today:', expensesTodayError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${expensesTodayError.message}` }
    }

    // FINANCIAL SAFETY: Ensure non-negative, finite, and properly rounded
    const totalExpensesToday = expensesTodayData?.reduce((sum, row) => {
      const amount = row.amount || 0
      return sum + Math.max(0, amount) // Reject negative expenses
    }, 0) || 0
    const roundedExpensesToday = Math.round(totalExpensesToday * 100) / 100

    // 5. Calculate Net Profit Today (with NaN safety and precision rounding)
    let netProfitToday = 0
    if (Number.isFinite(roundedSalesToday) && Number.isFinite(roundedExpensesToday)) {
      const rawProfit = roundedSalesToday - roundedExpensesToday
      netProfitToday = Math.round(rawProfit * 100) / 100
    }

    // 6. Generate last 7 days array (including today)
    const last7Days: Date[] = []
    for (let i = 6; i >= 0; i--) {
      last7Days.push(startOfDayBangkok(subDays(today, i)))
    }

    // 7. Query 7-Day Sales Trend (exclude Cancelled)
    const startDate = format(last7Days[0], 'yyyy-MM-dd')
    const endDate = format(last7Days[last7Days.length - 1], 'yyyy-MM-dd')
    const startDateTimestamp = `${startDate}T00:00:00+07:00`
    const endDateTimestamp = `${endDate}T23:59:59+07:00`

    const { data: salesTrendData, error: salesTrendError } = await supabase
      .from('sales_orders')
      .select('order_date, total_amount')
      .gte('order_date', startDateTimestamp)
      .lte('order_date', endDateTimestamp)
      .neq('status', 'cancelled')

    if (salesTrendError) {
      console.error('Error fetching sales trend:', salesTrendError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${salesTrendError.message}` }
    }

    // Group sales by date (extract date part from TIMESTAMP)
    // FINANCIAL SAFETY: Reject negative amounts and round per-date totals
    const salesByDate = new Map<string, number>()
    salesTrendData?.forEach((row) => {
      // Extract date part from timestamp (e.g., "2026-01-19T15:30:00+07:00" -> "2026-01-19")
      const date = row.order_date.split('T')[0]
      const current = salesByDate.get(date) || 0
      const amount = Math.max(0, row.total_amount || 0)
      salesByDate.set(date, current + amount)
    })

    // 8. Query 7-Day Expenses Trend
    const { data: expensesTrendData, error: expensesTrendError } = await supabase
      .from('expenses')
      .select('expense_date, amount')
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)

    if (expensesTrendError) {
      console.error('Error fetching expenses trend:', expensesTrendError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${expensesTrendError.message}` }
    }

    // Group expenses by date
    // FINANCIAL SAFETY: Reject negative amounts and round per-date totals
    const expensesByDate = new Map<string, number>()
    expensesTrendData?.forEach((row) => {
      const date = row.expense_date
      const current = expensesByDate.get(date) || 0
      const amount = Math.max(0, row.amount || 0)
      expensesByDate.set(date, current + amount)
    })

    // 9. Merge with generated dates and format (with NaN safety and precision rounding)
    const trends: TrendData[] = last7Days.map((date) => {
      const dateStr = format(date, 'yyyy-MM-dd')
      const dayLabel = format(date, 'EEE', { locale: th })

      const sales = salesByDate.get(dateStr) || 0
      const expenses = expensesByDate.get(dateStr) || 0

      // Round to 2 decimal places (currency precision)
      const roundedSales = Math.round(sales * 100) / 100
      const roundedExpenses = Math.round(expenses * 100) / 100

      return {
        date: dayLabel,
        sales: Number.isFinite(roundedSales) && roundedSales >= 0 ? roundedSales : 0,
        expenses: Number.isFinite(roundedExpenses) && roundedExpenses >= 0 ? roundedExpenses : 0,
      }
    })

    // 10. Build result (using rounded values for financial accuracy)
    const dashboardData: DashboardData = {
      todayStats: {
        totalSales: roundedSalesToday,
        totalExpenses: roundedExpensesToday,
        netProfit: netProfitToday,
      },
      trends,
    }

    return { success: true, data: dashboardData }
  } catch (error) {
    console.error('Unexpected error in getDashboardStats:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
