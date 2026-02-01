/**
 * Profit Reports Type Definitions
 * Phase: Profit Reports (D1 Suite)
 *
 * Types for:
 * - Affiliate import
 * - Profit filters
 * - Summary data (D1-D, D1-B, D1-A, D1-C)
 */

// ============================================
// AFFILIATE IMPORT TYPES
// ============================================

export interface ParsedAffiliateRow {
  order_id: string
  affiliate_channel_id: string
  commission_amt: number
  commission_pct: number
  attribution_type: 'internal_affiliate' | 'external_affiliate'
  source_report?: string
  confidence_level?: 'high' | 'inferred'
  rowNumber?: number
  // v2: Commission split
  commission_amt_organic?: number
  commission_amt_shop_ad?: number
}

export interface AffiliateImportPreview {
  success: boolean
  totalRows: number
  matchedCount: number
  orphanCount: number
  sampleRows: ParsedAffiliateRow[]
  allRows?: ParsedAffiliateRow[]
  summary: {
    totalCommission: number
    channelCount: number
    // v2: Additional metrics
    distinctOrders?: number
    linesCount?: number
  }
  errors: Array<{
    row?: number
    field?: string
    message: string
    severity: 'error' | 'warning'
  }>
  warnings: string[]
  // v2: Mapping support
  mapping?: Record<string, string>
  autoMapped?: boolean
  // v3: Normalized payload for Import step (eliminates re-parsing bug)
  normalizedPayload?: {
    normalizedRows: ParsedAffiliateRow[]
    uniqueOrderIds: string[]
    idToCanonicalOrderId: Array<[string, string]> // Serialized Map
    matchedCount: number
    orphanCount: number
  }
}

export interface AffiliateImportResult {
  success: boolean
  insertedCount: number
  updatedCount: number
  orphanCount: number
  batchId?: string
  error?: string
  errorDetails?: {
    code?: string | null
    details?: string | null
    hint?: string | null
    status?: number | null
    samplePayloadKeys?: string[]
  }
  // Re-import support (when duplicate file detected)
  existingBatchId?: string
  existingBatchDate?: string
}

// ============================================
// AFFILIATE CHANNEL TYPES
// ============================================

export interface AffiliateChannel {
  id: string
  affiliate_channel_id: string
  name: string
  type: 'internal' | 'external'
  commission_pct: number | null
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface OrderAttribution {
  id: string
  order_id: string
  attribution_type: 'internal_affiliate' | 'external_affiliate' | 'paid_ads' | 'organic'
  affiliate_channel_id: string | null
  commission_amt: number | null
  commission_pct: number | null
  source_report: string | null
  confidence_level: 'high' | 'inferred'
  import_batch_id: string | null
  created_by: string
  created_at: string
  updated_at: string
  // v2: Commission split
  commission_amt_organic?: number
  commission_amt_shop_ad?: number
  commission_type?: 'organic' | 'shop_ad' | 'mixed' | 'none'
}

// ============================================
// PROFIT FILTER TYPES
// ============================================

export interface ProfitFilters {
  startDate: Date
  endDate: Date
  platform?: 'all' | 'tiktok_shop' | 'shopee' | 'lazada' | string
  productSearch?: string
}

export interface SectionOverride {
  dateRange?: {
    startDate: Date
    endDate: Date
  }
  platform?: string
}

// ============================================
// D1-D: PLATFORM NET PROFIT TYPES
// ============================================

export interface PlatformNetProfitRow {
  id: string
  date: string // YYYY-MM-DD
  platform: string
  gmv: number
  platform_fees: number
  commission: number
  shipping_cost: number
  program_fees: number
  ads_spend: number
  cogs: number
  net_profit: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface PlatformNetProfitSummary {
  totalGmv: number
  totalAdsSpend: number
  totalCogs: number
  totalNetProfit: number
  avgMargin: number
  rows: PlatformNetProfitRow[]
}

export interface PlatformNetProfitResponse {
  success: boolean
  data?: PlatformNetProfitSummary
  error?: string
  _timing?: {
    total_ms: number
    db_ms: number
  }
}

// ============================================
// D1-B: PRODUCT PROFIT TYPES
// ============================================

export interface ProductProfitRow {
  id: string
  date: string // YYYY-MM-DD
  platform: string
  product_id: string | null
  product_name: string | null
  revenue: number
  allocated_ads: number
  cogs: number
  margin: number
  margin_pct: number | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProductProfitSummary {
  totalRevenue: number
  totalAllocatedAds: number
  totalCogs: number
  totalMargin: number
  avgMarginPct: number
  rows: ProductProfitRow[]
}

export interface ProductProfitResponse {
  success: boolean
  data?: ProductProfitSummary
  error?: string
  _timing?: {
    total_ms: number
    db_ms: number
  }
}

// ============================================
// D1-A: PLATFORM-ATTRIBUTED PRODUCT PROFIT TYPES
// ============================================

export interface PlatformAttributedProfitRow {
  date: string
  platform: string
  product_id: string
  product_name: string
  attributed_gmv: number
  ads_spend: number
  cogs: number
  profit: number
  margin_pct: number | null
}

export interface PlatformAttributedProfitSummary {
  totalAttributedGmv: number
  totalAdsSpend: number
  totalCogs: number
  totalProfit: number
  rows: PlatformAttributedProfitRow[]
}

export interface PlatformAttributedProfitResponse {
  success: boolean
  data?: PlatformAttributedProfitSummary
  error?: string
}

// ============================================
// D1-C: SOURCE SPLIT TYPES
// ============================================

export interface SourceSplitRow {
  id: string
  date: string // YYYY-MM-DD
  platform: string
  source_bucket: 'internal_affiliate' | 'external_affiliate' | 'paid_ads' | 'organic'
  gmv: number
  orders: number
  cost: number
  profit: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface SourceSplitSummary {
  totalGmv: number
  totalOrders: number
  totalCost: number
  totalProfit: number
  bySource: {
    internal_affiliate: {
      gmv: number
      orders: number
      cost: number
      profit: number
    }
    external_affiliate: {
      gmv: number
      orders: number
      cost: number
      profit: number
    }
    paid_ads: {
      gmv: number
      orders: number
      cost: number
      profit: number
    }
    organic: {
      gmv: number
      orders: number
      cost: number
      profit: number
    }
  }
  rows: SourceSplitRow[]
}

export interface SourceSplitResponse {
  success: boolean
  data?: SourceSplitSummary
  error?: string
  _timing?: {
    total_ms: number
    db_ms: number
  }
}

// ============================================
// COMMON RESPONSE TYPES
// ============================================

export interface ProfitReportsError {
  success: false
  error: string
  code?: string
}

export type ProfitDataResponse =
  | PlatformNetProfitResponse
  | ProductProfitResponse
  | PlatformAttributedProfitResponse
  | SourceSplitResponse

// ============================================
// REBUILD SUMMARY TYPES
// ============================================

export interface RebuildSummariesRequest {
  startDate: Date
  endDate: Date
}

export interface RebuildSummariesResponse {
  success: boolean
  rowsAffected?: number
  error?: string
}

// ============================================
// UI STATE TYPES
// ============================================

export interface ProfitPageState {
  globalFilters: ProfitFilters
  d1dOverride: SectionOverride | null
  d1bOverride: SectionOverride | null
  d1aOverride: SectionOverride | null
  d1cOverride: SectionOverride | null
  d1aLoaded: boolean
  d1cLoaded: boolean
}

export interface SectionLoadingState {
  d1dLoading: boolean
  d1bLoading: boolean
  d1aLoading: boolean
  d1cLoading: boolean
}

export interface SectionErrorState {
  d1dError: string | null
  d1bError: string | null
  d1aError: string | null
  d1cError: string | null
}
