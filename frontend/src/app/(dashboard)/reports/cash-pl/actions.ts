'use server'

import { createClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import { getBangkokNow, startOfDayBangkok, formatBangkok } from '@/lib/bangkok-time'

export interface CashPLSummary {
  cashIn: number
  cashOut: number
  netChange: number
  startDate: string
  endDate: string
}

export interface CashPLDayRow {
  date: string       // YYYY-MM-DD
  dateLabel: string  // short Thai label e.g. "จ 25/2"
  cashIn: number
  cashOut: number
  net: number
}

export interface CashPLData {
  summary: CashPLSummary
  daily: CashPLDayRow[]
}

/**
 * Get Cash P&L for last 7 days (Bangkok timezone)
 *
 * Cash In  = bank_transactions.deposit + DIRECTOR_LOAN wallet TOP_UP
 * Cash Out = bank_transactions.withdrawal + other wallet TOP_UP (ad wallet top-ups etc.)
 *
 * NOTE: Top-ups are cash movements — NOT economic ad expenses.
 *       They MUST NOT affect accrual P&L but MUST appear here.
 */
export async function getCashPL(): Promise<{
  success: boolean
  data?: CashPLData
  error?: string
}> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    const today = getBangkokNow()
    const last7Days: Date[] = []
    for (let i = 6; i >= 0; i--) {
      last7Days.push(startOfDayBangkok(subDays(today, i)))
    }

    const startDateStr = format(last7Days[0], 'yyyy-MM-dd')
    const endDateStr = format(today, 'yyyy-MM-dd')

    // --- Fetch bank transactions + wallet top-ups in parallel ---
    const [bankRes, topupRes] = await Promise.all([
      supabase
        .from('bank_transactions')
        .select('txn_date, deposit, withdrawal')
        .eq('created_by', user.id)
        .gte('txn_date', startDateStr)
        .lte('txn_date', endDateStr),

      supabase
        .from('wallet_ledger')
        .select('date, amount, wallets!inner(wallet_type)')
        .eq('entry_type', 'TOP_UP')
        .eq('direction', 'IN')
        .gte('date', startDateStr)
        .lte('date', endDateStr),
    ])

    if (bankRes.error) throw new Error(`Bank transactions: ${bankRes.error.message}`)
    if (topupRes.error) throw new Error(`Wallet top-ups: ${topupRes.error.message}`)

    // --- Aggregate by date ---
    const cashInByDate = new Map<string, number>()
    const cashOutByDate = new Map<string, number>()

    bankRes.data?.forEach((row) => {
      const date = row.txn_date
      cashInByDate.set(date, (cashInByDate.get(date) || 0) + Math.max(0, Number(row.deposit || 0)))
      cashOutByDate.set(date, (cashOutByDate.get(date) || 0) + Math.max(0, Number(row.withdrawal || 0)))
    })

    topupRes.data?.forEach((row: any) => {
      const date = formatBangkok(row.date, 'yyyy-MM-dd')
      const walletType = row.wallets?.wallet_type
      const amount = Math.max(0, Number(row.amount || 0))

      if (walletType === 'DIRECTOR_LOAN') {
        // Director loan TOP_UP = cash INTO company
        cashInByDate.set(date, (cashInByDate.get(date) || 0) + amount)
      } else {
        // Other wallet TOP_UP (ads wallet, etc.) = cash OUT from company
        cashOutByDate.set(date, (cashOutByDate.get(date) || 0) + amount)
      }
    })

    // --- Build daily array ---
    const round2 = (n: number) => Math.round(n * 100) / 100
    const daily: CashPLDayRow[] = last7Days.map((d) => {
      const dateStr = format(d, 'yyyy-MM-dd')
      const dateLabel = format(d, 'EEE d/M', { locale: th })
      const cashIn = round2(cashInByDate.get(dateStr) || 0)
      const cashOut = round2(cashOutByDate.get(dateStr) || 0)
      return { date: dateStr, dateLabel, cashIn, cashOut, net: round2(cashIn - cashOut) }
    })

    const totalCashIn = round2(daily.reduce((s, d) => s + d.cashIn, 0))
    const totalCashOut = round2(daily.reduce((s, d) => s + d.cashOut, 0))

    return {
      success: true,
      data: {
        summary: {
          cashIn: totalCashIn,
          cashOut: totalCashOut,
          netChange: round2(totalCashIn - totalCashOut),
          startDate: startDateStr,
          endDate: endDateStr,
        },
        daily,
      },
    }
  } catch (error) {
    console.error('[getCashPL] error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
