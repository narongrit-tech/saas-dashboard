'use server'

/**
 * Profit Data API Actions
 * Phase: Profit Reports (D1 Suite)
 *
 * Handles:
 * - Fetching profit data from pre-aggregated summary tables
 * - D1-D: Platform Net Profit
 * - D1-B: Product Profit
 * - D1-A: Platform-Attributed Product Profit
 * - D1-C: Source Split
 */

import { createClient } from '@/lib/supabase/server'
import { formatBangkok } from '@/lib/bangkok-time'
import {
  PlatformNetProfitResponse,
  ProductProfitResponse,
  SourceSplitResponse
} from '@/types/profit-reports'

// ============================================
// D1-D: PLATFORM NET PROFIT
// ============================================

export async function getPlatformNetProfit(
  startDate: Date,
  endDate: Date,
  platform?: string
): Promise<PlatformNetProfitResponse> {
  const startTime = Date.now()

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

    // Format dates to Bangkok timezone
    const startDateStr = formatBangkok(startDate, 'yyyy-MM-dd')
    const endDateStr = formatBangkok(endDate, 'yyyy-MM-dd')

    // Build query
    let query = supabase
      .from('platform_net_profit_daily')
      .select('*')
      .eq('created_by', user.id)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: false })

    // Apply platform filter
    if (platform && platform !== 'all') {
      query = query.eq('platform', platform)
    }

    const dbStartTime = Date.now()
    const { data: rows, error } = await query
    const dbTime = Date.now() - dbStartTime

    if (error) {
      console.error('getPlatformNetProfit error:', error)
      return {
        success: false,
        error: `Failed to fetch platform profit: ${error.message}`
      }
    }

    if (!rows || rows.length === 0) {
      return {
        success: true,
        data: {
          totalGmv: 0,
          totalAdsSpend: 0,
          totalCogs: 0,
          totalNetProfit: 0,
          avgMargin: 0,
          rows: []
        },
        _timing: {
          total_ms: Date.now() - startTime,
          db_ms: dbTime
        }
      }
    }

    // Calculate summary
    const totalGmv = rows.reduce((sum, row) => sum + Number(row.gmv || 0), 0)
    const totalAdsSpend = rows.reduce((sum, row) => sum + Number(row.ads_spend || 0), 0)
    const totalCogs = rows.reduce((sum, row) => sum + Number(row.cogs || 0), 0)
    const totalNetProfit = rows.reduce((sum, row) => sum + Number(row.net_profit || 0), 0)
    const avgMargin = totalGmv > 0 ? (totalNetProfit / totalGmv) * 100 : 0

    return {
      success: true,
      data: {
        totalGmv,
        totalAdsSpend,
        totalCogs,
        totalNetProfit,
        avgMargin,
        rows
      },
      _timing: {
        total_ms: Date.now() - startTime,
        db_ms: dbTime
      }
    }
  } catch (error) {
    console.error('getPlatformNetProfit error:', error)
    return {
      success: false,
      error: `Failed to fetch platform profit: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

// ============================================
// D1-B: PRODUCT PROFIT
// ============================================

export async function getProductProfit(
  startDate: Date,
  endDate: Date,
  platform?: string,
  productSearch?: string
): Promise<ProductProfitResponse> {
  const startTime = Date.now()

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

    // Format dates to Bangkok timezone
    const startDateStr = formatBangkok(startDate, 'yyyy-MM-dd')
    const endDateStr = formatBangkok(endDate, 'yyyy-MM-dd')

    // Build query
    let query = supabase
      .from('product_profit_daily')
      .select('*')
      .eq('created_by', user.id)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: false })

    // Apply platform filter
    if (platform && platform !== 'all') {
      query = query.eq('platform', platform)
    }

    // Apply product search (simple ILIKE for now)
    if (productSearch && productSearch.trim() !== '') {
      query = query.or(
        `product_id.ilike.%${productSearch}%,product_name.ilike.%${productSearch}%`
      )
    }

    const dbStartTime = Date.now()
    const { data: rows, error } = await query
    const dbTime = Date.now() - dbStartTime

    if (error) {
      console.error('getProductProfit error:', error)
      return {
        success: false,
        error: `Failed to fetch product profit: ${error.message}`
      }
    }

    if (!rows || rows.length === 0) {
      return {
        success: true,
        data: {
          totalRevenue: 0,
          totalAllocatedAds: 0,
          totalCogs: 0,
          totalMargin: 0,
          avgMarginPct: 0,
          rows: []
        },
        _timing: {
          total_ms: Date.now() - startTime,
          db_ms: dbTime
        }
      }
    }

    // Calculate summary
    const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0)
    const totalAllocatedAds = rows.reduce((sum, row) => sum + Number(row.allocated_ads || 0), 0)
    const totalCogs = rows.reduce((sum, row) => sum + Number(row.cogs || 0), 0)
    const totalMargin = rows.reduce((sum, row) => sum + Number(row.margin || 0), 0)
    const avgMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0

    return {
      success: true,
      data: {
        totalRevenue,
        totalAllocatedAds,
        totalCogs,
        totalMargin,
        avgMarginPct,
        rows
      },
      _timing: {
        total_ms: Date.now() - startTime,
        db_ms: dbTime
      }
    }
  } catch (error) {
    console.error('getProductProfit error:', error)
    return {
      success: false,
      error: `Failed to fetch product profit: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

// ============================================
// D1-C: SOURCE SPLIT
// ============================================

export async function getSourceSplit(
  startDate: Date,
  endDate: Date,
  platform?: string
): Promise<SourceSplitResponse> {
  const startTime = Date.now()

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

    // Format dates to Bangkok timezone
    const startDateStr = formatBangkok(startDate, 'yyyy-MM-dd')
    const endDateStr = formatBangkok(endDate, 'yyyy-MM-dd')

    // Build query
    let query = supabase
      .from('source_split_daily')
      .select('*')
      .eq('created_by', user.id)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: false })

    // Apply platform filter
    if (platform && platform !== 'all') {
      query = query.eq('platform', platform)
    }

    const dbStartTime = Date.now()
    const { data: rows, error } = await query
    const dbTime = Date.now() - dbStartTime

    if (error) {
      console.error('getSourceSplit error:', error)
      return {
        success: false,
        error: `Failed to fetch source split: ${error.message}`
      }
    }

    if (!rows || rows.length === 0) {
      return {
        success: true,
        data: {
          totalGmv: 0,
          totalOrders: 0,
          totalCost: 0,
          totalProfit: 0,
          bySource: {
            internal_affiliate: { gmv: 0, orders: 0, cost: 0, profit: 0 },
            external_affiliate: { gmv: 0, orders: 0, cost: 0, profit: 0 },
            paid_ads: { gmv: 0, orders: 0, cost: 0, profit: 0 },
            organic: { gmv: 0, orders: 0, cost: 0, profit: 0 }
          },
          rows: []
        },
        _timing: {
          total_ms: Date.now() - startTime,
          db_ms: dbTime
        }
      }
    }

    // Calculate overall summary
    const totalGmv = rows.reduce((sum, row) => sum + Number(row.gmv || 0), 0)
    const totalOrders = rows.reduce((sum, row) => sum + Number(row.orders || 0), 0)
    const totalCost = rows.reduce((sum, row) => sum + Number(row.cost || 0), 0)
    const totalProfit = rows.reduce((sum, row) => sum + Number(row.profit || 0), 0)

    // Calculate by source
    const bySource = {
      internal_affiliate: {
        gmv: rows
          .filter(r => r.source_bucket === 'internal_affiliate')
          .reduce((sum, row) => sum + Number(row.gmv || 0), 0),
        orders: rows
          .filter(r => r.source_bucket === 'internal_affiliate')
          .reduce((sum, row) => sum + Number(row.orders || 0), 0),
        cost: rows
          .filter(r => r.source_bucket === 'internal_affiliate')
          .reduce((sum, row) => sum + Number(row.cost || 0), 0),
        profit: rows
          .filter(r => r.source_bucket === 'internal_affiliate')
          .reduce((sum, row) => sum + Number(row.profit || 0), 0)
      },
      external_affiliate: {
        gmv: rows
          .filter(r => r.source_bucket === 'external_affiliate')
          .reduce((sum, row) => sum + Number(row.gmv || 0), 0),
        orders: rows
          .filter(r => r.source_bucket === 'external_affiliate')
          .reduce((sum, row) => sum + Number(row.orders || 0), 0),
        cost: rows
          .filter(r => r.source_bucket === 'external_affiliate')
          .reduce((sum, row) => sum + Number(row.cost || 0), 0),
        profit: rows
          .filter(r => r.source_bucket === 'external_affiliate')
          .reduce((sum, row) => sum + Number(row.profit || 0), 0)
      },
      paid_ads: {
        gmv: rows
          .filter(r => r.source_bucket === 'paid_ads')
          .reduce((sum, row) => sum + Number(row.gmv || 0), 0),
        orders: rows
          .filter(r => r.source_bucket === 'paid_ads')
          .reduce((sum, row) => sum + Number(row.orders || 0), 0),
        cost: rows
          .filter(r => r.source_bucket === 'paid_ads')
          .reduce((sum, row) => sum + Number(row.cost || 0), 0),
        profit: rows
          .filter(r => r.source_bucket === 'paid_ads')
          .reduce((sum, row) => sum + Number(row.profit || 0), 0)
      },
      organic: {
        gmv: rows
          .filter(r => r.source_bucket === 'organic')
          .reduce((sum, row) => sum + Number(row.gmv || 0), 0),
        orders: rows
          .filter(r => r.source_bucket === 'organic')
          .reduce((sum, row) => sum + Number(row.orders || 0), 0),
        cost: rows
          .filter(r => r.source_bucket === 'organic')
          .reduce((sum, row) => sum + Number(row.cost || 0), 0),
        profit: rows
          .filter(r => r.source_bucket === 'organic')
          .reduce((sum, row) => sum + Number(row.profit || 0), 0)
      }
    }

    return {
      success: true,
      data: {
        totalGmv,
        totalOrders,
        totalCost,
        totalProfit,
        bySource,
        rows
      },
      _timing: {
        total_ms: Date.now() - startTime,
        db_ms: dbTime
      }
    }
  } catch (error) {
    console.error('getSourceSplit error:', error)
    return {
      success: false,
      error: `Failed to fetch source split: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}
