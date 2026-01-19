'use server'

import { getDailyCashflow, getDailyCashflowRange, DailyCashflowData } from '@/lib/cashflow'

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
