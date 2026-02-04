/**
 * Affiliate Management Types
 * For internal affiliate tracking and reporting
 */

export interface InternalAffiliate {
  id: string
  channel_id: string // TikTok username or channel ID
  display_name: string | null
  is_active: boolean
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateAffiliateInput {
  channel_id: string
  display_name?: string
  notes?: string
}

export interface UpdateAffiliateInput {
  channel_id?: string
  display_name?: string
  is_active?: boolean
  notes?: string
}

export interface AffiliateReportSummary {
  channel_id: string
  display_name: string | null
  total_orders: number
  total_gmv: number
  commission_organic: number
  commission_shop_ad: number
  commission_total: number
  avg_commission_pct: number
}

export interface AffiliateReportFilters {
  startDate?: string
  endDate?: string
  affiliateId?: string // Filter by specific affiliate
}
