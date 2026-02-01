'use server'

/**
 * Profit Summary Rebuild Actions
 * Phase: Profit Reports (D1 Suite)
 *
 * Handles:
 * - Manual rebuild of profit summary tables
 * - Auto-trigger after affiliate import success
 */

import { createClient } from '@/lib/supabase/server'
import { formatBangkok } from '@/lib/bangkok-time'
import { RebuildSummariesResponse } from '@/types/profit-reports'

/**
 * Rebuild profit summary tables for a date range
 *
 * Calls the PostgreSQL function: rebuild_profit_summaries()
 * which rebuilds:
 * - platform_net_profit_daily
 * - product_profit_daily
 * - source_split_daily
 *
 * @param startDate Start date (Bangkok timezone)
 * @param endDate End date (Bangkok timezone)
 * @returns Success status + rows affected
 */
export async function rebuildProfitSummaries(
  startDate: Date,
  endDate: Date
): Promise<RebuildSummariesResponse> {
  try {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return {
        success: false,
        error: 'Unauthorized - Please log in'
      }
    }

    // Format dates to Bangkok timezone (YYYY-MM-DD)
    const startDateStr = formatBangkok(startDate, 'yyyy-MM-dd')
    const endDateStr = formatBangkok(endDate, 'yyyy-MM-dd')

    // Call PostgreSQL function
    const { data, error } = await supabase.rpc('rebuild_profit_summaries', {
      p_user_id: user.id,
      p_start_date: startDateStr,
      p_end_date: endDateStr
    })

    if (error) {
      console.error('Rebuild profit summaries error:', error)
      return {
        success: false,
        error: `Database error: ${error.message}`
      }
    }

    return {
      success: true,
      rowsAffected: data || 0
    }
  } catch (error) {
    console.error('Rebuild profit summaries error:', error)
    return {
      success: false,
      error: `Failed to rebuild summaries: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Auto-trigger rebuild after affiliate import success
 *
 * @param startDate Start date of affected range
 * @param endDate End date of affected range
 */
export async function autoRebuildAfterImport(
  startDate: Date,
  endDate: Date
): Promise<RebuildSummariesResponse> {
  // Same implementation as rebuildProfitSummaries
  // but could add logging/tracking for auto-triggers
  return rebuildProfitSummaries(startDate, endDate)
}
