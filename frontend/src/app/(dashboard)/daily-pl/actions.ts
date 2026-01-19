'use server'

import { getDailyPL, DailyPLData } from '@/lib/daily-pl'

interface ActionResult {
  success: boolean
  error?: string
  data?: DailyPLData
}

/**
 * Get Daily P&L data for a specific date
 * BUSINESS CRITICAL: This is the main P&L calculation used by business owner
 */
export async function getDailyPLForDate(date: string): Promise<ActionResult> {
  try {
    const plData = await getDailyPL(date)

    if (!plData) {
      return { success: false, error: 'ไม่สามารถโหลดข้อมูล P&L ได้' }
    }

    return { success: true, data: plData }
  } catch (error) {
    console.error('Error in getDailyPLForDate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
