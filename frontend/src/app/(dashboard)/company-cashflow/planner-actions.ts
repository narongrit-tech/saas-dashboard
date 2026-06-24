'use server'

import { unstable_noStore as noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { formatBangkok, startOfDayBangkok } from '@/lib/bangkok-time'
import { addDays } from 'date-fns'

export interface PlannerOutflowItem {
  description: string
  amount: number
  category: string
  vendor: string
}

export interface CashflowPlannerRow {
  date: string
  inflow: number
  inflow_orders: number
  outflow: number
  outflow_items: PlannerOutflowItem[]
  running_balance: number
}

export interface CashflowPlannerData {
  opening_balance: number
  total_inflow: number
  total_outflow: number
  closing_balance: number
  rows: CashflowPlannerRow[]
  min_balance: number
  min_balance_date: string | null
}

export async function getCashflowPlannerData(days = 30): Promise<{
  success: boolean
  data?: CashflowPlannerData
  error?: string
}> {
  noStore()

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Unauthorized' }

    const today = startOfDayBangkok(new Date())
    const endDate = addDays(today, days - 1)
    const todayStr = formatBangkok(today, 'yyyy-MM-dd')
    const endStr = formatBangkok(endDate, 'yyyy-MM-dd')

    // 1. Opening balance from app_settings
    const { data: settings } = await supabase
      .from('app_settings')
      .select('cashflow_opening_balance')
      .eq('created_by', user.id)
      .single()

    const openingBalance = Number(settings?.cashflow_opening_balance ?? 0)

    // 2. Inflows: unsettled TikTok settlements grouped by expected date
    const { data: inflows, error: inflowErr } = await supabase
      .from('unsettled_transactions')
      .select('estimated_settle_time, estimated_settlement_amount')
      .eq('status', 'unsettled')
      .gt('estimated_settlement_amount', 0)
      .gte('estimated_settle_time', `${todayStr}T00:00:00+07:00`)
      .lte('estimated_settle_time', `${endStr}T23:59:59+07:00`)

    if (inflowErr) throw inflowErr

    // 3. Outflows: non-PAID expenses within range (use planned_date if set, else expense_date)
    const { data: outflows, error: outflowErr } = await supabase
      .from('expenses')
      .select('planned_date, expense_date, amount, description, category, vendor, expense_status')
      .neq('expense_status', 'PAID')

    if (outflowErr) throw outflowErr

    // Build inflow map: date → { total, orders }
    const inflowByDate = new Map<string, { total: number; orders: number }>()
    for (const row of inflows ?? []) {
      const d = row.estimated_settle_time.slice(0, 10)
      const prev = inflowByDate.get(d) ?? { total: 0, orders: 0 }
      inflowByDate.set(d, {
        total: prev.total + Number(row.estimated_settlement_amount),
        orders: prev.orders + 1,
      })
    }

    // Build outflow map: date → items[]
    const outflowByDate = new Map<string, PlannerOutflowItem[]>()
    for (const row of outflows ?? []) {
      const rawDate = row.planned_date ?? row.expense_date
      if (!rawDate) continue
      const d = rawDate.slice(0, 10)
      if (d < todayStr || d > endStr) continue
      const items = outflowByDate.get(d) ?? []
      outflowByDate.set(d, [
        ...items,
        {
          description: row.description || '',
          amount: Number(row.amount),
          category: row.category || '',
          vendor: row.vendor || '',
        },
      ])
    }

    // Build timeline rows
    const rows: CashflowPlannerRow[] = []
    let runningBalance = openingBalance
    let totalInflow = 0
    let totalOutflow = 0
    let minBalance = openingBalance
    let minBalanceDate: string | null = null

    for (let i = 0; i < days; i++) {
      const d = addDays(today, i)
      const dateStr = formatBangkok(d, 'yyyy-MM-dd')

      const inflowData = inflowByDate.get(dateStr)
      const outflowItems = outflowByDate.get(dateStr) ?? []

      const inflow = inflowData?.total ?? 0
      const outflow = outflowItems.reduce((s, x) => s + x.amount, 0)

      runningBalance = runningBalance + inflow - outflow
      totalInflow += inflow
      totalOutflow += outflow

      if (runningBalance < minBalance) {
        minBalance = runningBalance
        minBalanceDate = dateStr
      }

      rows.push({
        date: dateStr,
        inflow,
        inflow_orders: inflowData?.orders ?? 0,
        outflow,
        outflow_items: outflowItems,
        running_balance: runningBalance,
      })
    }

    return {
      success: true,
      data: {
        opening_balance: openingBalance,
        total_inflow: totalInflow,
        total_outflow: totalOutflow,
        closing_balance: runningBalance,
        rows,
        min_balance: minBalance,
        min_balance_date: minBalanceDate,
      },
    }
  } catch (err) {
    console.error('getCashflowPlannerData error:', err)
    return { success: false, error: 'เกิดข้อผิดพลาดในการโหลดข้อมูล' }
  }
}

export async function updateOpeningBalance(amount: number): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Unauthorized' }

    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { created_by: user.id, cashflow_opening_balance: amount },
        { onConflict: 'created_by' }
      )

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    console.error('updateOpeningBalance error:', err)
    return { success: false, error: 'เกิดข้อผิดพลาด' }
  }
}
