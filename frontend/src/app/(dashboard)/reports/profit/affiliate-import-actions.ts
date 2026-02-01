'use server'

/**
 * Affiliate Import Server Actions (v2)
 * Enhanced with:
 * - TikTok Affiliate TH preset mapping
 * - Auto-detect header row
 * - Persist user mappings in DB
 * - Commission split (organic + shop_ad)
 * - Handle order_id duplicates
 */

import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import {
  ParsedAffiliateRow,
  AffiliateImportPreview,
  AffiliateImportResult
} from '@/types/profit-reports'

// ============================================
// TYPES
// ============================================

type SalesOrderKeyRow = { order_id: string | null; external_order_id: string | null }

// ============================================
// PRESET MAPPINGS
// ============================================

/**
 * TikTok Affiliate TH Preset
 * Maps Thai column names to internal field names
 */
const TIKTOK_AFFILIATE_TH_PRESET: Record<string, string> = {
  order_id: 'หมายเลขคำสั่งซื้อ',
  affiliate_channel_id: 'ชื่อผู้ใช้ของครีเอเตอร์',
  seller_sku: 'SKU ของผู้ขาย',
  qty: 'ปริมาณ',
  commission_amt_organic: 'การจ่ายค่าคอมมิชชั่นมาตรฐานโดยประมาณ',
  commission_amt_shop_ad: 'การจ่ายค่าคอมมิชชั่นโฆษณาร้านค้าโดยประมาณ'
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Chunk array into smaller batches
 * @param arr - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/**
 * Deduplicate sales_orders rows by order_id + external_order_id composite key
 */
function uniqSalesOrders(rows: SalesOrderKeyRow[]): SalesOrderKeyRow[] {
  const seen = new Set<string>()
  const out: SalesOrderKeyRow[] = []
  for (const r of rows) {
    const k = `${r.order_id ?? ''}||${r.external_order_id ?? ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

/**
 * Fetch existing orders by IDs using TWO queries (order_id IN + external_order_id IN)
 * to avoid broken PostgREST .or() pattern with .in()
 * Returns merged/deduped rows + mapping from any raw ID to canonical order_id
 */
async function fetchExistingOrdersByIds(
  supabase: any,
  userId: string,
  chunkIds: string[]
): Promise<{ existing: SalesOrderKeyRow[]; idToCanonical: Map<string, string> }> {
  // Run 2 queries in parallel: by order_id and by external_order_id
  const [{ data: byOrderId, error: e1 }, { data: byExternalId, error: e2 }] = await Promise.all([
    supabase
      .from('sales_orders')
      .select('order_id, external_order_id')
      .eq('created_by', userId)
      .in('order_id', chunkIds),
    supabase
      .from('sales_orders')
      .select('order_id, external_order_id')
      .eq('created_by', userId)
      .in('external_order_id', chunkIds)
  ])

  if (e1 || e2) {
    throw new Error(`Order lookup failed: ${e1?.message || e2?.message}`)
  }

  // Merge and dedupe
  const merged = uniqSalesOrders([...(byOrderId ?? []), ...(byExternalId ?? [])])

  // Build mapping: rawId -> canonical order_id
  const idToCanonical = new Map<string, string>()
  for (const row of merged) {
    if (row.order_id) {
      idToCanonical.set(String(row.order_id), String(row.order_id))
    }
    if (row.external_order_id) {
      idToCanonical.set(String(row.external_order_id), String(row.order_id))
    }
  }

  return { existing: merged, idToCanonical }
}

/**
 * Normalize header string
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Remove BOM (Byte Order Mark)
 */
function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '') // Remove BOM
    .trim()
    .replace(/\s+/g, ' ') // Collapse whitespace
}

/**
 * Check if a row is non-empty
 * Handles both array rows and object rows
 */
function isNonEmptyRow(r: any): boolean {
  if (!r) return false
  if (Array.isArray(r)) {
    return r.some(c => String(c ?? '').trim() !== '')
  }
  if (typeof r === 'object') {
    return Object.values(r).some(v => String(v ?? '').trim() !== '')
  }
  return String(r).trim() !== ''
}

/**
 * Count non-empty cells in a row
 * Handles both array rows and object rows
 */
function countNonEmptyCells(row: any): number {
  if (!row) return 0
  if (Array.isArray(row)) {
    return row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length
  }
  if (typeof row === 'object') {
    return Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '').length
  }
  return 0
}

/**
 * Auto-detect header row
 * Scans first 10 rows to find row with most non-empty cells
 * Handles both 2D arrays and array of objects
 */
function autoDetectHeaderRow(data: any[]): number {
  if (!data || data.length === 0) return 0

  let maxNonEmptyCells = 0
  let headerRowIndex = 0

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i]
    const nonEmptyCells = countNonEmptyCells(row)

    if (nonEmptyCells > maxNonEmptyCells) {
      maxNonEmptyCells = nonEmptyCells
      headerRowIndex = i
    }
  }

  return headerRowIndex
}

/**
 * Parse number from various formats
 */
function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/[฿$,\s]/g, '')
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? 0 : parsed
  }
  return 0
}

/**
 * Load saved mapping for user
 */
async function loadUserMapping(userId: string, mappingType: string): Promise<Record<string, string> | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('import_mappings')
    .select('mapping_json')
    .eq('created_by', userId)
    .eq('mapping_type', mappingType)
    .single()

  if (error || !data) return null

  return data.mapping_json as Record<string, string>
}

/**
 * Save mapping for user
 */
async function saveUserMapping(
  userId: string,
  mappingType: string,
  mapping: Record<string, string>
): Promise<boolean> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('import_mappings')
    .upsert(
      {
        created_by: userId,
        mapping_type: mappingType,
        mapping_json: mapping,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'created_by,mapping_type'
      }
    )

  return !error
}

/**
 * Apply mapping to row data
 */
function applyMapping(row: any, mapping: Record<string, string>, headers: string[]): any {
  const mapped: any = {}

  for (const [internalField, externalColumn] of Object.entries(mapping)) {
    const columnIndex = headers.findIndex(h => normalizeHeader(h) === normalizeHeader(externalColumn))
    if (columnIndex >= 0) {
      mapped[internalField] = row[columnIndex]
    }
  }

  return mapped
}

/**
 * Build normalized affiliate payload from parsed rows
 * This is the SINGLE SOURCE OF TRUTH for order ID extraction
 * Used by both Preview and Import steps to ensure consistency
 */
async function buildAffiliateNormalizedPayload(
  supabase: any,
  userId: string,
  parsedRows: ParsedAffiliateRow[],
  isDev: boolean = false
): Promise<{
  normalizedRows: ParsedAffiliateRow[]
  uniqueOrderIds: string[]
  idToCanonicalOrderId: Map<string, string>
  matchedCount: number
  orphanCount: number
}> {
  // Extract unique order IDs
  const orderIdsSet = new Set<string>()
  for (const row of parsedRows) {
    if (row.order_id && typeof row.order_id === 'string' && row.order_id.trim() !== '') {
      orderIdsSet.add(row.order_id)
    }
  }

  const uniqueOrderIds = Array.from(orderIdsSet)

  // Guard: Check for undefined/null order IDs
  const invalidIds = uniqueOrderIds.filter(id => !id || id === 'undefined' || id === 'null')
  if (invalidIds.length > 0) {
    throw new Error(
      `[AffiliateImport] FATAL: Found ${invalidIds.length} invalid order IDs (undefined/null). Sample: ${invalidIds.slice(0, 5).join(', ')}`
    )
  }

  console.log('[AffiliateImport NormalizedPayload] Extracted order IDs', {
    uniqueOrderIds: uniqueOrderIds.length,
    sample: uniqueOrderIds.slice(0, 5)
  })

  // Fetch existing orders in chunks
  const orderIdChunks = chunk(uniqueOrderIds, 200)
  const idToCanonicalOrderId = new Map<string, string>()

  for (const chunkIds of orderIdChunks) {
    try {
      const { existing, idToCanonical } = await fetchExistingOrdersByIds(supabase, userId, chunkIds)

      // Merge into top-level map
      for (const [rawId, canonicalId] of Array.from(idToCanonical.entries())) {
        idToCanonicalOrderId.set(rawId, canonicalId)
      }

      if (isDev) {
        console.log('[AffiliateImport NormalizedPayload] Chunk result', {
          chunkSize: chunkIds.length,
          existingRows: existing.length,
          mappingsAdded: idToCanonical.size
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error('[AffiliateImport NormalizedPayload] Match query error', { errorMsg })
      throw new Error(`Database error: ${errorMsg}`)
    }
  }

  const matchedCount = uniqueOrderIds.filter(rawId => idToCanonicalOrderId.has(rawId)).length
  const orphanCount = uniqueOrderIds.length - matchedCount

  // Dev logging
  if (isDev) {
    const sampleMappings = Array.from(Array.from(idToCanonicalOrderId.entries()).slice(0, 5))
    console.log('[AffiliateImport NormalizedPayload] Match results', {
      matched: matchedCount,
      orphan: orphanCount,
      total: uniqueOrderIds.length,
      sampleRawIds: uniqueOrderIds.slice(0, 5),
      sampleMappings: sampleMappings.map(([raw, canonical]) => ({ raw, canonical }))
    })
  } else {
    console.log('[AffiliateImport NormalizedPayload] Match results', {
      matched: matchedCount,
      orphan: orphanCount,
      total: uniqueOrderIds.length
    })
  }

  return {
    normalizedRows: parsedRows,
    uniqueOrderIds,
    idToCanonicalOrderId,
    matchedCount,
    orphanCount
  }
}

/**
 * Auto-map headers using preset or saved mapping
 */
async function autoMapHeaders(
  headers: string[],
  userId: string,
  mappingType: string
): Promise<{ mapping: Record<string, string>; autoMapped: boolean }> {
  // 1. Try to load saved user mapping
  const savedMapping = await loadUserMapping(userId, mappingType)
  if (savedMapping) {
    // Validate saved mapping against current headers
    const isValid = Object.values(savedMapping).every(col =>
      headers.some(h => normalizeHeader(h) === normalizeHeader(col))
    )
    if (isValid) {
      return { mapping: savedMapping, autoMapped: true }
    }
  }

  // 2. Try preset mapping
  const preset = TIKTOK_AFFILIATE_TH_PRESET
  const mapping: Record<string, string> = {}
  let matchedCount = 0

  for (const [internalField, externalColumn] of Object.entries(preset)) {
    const found = headers.find(h => normalizeHeader(h) === normalizeHeader(externalColumn))
    if (found) {
      mapping[internalField] = found
      matchedCount++
    }
  }

  const autoMapped = matchedCount >= 3 // At least 3 fields matched

  return { mapping, autoMapped }
}

// ============================================
// PARSE AFFILIATE IMPORT FILE
// ============================================

export async function parseAffiliateImportFile(
  fileHash: string,
  fileName: string,
  rawDataJson: string, // Raw 2D array from XLSX
  mappingType: string = 'tiktok_affiliate_th'
): Promise<AffiliateImportPreview> {
  try {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: 'Unauthorized', severity: 'error' }],
        warnings: []
      }
    }

    // Parse raw data (should be 2D array)
    let rawData: any
    try {
      rawData = JSON.parse(rawDataJson)
    } catch (parseError) {
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: `JSON parse error: ${parseError instanceof Error ? parseError.message : 'Unknown'}`, severity: 'error' }],
        warnings: []
      }
    }

    // Defensive: Ensure rawData is an array
    if (!Array.isArray(rawData)) {
      const dataType = typeof rawData
      const keys = rawData && typeof rawData === 'object' ? Object.keys(rawData).slice(0, 10).join(', ') : 'N/A'
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [
          {
            message: `Parser bug: expected array rows, got ${dataType}. Keys: ${keys}`,
            severity: 'error'
          }
        ],
        warnings: []
      }
    }

    if (rawData.length === 0) {
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: 'No data found in file', severity: 'error' }],
        warnings: []
      }
    }

    // Dev logging (can be removed in production)
    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) {
      const firstRow = rawData[0]
      console.log('[AffiliateImport Debug]', {
        rowsType: Array.isArray(rawData) ? 'array' : typeof rawData,
        totalRows: rawData.length,
        row0Type: Array.isArray(firstRow) ? 'array' : typeof firstRow,
        row0Keys: firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow)
          ? Object.keys(firstRow).slice(0, 10)
          : 'N/A',
        row0Sample: Array.isArray(firstRow) ? firstRow.slice(0, 5) : firstRow
      })
    }

    // Auto-detect header row
    const headerRowIndex = autoDetectHeaderRow(rawData)
    const headerRow = rawData[headerRowIndex]

    // Extract headers (handle both array and object rows)
    let headers: string[]
    if (Array.isArray(headerRow)) {
      headers = headerRow.map(h => String(h || ''))
    } else if (typeof headerRow === 'object') {
      headers = Object.keys(headerRow)
    } else {
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: `Invalid header row type: ${typeof headerRow}`, severity: 'error' }],
        warnings: []
      }
    }

    const dataRows = rawData.slice(headerRowIndex + 1).filter(isNonEmptyRow)

    // Defensive: Ensure dataRows is an array
    if (!Array.isArray(dataRows)) {
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: `Parser bug: dataRows is not an array (type: ${typeof dataRows})`, severity: 'error' }],
        warnings: []
      }
    }

    // Auto-map headers
    const { mapping, autoMapped } = await autoMapHeaders(headers, user.id, mappingType)

    // Validate required fields
    const requiredFields = ['order_id', 'affiliate_channel_id']
    const missingFields = requiredFields.filter(f => !mapping[f])

    if (missingFields.length > 0) {
      return {
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [
          {
            message: `Required columns not mapped: ${missingFields.join(', ')}. Please map manually.`,
            severity: 'error'
          }
        ],
        warnings: autoMapped ? [] : ['Auto-mapping incomplete - manual mapping required']
      }
    }

    // Parse data rows
    const errors: Array<{ row?: number; field?: string; message: string; severity: 'error' | 'warning' }> = []
    const warnings: string[] = []
    const parsedRows: ParsedAffiliateRow[] = []

    // Track order IDs for distinct count
    const orderIds = new Set<string>()

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNumber = headerRowIndex + i + 2 // +2 because header is index 0

      // Apply mapping
      const mapped = applyMapping(row, mapping, headers)

      // Extract fields
      const orderId = mapped.order_id ? String(mapped.order_id).trim() : ''
      const channelId = mapped.affiliate_channel_id ? String(mapped.affiliate_channel_id).trim() : 'unknown'
      const commissionOrganic = parseNumber(mapped.commission_amt_organic || 0)
      const commissionShopAd = parseNumber(mapped.commission_amt_shop_ad || 0)
      const totalCommission = commissionOrganic + commissionShopAd

      // Validate
      if (!orderId) {
        errors.push({
          row: rowNumber,
          field: 'order_id',
          message: 'Order ID is required',
          severity: 'error'
        })
        continue
      }

      if (totalCommission === 0) {
        warnings.push(`Row ${rowNumber}: No commission (organic or shop ad)`)
      }

      orderIds.add(orderId)

      // Determine attribution type (internal vs external)
      let attributionType: 'internal_affiliate' | 'external_affiliate' = 'external_affiliate'
      if (channelId.toLowerCase().includes('internal') || channelId.toLowerCase().includes('owned')) {
        attributionType = 'internal_affiliate'
      }

      parsedRows.push({
        order_id: orderId,
        affiliate_channel_id: channelId,
        commission_amt: totalCommission,
        commission_pct: 0, // Not used in TikTok format
        attribution_type: attributionType,
        source_report: fileName,
        confidence_level: 'high',
        rowNumber,
        // Additional fields for v2
        commission_amt_organic: commissionOrganic,
        commission_amt_shop_ad: commissionShopAd
      })
    }

    // ============================================
    // BUILD NORMALIZED PAYLOAD (Preview Step)
    // This is the SINGLE SOURCE OF TRUTH for order matching
    // ============================================

    let normalizedPayload
    try {
      normalizedPayload = await buildAffiliateNormalizedPayload(supabase, user.id, parsedRows, isDev)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error('[AffiliateImport Preview] Failed to build normalized payload', { errorMsg })

      return {
        success: false,
        totalRows: dataRows.length,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: errorMsg, severity: 'error' }],
        warnings: []
      }
    }

    const { uniqueOrderIds, idToCanonicalOrderId, matchedCount, orphanCount } = normalizedPayload

    // ============================================
    // COMPUTE TOTALS FROM PARSED DATA (Preview-Safe)
    // Do NOT hit DB for totals, compute from parsed rows
    // ============================================

    const totalCommission = parsedRows.reduce((sum, row) => sum + row.commission_amt, 0)
    const uniqueChannels = new Set(parsedRows.map(r => r.affiliate_channel_id))

    // Sample rows (first 5)
    const sampleRows = parsedRows.slice(0, 5)

    console.log('[AffiliateImport] Preview summary', {
      totalRows: dataRows.length,
      distinctOrders: uniqueOrderIds.length,
      linesCount: parsedRows.length,
      totalCommission,
      channelCount: uniqueChannels.size,
      matched: matchedCount,
      orphan: orphanCount
    })

    // Return normalized payload to client
    // CRITICAL: This payload MUST be passed to Import step without modification
    return {
      success: errors.filter(e => e.severity === 'error').length === 0,
      totalRows: dataRows.length,
      matchedCount,
      orphanCount,
      sampleRows,
      allRows: parsedRows,
      summary: {
        totalCommission,
        channelCount: uniqueChannels.size,
        distinctOrders: uniqueOrderIds.length,
        linesCount: parsedRows.length
      },
      errors,
      warnings,
      mapping, // Return mapping for UI
      autoMapped, // Flag if auto-mapped
      // NORMALIZED PAYLOAD (for Import step)
      normalizedPayload: {
        normalizedRows: parsedRows,
        uniqueOrderIds,
        idToCanonicalOrderId: Array.from(idToCanonicalOrderId.entries()), // Serialize Map to array
        matchedCount,
        orphanCount
      }
    }
  } catch (error) {
    console.error('Parse affiliate import error:', error)
    return {
      success: false,
      totalRows: 0,
      matchedCount: 0,
      orphanCount: 0,
      sampleRows: [],
      summary: { totalCommission: 0, channelCount: 0 },
      errors: [
        {
          message: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'error'
        }
      ],
      warnings: []
    }
  }
}

// ============================================
// IMPORT AFFILIATE ATTRIBUTIONS
// ============================================

// Table name constant (canonical)
const ORDER_ATTRIBUTION_TABLE = 'order_attribution'

export async function importAffiliateAttributions(
  fileHash: string,
  fileName: string,
  parsedDataJson: string,
  mappingJson: string, // JSON string (for Server Action compatibility)
  mappingType: string = 'tiktok_affiliate_th',
  normalizedPayloadJson: string | null = null, // Use null instead of undefined for Server Actions
  allowReimport: boolean = false // Allow re-importing same file (UPSERT behavior)
): Promise<AffiliateImportResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return {
        success: false,
        insertedCount: 0,
        updatedCount: 0,
        orphanCount: 0,
        error: 'Unauthorized'
      }
    }

    const isDev = process.env.NODE_ENV === 'development'

    // Parse mapping from JSON string
    const mapping: Record<string, string> = JSON.parse(mappingJson)

    // ============================================
    // CRITICAL: Use normalized payload from Preview
    // DO NOT re-parse the file or re-extract order IDs
    // ============================================

    let parsedRows: ParsedAffiliateRow[]
    let uniqueOrderIds: string[]
    let idToCanonicalOrderId: Map<string, string>
    let previewMatchedCount: number
    let previewOrphanCount: number

    if (normalizedPayloadJson && normalizedPayloadJson !== 'null') {
      // NEW PATH: Use pre-computed payload from Preview
      try {
        const payload = JSON.parse(normalizedPayloadJson)
        parsedRows = payload.normalizedRows
        uniqueOrderIds = payload.uniqueOrderIds
        // Deserialize Map from array
        idToCanonicalOrderId = new Map(payload.idToCanonicalOrderId)
        previewMatchedCount = payload.matchedCount
        previewOrphanCount = payload.orphanCount

        // Guard: Verify payload integrity
        if (!uniqueOrderIds || !Array.isArray(uniqueOrderIds)) {
          throw new Error('Invalid normalized payload: uniqueOrderIds is not an array')
        }

        if (!parsedRows || !Array.isArray(parsedRows)) {
          throw new Error('Invalid normalized payload: normalizedRows is not an array')
        }

        // Guard: Check for undefined order IDs
        const invalidIds = uniqueOrderIds.filter(id => !id || id === 'undefined' || id === 'null')
        if (invalidIds.length > 0) {
          throw new Error(
            `[AffiliateImport Import] FATAL: Found ${invalidIds.length} invalid order IDs. Sample: ${invalidIds.slice(0, 5).join(', ')}`
          )
        }

        console.log('[AffiliateImport Import] Using preview payload', {
          orders: uniqueOrderIds.length,
          sample: uniqueOrderIds.slice(0, 5),
          rows: parsedRows.length,
          mappings: idToCanonicalOrderId.size,
          previewMatched: previewMatchedCount,
          previewOrphan: previewOrphanCount
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error('[AffiliateImport Import] Failed to parse normalized payload', { errorMsg })
        return {
          success: false,
          insertedCount: 0,
          updatedCount: 0,
          orphanCount: 0,
          error: `Invalid normalized payload: ${errorMsg}`
        }
      }
    } else {
      // OLD PATH: Fallback to parsing (DEPRECATED, should not be used)
      console.warn('[AffiliateImport Import] WARNING: normalizedPayload not provided, falling back to re-parsing')
      parsedRows = JSON.parse(parsedDataJson)
      const distinctOrders = new Set(parsedRows.map(r => r.order_id)).size

      console.log('[AffiliateImport] start (LEGACY PATH)', {
        rows: parsedRows.length,
        distinctOrders,
        fileName
      })

      // Re-build payload (DEPRECATED)
      try {
        const payload = await buildAffiliateNormalizedPayload(supabase, user.id, parsedRows, isDev)
        uniqueOrderIds = payload.uniqueOrderIds
        idToCanonicalOrderId = payload.idToCanonicalOrderId
        previewMatchedCount = payload.matchedCount
        previewOrphanCount = payload.orphanCount
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        return {
          success: false,
          insertedCount: 0,
          updatedCount: 0,
          orphanCount: 0,
          error: errorMsg
        }
      }
    }

    // ============================================
    // 1) CHECK FILE HASH DEDUP (Skip if allowReimport=true)
    // ============================================

    if (!allowReimport) {
      console.log('[AffiliateImport] Checking for duplicate import', {
        fileHash: fileHash.substring(0, 16),
        allowReimport
      })

      const { data: existingBatch } = await supabase
        .from('import_batches')
        .select('id, created_at, file_name, status, inserted_count')
        .eq('file_hash', fileHash)
        .eq('created_by', user.id)
        .eq('marketplace', 'affiliate')
        .eq('report_type', 'affiliate_sales_th')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingBatch) {
        console.log('[AffiliateImport] Found existing import', {
          batchId: existingBatch.id,
          fileName: existingBatch.file_name,
          status: existingBatch.status,
          insertedCount: existingBatch.inserted_count,
          createdAt: existingBatch.created_at
        })

        return {
          success: false,
          insertedCount: 0,
          updatedCount: 0,
          orphanCount: 0,
          error: `ไฟล์นี้ถูก import ไปแล้วเมื่อ ${new Date(existingBatch.created_at).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })} | ${existingBatch.inserted_count || 0} rows`,
          // Return existing batch info for UI to show re-import option
          existingBatchId: existingBatch.id,
          existingBatchDate: existingBatch.created_at
        }
      }

      console.log('[AffiliateImport] No existing import found, proceeding...')
    } else {
      console.log('[AffiliateImport] ✅ ALLOW REIMPORT - User confirmed (allowReimport=true)')
    }

    // ============================================
    // 2) CREATE IMPORT BATCH
    // ============================================

    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        file_hash: fileHash,
        marketplace: 'affiliate',
        report_type: 'affiliate_sales_th',
        file_name: fileName,
        row_count: parsedRows.length,
        status: 'processing',
        created_by: user.id
      })
      .select()
      .single()

    if (batchError || !batch) {
      return {
        success: false,
        insertedCount: 0,
        updatedCount: 0,
        orphanCount: 0,
        error: `Failed to create import batch: ${batchError?.message}`
      }
    }

    // ============================================
    // 3) AGGREGATE BY ORDER_ID (Handle Duplicates)
    // ============================================

    // Group rows by order_id
    const orderGroups = new Map<string, ParsedAffiliateRow[]>()
    for (const row of parsedRows) {
      if (!orderGroups.has(row.order_id)) {
        orderGroups.set(row.order_id, [])
      }
      orderGroups.get(row.order_id)!.push(row)
    }

    // Aggregate commissions per order
    const orderAttributions: any[] = []
    for (const [orderId, rows] of Array.from(orderGroups.entries())) {
      const commissionOrganic = rows.reduce((sum: number, r: ParsedAffiliateRow) => sum + (r.commission_amt_organic || 0), 0)
      const commissionShopAd = rows.reduce((sum: number, r: ParsedAffiliateRow) => sum + (r.commission_amt_shop_ad || 0), 0)
      const totalCommission = commissionOrganic + commissionShopAd

      // Determine commission_type (with enum safety)
      const ALLOWED_COMMISSION_TYPES = ['organic', 'shop_ad', 'mixed', 'none']
      let commissionType: string = 'none'
      if (commissionOrganic > 0 && commissionShopAd > 0) {
        commissionType = 'mixed'
      } else if (commissionOrganic > 0) {
        commissionType = 'organic'
      } else if (commissionShopAd > 0) {
        commissionType = 'shop_ad'
      }
      // Enum safety: fallback to 'none' if not in allowed set
      if (!ALLOWED_COMMISSION_TYPES.includes(commissionType)) {
        commissionType = 'none'
      }

      // Determine attribution_type (with enum safety)
      const ALLOWED_ATTRIBUTION_TYPES = ['internal_affiliate', 'external_affiliate', 'paid_ads', 'organic']
      let attributionType = rows[0].attribution_type || 'external_affiliate'
      // Enum safety: fallback to 'external_affiliate' if unknown
      if (!ALLOWED_ATTRIBUTION_TYPES.includes(attributionType)) {
        attributionType = 'external_affiliate'
      }

      orderAttributions.push({
        order_id: orderId,
        attribution_type: attributionType,
        affiliate_channel_id: rows[0].affiliate_channel_id || null,
        commission_amt: totalCommission,
        commission_pct: null, // Not used in TikTok format
        commission_amt_organic: commissionOrganic,
        commission_amt_shop_ad: commissionShopAd,
        commission_type: commissionType,
        source_report: fileName,
        confidence_level: 'high',
        import_batch_id: batch.id,
        created_by: user.id
      })
    }

    // ============================================
    // 4) USE PRE-COMPUTED ORDER MATCHES FROM PREVIEW
    // DO NOT re-query the database, use the normalized payload
    // ============================================

    const orderIds = Array.from(orderGroups.keys())

    // CRITICAL: Use pre-computed matches from Preview payload
    const matchedCount = previewMatchedCount
    const orphanCountRaw = previewOrphanCount

    console.log('[AffiliateImport Import] Using pre-computed matches from Preview', {
      totalOrders: orderIds.length,
      uniqueOrderIds: uniqueOrderIds.length,
      matched: matchedCount,
      orphan: orphanCountRaw,
      mappings: idToCanonicalOrderId.size
    })

    // Verify invariant: Preview uniqueOrderIds === Import orderIds
    if (uniqueOrderIds.length !== orderIds.length) {
      const errorMsg = `Invariant violation: Preview uniqueOrderIds (${uniqueOrderIds.length}) !== Import orderIds (${orderIds.length})`
      console.error('[AffiliateImport Import] CRITICAL ERROR', { errorMsg })

      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: errorMsg.slice(0, 500)
        })
        .eq('id', batch.id)

      return {
        success: false,
        insertedCount: 0,
        updatedCount: 0,
        orphanCount: 0,
        error: errorMsg
      }
    }

    if (isDev) {
      const sampleMappings = Array.from(Array.from(idToCanonicalOrderId.entries()).slice(0, 5))
      console.log('[AffiliateImport Import] Match results (from Preview)', {
        matched: matchedCount,
        orphan: orphanCountRaw,
        total: uniqueOrderIds.length,
        sampleRawIds: uniqueOrderIds.slice(0, 5),
        sampleMappings: sampleMappings.map(([raw, canonical]) => ({ raw, canonical }))
      })
    }

    // ROLLBACK LOGIC: Early exit if no orders matched at all
    if (matchedCount === 0) {
      console.log('[AffiliateImport Import] No orders matched, rolling back batch', {
        batchId: batch.id,
        totalOrders: orderIds.length
      })

      // Delete the import_batches record we just created
      await supabase
        .from('import_batches')
        .delete()
        .eq('id', batch.id)

      return {
        success: false,
        insertedCount: 0,
        updatedCount: 0,
        orphanCount: orphanCountRaw,
        error: `No orders matched. All ${orphanCountRaw} order(s) from the file are not found in sales_orders. Please import sales orders first.`
      }
    }

    // ============================================
    // 5) UPSERT ORDER_ATTRIBUTION (Matched Only)
    // FIXED: Map rawId -> canonical order_id before upsert
    // ============================================

    // Map raw order_id to canonical order_id and filter matched only
    const attributionsToUpsert = orderAttributions
      .map(attr => {
        const rawOrderId = attr.order_id
        const canonicalOrderId = idToCanonicalOrderId.get(rawOrderId)

        if (!canonicalOrderId) {
          // Not matched, skip
          return null
        }

        // Replace with canonical order_id
        return {
          ...attr,
          order_id: canonicalOrderId
        }
      })
      .filter((attr): attr is NonNullable<typeof attr> => attr !== null)

    let insertedCount = 0
    let orphanCount = orderAttributions.length - attributionsToUpsert.length

    if (isDev) {
      console.log('[AffiliateImport Import] Filtered attributions', {
        total: orderAttributions.length,
        matched: attributionsToUpsert.length,
        orphan: orphanCount,
        sampleCanonicalIds: attributionsToUpsert.slice(0, 5).map(a => a.order_id)
      })
    }

    // ROLLBACK LOGIC: If no rows to insert, delete the batch and return error
    if (attributionsToUpsert.length === 0) {
      console.log('[AffiliateImport Import] No matched orders, rolling back batch', {
        batchId: batch.id
      })

      // Delete the import_batches record we just created
      await supabase
        .from('import_batches')
        .delete()
        .eq('id', batch.id)

      return {
        success: false,
        insertedCount: 0,
        updatedCount: 0,
        orphanCount,
        error: `No orders matched. All ${orphanCount} order(s) from the file are not found in sales_orders. Please import sales orders first.`
      }
    }

    if (attributionsToUpsert.length > 0) {
      // ============================================
      // VALIDATION: Required Columns
      // ============================================

      const REQUIRED_COLUMNS = [
        'order_id',
        'attribution_type',
        'created_by',
        'commission_amt_organic',
        'commission_amt_shop_ad',
        'commission_amt',
        'commission_type'
      ]

      // Validate first row (sample)
      const firstAttr = attributionsToUpsert[0]
      const missingColumns = REQUIRED_COLUMNS.filter(col => !(col in firstAttr))

      if (missingColumns.length > 0) {
        const errorMsg = `Missing required columns: ${missingColumns.join(', ')}`
        console.error('[AffiliateImport Validation Error]', errorMsg)

        await supabase
          .from('import_batches')
          .update({ status: 'failed', notes: errorMsg })
          .eq('id', batch.id)

        return {
          success: false,
          insertedCount: 0,
          updatedCount: 0,
          orphanCount,
          error: errorMsg
        }
      }

      // Validate required fields are not empty
      for (const attr of attributionsToUpsert) {
        if (!attr.order_id || typeof attr.order_id !== 'string' || attr.order_id.trim() === '') {
          const errorMsg = 'Invalid order_id: must be non-empty string'
          console.error('[AffiliateImport Validation Error]', errorMsg, { attr })

          return {
            success: false,
            insertedCount: 0,
            updatedCount: 0,
            orphanCount,
            error: errorMsg
          }
        }

        if (!attr.created_by) {
          const errorMsg = 'Invalid created_by: must be set'
          console.error('[AffiliateImport Validation Error]', errorMsg)

          return {
            success: false,
            insertedCount: 0,
            updatedCount: 0,
            orphanCount,
            error: errorMsg
          }
        }
      }

      // ============================================
      // DEV LOGGING: Payload Sample
      // ============================================

      const isDev = process.env.NODE_ENV === 'development'
      if (isDev && attributionsToUpsert.length > 0) {
        console.log('[AffiliateImport Payload Sample]', attributionsToUpsert[0])
        console.log('[AffiliateImport Columns]', Object.keys(attributionsToUpsert[0]))
        console.log('[AffiliateImport Total Records]', attributionsToUpsert.length)
      }

      // ============================================
      // SANITIZE: Remove Extra Fields
      // ============================================

      const ALLOWED_COLUMNS = [
        'order_id',
        'attribution_type',
        'affiliate_channel_id',
        'commission_amt',
        'commission_pct',
        'commission_amt_organic',
        'commission_amt_shop_ad',
        'commission_type',
        'source_report',
        'confidence_level',
        'import_batch_id',
        'created_by'
      ]

      const sanitizedPayload = attributionsToUpsert.map(attr => {
        const sanitized: any = {}
        for (const col of ALLOWED_COLUMNS) {
          if (col in attr) {
            sanitized[col] = attr[col]
          }
        }
        return sanitized
      })

      // ============================================
      // DEFENSIVE: Assert payload keys are subset of allowed
      // ============================================

      const payloadKeys = Object.keys(sanitizedPayload[0] || {})
      const invalidKeys = payloadKeys.filter(k => !ALLOWED_COLUMNS.includes(k))
      if (invalidKeys.length > 0) {
        const errorMsg = `Invalid payload keys not in schema: ${invalidKeys.join(', ')}`
        console.error('[AffiliateImport Schema Validation Error]', errorMsg)

        return {
          success: false,
          insertedCount: 0,
          updatedCount: 0,
          orphanCount,
          error: errorMsg
        }
      }

      // ============================================
      // BATCHED DB UPSERT
      // Prevents PostgREST "Bad Request" with huge payloads
      // ============================================

      // CONSTRAINT INFO: Uses unique index idx_order_attribution_unique on (created_by, order_id)
      // See migration-038-fix-order-attribution-upsert.sql
      const UPSERT_CONFLICT_COLUMNS = 'created_by,order_id'

      console.log('[AffiliateImport] batched upsert attempt', {
        table: ORDER_ATTRIBUTION_TABLE,
        totalRecords: sanitizedPayload.length,
        onConflict: UPSERT_CONFLICT_COLUMNS,
        constraintName: 'idx_order_attribution_unique',
        payloadKeys,
        samplePayload: sanitizedPayload[0]
      })

      // DEV DIAGNOSTIC: Log constraint being used
      if (isDev) {
        console.log('[AffiliateImport Diagnostic] UPSERT configuration', {
          table: ORDER_ATTRIBUTION_TABLE,
          onConflict: UPSERT_CONFLICT_COLUMNS,
          expectedConstraint: 'idx_order_attribution_unique (created_by, order_id)',
          behavior: 'UPDATE on conflict, INSERT on new'
        })
      }

      const upsertBatches = chunk(sanitizedPayload, 300) // 300 records per batch
      let totalUpserted = 0

      for (let i = 0; i < upsertBatches.length; i++) {
        const batchRecords = upsertBatches[i]

        console.log(`[AffiliateImport] Upserting batch ${i + 1}/${upsertBatches.length}`, {
          batchSize: batchRecords.length
        })

        const { data: upserted, error: upsertError } = await supabase
          .from(ORDER_ATTRIBUTION_TABLE)
          .upsert(batchRecords, {
            onConflict: UPSERT_CONFLICT_COLUMNS,
            ignoreDuplicates: false
          })
          .select()

        if (upsertError) {
          // ============================================
          // FULL ERROR LOGGING + ROLLBACK
          // ============================================
          const fullError = {
            message: upsertError?.message ?? 'Unknown DB error',
            details: upsertError?.details ?? null,
            hint: upsertError?.hint ?? null,
            code: upsertError?.code ?? null,
            status: (upsertError as any)?.status ?? null,
            statusCode: (upsertError as any)?.statusCode ?? null,
            statusText: (upsertError as any)?.statusText ?? null,
            table: ORDER_ATTRIBUTION_TABLE,
            batchNumber: i + 1,
            totalBatches: upsertBatches.length,
            batchSize: batchRecords.length,
            payloadKeys: Object.keys(batchRecords?.[0] ?? {}),
            payloadSample: batchRecords?.[0] ?? null,
            onConflict: UPSERT_CONFLICT_COLUMNS,
            constraintExpected: 'idx_order_attribution_unique'
          }

          console.error('[AffiliateImport DB Error FULL]', fullError)

          // CRITICAL: Error 42P10 means constraint doesn't exist
          // Log diagnostic hint for production debugging
          if (upsertError.code === '42P10') {
            console.error('[AffiliateImport CONSTRAINT ERROR 42P10]', {
              message: 'Unique constraint missing in production database',
              hint: 'Run migration-038-fix-order-attribution-upsert.sql',
              expectedConstraint: 'idx_order_attribution_unique on (created_by, order_id)',
              queryToVerify: `SELECT indexname FROM pg_indexes WHERE tablename = 'order_attribution' AND indexname = 'idx_order_attribution_unique';`
            })
          }

          // ROLLBACK: Clean up any partially inserted rows from previous batches
          console.log('[AffiliateImport Rollback] Cleaning up partial insert', {
            batchId: batch.id,
            successfulBatches: i,
            failedBatch: i + 1,
            rowsInsertedSoFar: totalUpserted
          })

          // Delete order_attribution rows inserted in this import attempt
          const { error: cleanupError } = await supabase
            .from(ORDER_ATTRIBUTION_TABLE)
            .delete()
            .eq('import_batch_id', batch.id)

          if (cleanupError) {
            console.error('[AffiliateImport Rollback] Failed to clean up order_attribution rows', {
              error: cleanupError.message
            })
          }

          // Update batch status to failed
          await supabase
            .from('import_batches')
            .update({
              status: 'failed',
              notes: `Error upserting batch ${i + 1}/${upsertBatches.length}: ${upsertError.message} (code: ${upsertError.code})`.slice(0, 500)
            })
            .eq('id', batch.id)

          return {
            success: false,
            insertedCount: 0, // Set to 0 since we rolled back
            updatedCount: 0,
            orphanCount,
            error: `Batch ${i + 1}/${upsertBatches.length} failed: ${fullError.message}${fullError.code === '42P10' ? ' [Constraint missing - run migration-038]' : ''}`,
            errorDetails: {
              code: fullError.code,
              details: fullError.details,
              hint: fullError.hint,
              status: fullError.status,
              samplePayloadKeys: fullError.payloadKeys
            }
          }
        }

        totalUpserted += upserted?.length || 0
      }

      insertedCount = totalUpserted

      if (isDev) {
        console.log('[AffiliateImport Success]', {
          insertedCount,
          orphanCount,
          totalBatches: upsertBatches.length,
          totalProcessed: attributionsToUpsert.length
        })
      }

      // ROLLBACK LOGIC: If upsert returned 0 rows, delete batch and return error
      if (insertedCount === 0) {
        console.log('[AffiliateImport Import] Upsert returned 0 rows, rolling back batch', {
          batchId: batch.id,
          expectedCount: attributionsToUpsert.length
        })

        // Delete the import_batches record
        await supabase
          .from('import_batches')
          .delete()
          .eq('id', batch.id)

        // Safety: Delete any orphan order_attribution rows for this batch (shouldn't exist)
        await supabase
          .from(ORDER_ATTRIBUTION_TABLE)
          .delete()
          .eq('import_batch_id', batch.id)

        return {
          success: false,
          insertedCount: 0,
          updatedCount: 0,
          orphanCount,
          error: `Upsert failed silently: expected ${attributionsToUpsert.length} rows but got 0. This may indicate a database constraint or permission issue.`
        }
      }
    }

    // ============================================
    // 6) SAVE MAPPING FOR USER
    // ============================================

    await saveUserMapping(user.id, mappingType, mapping)

    // ============================================
    // 7) UPDATE BATCH STATUS
    // ============================================

    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: insertedCount,
        skipped_count: orphanCount,
        notes:
          orphanCount > 0 ? `${orphanCount} orphan orders (not found in sales_orders)` : 'All orders matched'
      })
      .eq('id', batch.id)

    return {
      success: true,
      insertedCount,
      updatedCount: 0,
      orphanCount,
      batchId: batch.id
    }
  } catch (error) {
    console.error('Import affiliate attributions error:', error)
    return {
      success: false,
      insertedCount: 0,
      updatedCount: 0,
      orphanCount: 0,
      error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}
