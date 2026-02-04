'use server'

/**
 * Reconciliation Report Server Actions
 * Explains the difference between Accrual P&L and Company Cashflow
 *
 * Bridge Items:
 * 1. Revenue not yet settled (ขายแล้วแต่ยังไม่เข้าเงิน)
 * 2. Wallet top-ups (เงินออกแต่ไม่เป็น expense)
 * 3. Ad spend timing differences (if any)
 */

import { createClient } from '@/lib/supabase/server'
import { formatBangkok, startOfDayBangkok, endOfDayBangkok } from '@/lib/bangkok-time'
import { getDailyPLRange } from '@/lib/daily-pl'
import { getCompanyCashflow } from '../company-cashflow/actions'

export interface ReconciliationBridgeItem {
  label: string
  amount: number
  explanation: string
  dataAvailable: boolean
}

export interface ReconciliationReport {
  // Period
  startDate: string
  endDate: string

  // Accrual P&L (Performance)
  accrual_revenue: number
  accrual_ad_spend: number
  accrual_cogs: number
  accrual_operating: number
  accrual_net: number

  // Company Cashflow (Liquidity)
  cashflow_in: number
  cashflow_out: number
  cashflow_net: number

  // Bridge
  bridge_items: ReconciliationBridgeItem[]
  total_bridge: number

  // Verification
  verification_error: number // Should be near 0 if bridge is complete
}

/**
 * Get reconciliation report for date range
 */
export async function getReconciliationReport(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; data?: ReconciliationReport; error?: string }> {
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

    // Fetch Accrual P&L (sum over range)
    const plData = await getDailyPLRange(startDateStr, endDateStr)
    const accrual_revenue = plData.reduce((sum, d) => sum + d.revenue, 0)
    const accrual_ad_spend = plData.reduce((sum, d) => sum + d.advertising_cost, 0)
    const accrual_cogs = plData.reduce((sum, d) => sum + d.cogs, 0)
    const accrual_operating = plData.reduce((sum, d) => sum + d.operating_expenses, 0)
    const accrual_net = accrual_revenue - accrual_ad_spend - accrual_cogs - accrual_operating

    // Fetch Company Cashflow
    const cashflowResult = await getCompanyCashflow(startDate, endDate)
    if (!cashflowResult.success || !cashflowResult.data) {
      return { success: false, error: cashflowResult.error || 'ไม่สามารถโหลด cashflow ได้' }
    }

    const cashflow_in = cashflowResult.data.total_cash_in
    const cashflow_out = cashflowResult.data.total_cash_out
    const cashflow_net = cashflow_in - cashflow_out

    // Calculate Bridge Items

    // 1. Revenue not yet settled (Accrual Revenue - Cash In from sales)
    // LIMITATION: Cannot isolate sales cash from total cash in (may include refunds, adjustments)
    // Conservative approach: Use total cash in as proxy
    const revenue_not_settled = accrual_revenue - cashflow_in

    // 2. Wallet top-ups (Cash out but not expense) - with pagination
    interface WalletTopupData {
      amount: number;
    }
    let topupData: WalletTopupData[] = [];
    let topupFrom = 0;
    const pageSize = 1000;
    let hasMoreTopups = true;

    while (hasMoreTopups) {
      const { data, error } = await supabase
        .from('wallet_ledger')
        .select('amount')
        .eq('entry_type', 'TOP_UP')
        .eq('direction', 'IN')
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr)
        .range(topupFrom, topupFrom + pageSize - 1);

      if (error) {
        console.error('Wallet top-up query failed:', error);
        break;
      }

      if (data && data.length > 0) {
        topupData = topupData.concat(data);
        hasMoreTopups = data.length === pageSize;
        topupFrom += pageSize;
      } else {
        hasMoreTopups = false;
      }
    }

    const wallet_topups = topupData?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0

    // 3. Ad spend timing differences
    // For now, assume 0 (Performance Ads import creates both performance record + wallet SPEND on same day)
    const ad_timing_diff = 0

    const bridge_items: ReconciliationBridgeItem[] = [
      {
        label: 'Revenue not yet settled',
        amount: revenue_not_settled,
        explanation: 'ยอดขายที่บันทึกแล้วแต่ยังไม่ได้รับเงินจาก marketplace',
        dataAvailable: true,
      },
      {
        label: 'Wallet top-ups (cash out, not expense)',
        amount: wallet_topups,
        explanation: 'เงินโอนเข้า wallet (เป็นการโอนเงิน ไม่ใช่ค่าใช้จ่าย)',
        dataAvailable: true,
      },
      {
        label: 'Ad spend timing differences',
        amount: ad_timing_diff,
        explanation: 'ความแตกต่างเวลา performance report vs cash payment (ยังไม่มีข้อมูล)',
        dataAvailable: false,
      },
    ]

    const total_bridge = bridge_items.reduce((sum, item) => sum + item.amount, 0)

    // Verification: Accrual Net + Bridge = Cashflow Net (should be close to 0)
    const verification_error = accrual_net + total_bridge - cashflow_net

    return {
      success: true,
      data: {
        startDate: startDateStr,
        endDate: endDateStr,
        accrual_revenue,
        accrual_ad_spend,
        accrual_cogs,
        accrual_operating,
        accrual_net,
        cashflow_in,
        cashflow_out,
        cashflow_net,
        bridge_items,
        total_bridge,
        verification_error,
      },
    }
  } catch (error) {
    console.error('[Reconciliation] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
    }
  }
}

/**
 * Export reconciliation report to CSV
 */
export async function exportReconciliationReport(
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const result = await getReconciliationReport(startDate, endDate)

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'ไม่สามารถโหลดข้อมูลได้' }
    }

    const data = result.data

    // Generate CSV
    const lines: string[] = []
    lines.push('Company Reconciliation Report')
    lines.push(`Period: ${data.startDate} to ${data.endDate}`)
    lines.push('')
    lines.push('Accrual P&L (Performance)')
    lines.push('Item,Amount')
    lines.push(`Revenue,${data.accrual_revenue.toFixed(2)}`)
    lines.push(`Ad Spend,-${data.accrual_ad_spend.toFixed(2)}`)
    lines.push(`COGS,-${data.accrual_cogs.toFixed(2)}`)
    lines.push(`Operating,-${data.accrual_operating.toFixed(2)}`)
    lines.push(`Net Profit/Loss,${data.accrual_net.toFixed(2)}`)
    lines.push('')
    lines.push('Company Cashflow (Liquidity)')
    lines.push('Item,Amount')
    lines.push(`Cash In,${data.cashflow_in.toFixed(2)}`)
    lines.push(`Cash Out,-${data.cashflow_out.toFixed(2)}`)
    lines.push(`Net Cashflow,${data.cashflow_net.toFixed(2)}`)
    lines.push('')
    lines.push('Bridge Items')
    lines.push('Item,Amount,Explanation,Data Available')
    data.bridge_items.forEach((item) => {
      lines.push(
        `"${item.label}",${item.amount.toFixed(2)},"${item.explanation}",${item.dataAvailable ? 'Yes' : 'No'}`
      )
    })
    lines.push(`Total Bridge,${data.total_bridge.toFixed(2)}`)
    lines.push('')
    lines.push(`Verification Error,${data.verification_error.toFixed(2)}`)

    const csvContent = lines.join('\n')

    // Generate filename with Bangkok timezone timestamp
    const now = new Date()
    const timestamp = formatBangkok(now, 'yyyyMMdd-HHmmss')
    const filename = `reconciliation-${timestamp}.csv`

    return {
      success: true,
      csv: csvContent,
      filename,
    }
  } catch (error) {
    console.error('[Reconciliation Export] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการ export',
    }
  }
}
