import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import * as XLSX from 'xlsx'

import { createServiceClient } from '../supabase/service'
import { syncAffiliateBatch } from './video-master-sync'

const OBSERVED_HEADERS = [
  'Order ID',
  'SKU ID',
  'Product name',
  'Product ID',
  'Price',
  'Items sold',
  'Items refunded',
  'Shop name',
  'Shop code',
  'Affiliate partner',
  'Agency',
  'Currency',
  'Order type',
  'Order settlement status',
  'Indirect',
  'Commission type',
  'Content Type',
  'Content ID',
  'Standard',
  'Shop ads',
  'TikTok bonus',
  'Partner bonus',
  'Revenue sharing portion',
  'GMV',
  'Est. commission base',
  'Est. standard commission',
  'Est. Shop Ads commission',
  'Est. Bonus',
  'Est. Affiliate partner bonus',
  'Est. IVA',
  'Est. ISR',
  'Est. PIT',
  'Est. revenue sharing portion',
  'Actual commission base',
  'Standard commission',
  'Shop Ads commission',
  'Bonus',
  'Affiliate partner bonus',
  'Tax - ISR',
  'Tax - IVA',
  'Tax - PIT',
  'Shared with partner',
  'Total final earned amount',
  'Order date',
  'Commission settlement date',
] as const

type ObservedHeader = (typeof OBSERVED_HEADERS)[number]
type ParsedRowTextField = Exclude<keyof TikTokAffiliateParsedRow, 'sourceRowNumber' | 'rawPayload'>

export interface TikTokAffiliateParsedRow {
  sourceRowNumber: number
  rawPayload: Record<string, string>
  orderId: string
  skuId: string
  productName: string
  productId: string
  priceText: string
  itemsSoldText: string
  itemsRefundedText: string
  shopName: string
  shopCode: string
  affiliatePartner: string
  agency: string
  currency: string
  orderType: string
  orderSettlementStatus: string
  indirectFlag: string
  commissionType: string
  contentType: string
  contentId: string
  standardRateText: string
  shopAdsRateText: string
  tiktokBonusRateText: string
  partnerBonusRateText: string
  revenueSharingPortionRateText: string
  gmvText: string
  estCommissionBaseText: string
  estStandardCommissionText: string
  estShopAdsCommissionText: string
  estBonusText: string
  estAffiliatePartnerBonusText: string
  estIvaText: string
  estIsrText: string
  estPitText: string
  estRevenueSharingPortionText: string
  actualCommissionBaseText: string
  standardCommissionText: string
  shopAdsCommissionText: string
  bonusText: string
  affiliatePartnerBonusText: string
  taxIsrText: string
  taxIvaText: string
  taxPitText: string
  sharedWithPartnerText: string
  totalFinalEarnedAmountText: string
  orderDateText: string
  commissionSettlementDateText: string
}

export interface TikTokAffiliateParsedWorkbook {
  fileName: string
  sheetName: string
  headerRowNumber: number
  rowCount: number
  rows: TikTokAffiliateParsedRow[]
  headers: string[]
}

export interface ImportTikTokAffiliateFileOptions {
  filePath: string
  createdBy: string
  originalFileName?: string
  sheetName?: string
}

export interface ImportTikTokAffiliateFileResult {
  batchId: string
  fileName: string
  sheetName: string
  headerRowNumber: number
  rawRowCount: number
  stagedRowCount: number
  preWriteRejectedRowCount: number
  validCandidateRowCount: number
  winnerRowCount: number
  missingKeyRowCount: number
  invalidValueRowCount: number
  duplicateNonWinnerRowCount: number
  batchStatus: string
  rejectionDetails: TikTokAffiliateImportRejectionDetails
}

export interface TikTokAffiliateRejectedRowSample {
  stagingRowId: string
  sourceRowNumber: number | null
  failedFields: string[]
}

export interface TikTokAffiliateDuplicateRowSample {
  stagingRowId: string
  sourceRowNumber: number | null
  orderId: string | null
  skuId: string | null
  productId: string | null
  contentId: string | null
  normalizedRowVersionHash: string | null
}

export interface TikTokAffiliateImportRejectionDetails {
  missingKeyFieldCounts: Record<string, number>
  missingKeySampleRows: TikTokAffiliateRejectedRowSample[]
  invalidValueFieldCounts: Record<string, number>
  invalidValueSampleRows: TikTokAffiliateRejectedRowSample[]
  duplicateNonWinnerSampleRows: TikTokAffiliateDuplicateRowSample[]
}

export interface TikTokAffiliatePreviewResult {
  fileName: string
  sheetName: string
  rowCount: number
  validRowCount: number
  preWriteRejectedRowCount: number
  missingCriticalFieldCounts: Record<string, number>
  isDuplicateFile: boolean
  existingBatchId: string | null
}

const HEADER_ALIASES: Record<ObservedHeader, ParsedRowTextField> = {
  'Order ID': 'orderId',
  'SKU ID': 'skuId',
  'Product name': 'productName',
  'Product ID': 'productId',
  Price: 'priceText',
  'Items sold': 'itemsSoldText',
  'Items refunded': 'itemsRefundedText',
  'Shop name': 'shopName',
  'Shop code': 'shopCode',
  'Affiliate partner': 'affiliatePartner',
  Agency: 'agency',
  Currency: 'currency',
  'Order type': 'orderType',
  'Order settlement status': 'orderSettlementStatus',
  Indirect: 'indirectFlag',
  'Commission type': 'commissionType',
  'Content Type': 'contentType',
  'Content ID': 'contentId',
  Standard: 'standardRateText',
  'Shop ads': 'shopAdsRateText',
  'TikTok bonus': 'tiktokBonusRateText',
  'Partner bonus': 'partnerBonusRateText',
  'Revenue sharing portion': 'revenueSharingPortionRateText',
  GMV: 'gmvText',
  'Est. commission base': 'estCommissionBaseText',
  'Est. standard commission': 'estStandardCommissionText',
  'Est. Shop Ads commission': 'estShopAdsCommissionText',
  'Est. Bonus': 'estBonusText',
  'Est. Affiliate partner bonus': 'estAffiliatePartnerBonusText',
  'Est. IVA': 'estIvaText',
  'Est. ISR': 'estIsrText',
  'Est. PIT': 'estPitText',
  'Est. revenue sharing portion': 'estRevenueSharingPortionText',
  'Actual commission base': 'actualCommissionBaseText',
  'Standard commission': 'standardCommissionText',
  'Shop Ads commission': 'shopAdsCommissionText',
  Bonus: 'bonusText',
  'Affiliate partner bonus': 'affiliatePartnerBonusText',
  'Tax - ISR': 'taxIsrText',
  'Tax - IVA': 'taxIvaText',
  'Tax - PIT': 'taxPitText',
  'Shared with partner': 'sharedWithPartnerText',
  'Total final earned amount': 'totalFinalEarnedAmountText',
  'Order date': 'orderDateText',
  'Commission settlement date': 'commissionSettlementDateText',
}

// ─── Thai header aliases ───────────────────────────────────────────────────────

/**
 * Maps Thai-language TikTok export header strings to the same ParsedRowTextField
 * targets as HEADER_ALIASES. Thai exports use these headers when the seller's
 * account locale is set to Thai (TH).
 *
 * Columns that appear in Thai exports but have no corresponding ParsedRowTextField
 * (Est. CedularTax / cedular_tax) are intentionally omitted — they are not parsed
 * by this pipeline.
 */
const THAI_HEADER_ALIASES: Record<string, ParsedRowTextField> = {
  'หมายเลขคำสั่งซื้อ': 'orderId',
  'ID ของ SKU': 'skuId',
  'ชื่อสินค้า': 'productName',
  'รหัสสินค้า': 'productId',
  'ราคา': 'priceText',
  'สินค้าที่ขายได้': 'itemsSoldText',
  'สินค้าที่มีการคืนเงิน': 'itemsRefundedText',
  'ชื่อร้านค้า': 'shopName',
  'รหัสร้านค้า': 'shopCode',
  'พาร์ทเนอร์แอฟฟิลิเอต': 'affiliatePartner',
  'เอเจนซี่': 'agency',
  'สกุลเงิน': 'currency',
  'ประเภทคำสั่งซื้อ': 'orderType',
  'สถานะการชำระคำสั่งซื้อ': 'orderSettlementStatus',
  'โดยอ้อม': 'indirectFlag',
  'ประเภทค่าคอมมิชชั่น': 'commissionType',
  'ประเภทเนื้อหา': 'contentType',
  'รหัสเนื้อหา': 'contentId',
  'มาตรฐาน': 'standardRateText',
  'โฆษณาร้านค้า': 'shopAdsRateText',
  'โบนัส TikTok': 'tiktokBonusRateText',
  'โบนัสจากพาร์ทเนอร์': 'partnerBonusRateText',
  'สัดส่วนการแบ่งรายได้': 'revenueSharingPortionRateText',
  GMV: 'gmvText',
  'ฐานค่าคอมมิชชั่นโดยประมาณ': 'estCommissionBaseText',
  'ค่าคอมมิชชั่นมาตรฐานโดยประมาณ': 'estStandardCommissionText',
  'ค่าคอมมิชชั่นโฆษณาร้านค้าโดยประมาณ': 'estShopAdsCommissionText',
  'โบนัสโดยประมาณ': 'estBonusText',
  'โบนัสจากพาร์ทเนอร์แอฟฟิลิเอตโดยประมาณ': 'estAffiliatePartnerBonusText',
  'IVA โดยประมาณ': 'estIvaText',
  'ISR โดยประมาณ': 'estIsrText',
  'PIT โดยประมาณ': 'estPitText',
  'สัดส่วนการแบ่งรายได้โดยประมาณ': 'estRevenueSharingPortionText',
  'ฐานค่าคอมมิชชั่นตามจริง': 'actualCommissionBaseText',
  'ค่าคอมมิชชั่นมาตรฐาน': 'standardCommissionText',
  'ค่าคอมมิชชั่นโฆษณาร้านค้า': 'shopAdsCommissionText',
  'โบนัส': 'bonusText',
  'โบนัสจากพาร์ทเนอร์แอฟฟิลิเอต': 'affiliatePartnerBonusText',
  'ภาษี - ISR': 'taxIsrText',
  'ภาษี - IVA': 'taxIvaText',
  'ภาษี - PIT': 'taxPitText',
  'แบ่งกับพาร์ทเนอร์': 'sharedWithPartnerText',
  'ยอดรายได้รวมสุดท้าย': 'totalFinalEarnedAmountText',
  'วันที่สั่งซื้อ': 'orderDateText',
  'วันที่ชำระเงินค่าคอมมิชชั่น': 'commissionSettlementDateText',
}

// ─── Header normalization ──────────────────────────────────────────────────────

/**
 * Normalizes a header string for deterministic matching:
 * - NFC Unicode normalization (canonical decomposition + recomposition)
 * - Strip zero-width characters (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM)
 * - Collapse internal whitespace runs to a single space
 * - Trim leading / trailing whitespace
 *
 * Applied consistently when scanning the sheet for the header row,
 * when building the alias lookup, and when checking required columns.
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFC')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Combined lookup: normalized header string → ParsedRowTextField.
 * Built once at module load from both English (HEADER_ALIASES) and
 * Thai (THAI_HEADER_ALIASES) entries. Used in mapRawRow to resolve
 * column values without branching on file locale.
 */
const NORMALIZED_HEADER_TO_FIELD: ReadonlyMap<string, ParsedRowTextField> = (() => {
  const map = new Map<string, ParsedRowTextField>()
  for (const header of OBSERVED_HEADERS) {
    map.set(normalizeHeader(header), HEADER_ALIASES[header])
  }
  for (const [thaiHeader, field] of Object.entries(THAI_HEADER_ALIASES)) {
    map.set(normalizeHeader(thaiHeader), field)
  }
  return map
})()

/**
 * Normalized forms of the required "Order ID" column.
 * A candidate header row must contain at least one of these.
 */
const REQUIRED_ORDER_ID_HEADERS = new Set([
  normalizeHeader('Order ID'),
  normalizeHeader('หมายเลขคำสั่งซื้อ'),
])

/**
 * Normalized forms of the required "Content ID" column.
 * A candidate header row must contain at least one of these.
 */
const REQUIRED_CONTENT_ID_HEADERS = new Set([
  normalizeHeader('Content ID'),
  normalizeHeader('รหัสเนื้อหา'),
])

export async function previewTikTokAffiliateFile(
  fileBuffer: Buffer,
  fileName: string,
  createdBy: string,
  sheetName?: string
): Promise<TikTokAffiliatePreviewResult> {
  const supabase = createServiceClient()
  const sourceFileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const parsed = parseTikTokAffiliateWorkbook(fileBuffer, fileName, sheetName)

  const { data: existing } = await supabase
    .from('tiktok_affiliate_import_batches')
    .select('id')
    .eq('created_by', createdBy)
    .eq('source_file_hash', sourceFileHash)
    .limit(1)
    .maybeSingle()

  const missingCounts: Record<string, number> = {}
  let preWriteRejectedRowCount = 0

  for (const row of parsed.rows) {
    const failed = getCriticalFieldFailures(row)
    if (failed.length > 0) {
      preWriteRejectedRowCount++
      for (const field of failed) {
        missingCounts[field] = (missingCounts[field] ?? 0) + 1
      }
    }
  }

  return {
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    rowCount: parsed.rowCount,
    validRowCount: parsed.rowCount - preWriteRejectedRowCount,
    preWriteRejectedRowCount,
    missingCriticalFieldCounts: missingCounts,
    isDuplicateFile: Boolean(existing),
    existingBatchId: existing?.id ?? null,
  }
}

export async function importTikTokAffiliateFile(
  options: ImportTikTokAffiliateFileOptions
): Promise<ImportTikTokAffiliateFileResult> {
  const supabase = createServiceClient()
  const fileBuffer = await fs.readFile(options.filePath)
  const fileName = options.originalFileName?.trim() || path.basename(options.filePath)
  const sourceFileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const parsedWorkbook = parseTikTokAffiliateWorkbook(fileBuffer, fileName, options.sheetName)

  // Pre-write validation: reject rows missing critical keys before staging
  const validRows = parsedWorkbook.rows.filter((row) => getCriticalFieldFailures(row).length === 0)
  const preWriteRejectedRowCount = parsedWorkbook.rowCount - validRows.length

  const { data: batch, error: batchError } = await supabase
    .from('tiktok_affiliate_import_batches')
    .insert({
      created_by: options.createdBy,
      source_file_name: parsedWorkbook.fileName,
      source_sheet_name: parsedWorkbook.sheetName,
      source_file_hash: sourceFileHash,
      raw_row_count: parsedWorkbook.rowCount,
      staged_row_count: 0,
      normalized_row_count: 0,
      skipped_row_count: 0,
      error_count: 0,
      status: 'processing',
      metadata: {
        header_row_number: parsedWorkbook.headerRowNumber,
        workbook_headers: parsedWorkbook.headers,
      },
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    throw new Error(batchError?.message || 'Failed to create tiktok_affiliate_import_batches row.')
  }

  try {
    const stagingRows = validRows.map((row) => ({
      created_by: options.createdBy,
      import_batch_id: batch.id,
      source_file_name: parsedWorkbook.fileName,
      source_sheet_name: parsedWorkbook.sheetName,
      source_row_number: row.sourceRowNumber,
      source_file_hash: sourceFileHash,
      order_id: row.orderId || null,
      sku_id: row.skuId || null,
      product_name: row.productName || null,
      product_id: row.productId || null,
      price_text: row.priceText || null,
      items_sold_text: row.itemsSoldText || null,
      items_refunded_text: row.itemsRefundedText || null,
      shop_name: row.shopName || null,
      shop_code: row.shopCode || null,
      affiliate_partner: row.affiliatePartner || null,
      agency: row.agency || null,
      currency: row.currency || null,
      order_type: row.orderType || null,
      order_settlement_status: row.orderSettlementStatus || null,
      indirect_flag: row.indirectFlag || null,
      commission_type: row.commissionType || null,
      content_type: row.contentType || null,
      content_id: row.contentId || null,
      standard_rate_text: row.standardRateText || null,
      shop_ads_rate_text: row.shopAdsRateText || null,
      tiktok_bonus_rate_text: row.tiktokBonusRateText || null,
      partner_bonus_rate_text: row.partnerBonusRateText || null,
      revenue_sharing_portion_rate_text: row.revenueSharingPortionRateText || null,
      gmv_text: row.gmvText || null,
      est_commission_base_text: row.estCommissionBaseText || null,
      est_standard_commission_text: row.estStandardCommissionText || null,
      est_shop_ads_commission_text: row.estShopAdsCommissionText || null,
      est_bonus_text: row.estBonusText || null,
      est_affiliate_partner_bonus_text: row.estAffiliatePartnerBonusText || null,
      est_iva_text: row.estIvaText || null,
      est_isr_text: row.estIsrText || null,
      est_pit_text: row.estPitText || null,
      est_revenue_sharing_portion_text: row.estRevenueSharingPortionText || null,
      actual_commission_base_text: row.actualCommissionBaseText || null,
      standard_commission_text: row.standardCommissionText || null,
      shop_ads_commission_text: row.shopAdsCommissionText || null,
      bonus_text: row.bonusText || null,
      affiliate_partner_bonus_text: row.affiliatePartnerBonusText || null,
      tax_isr_text: row.taxIsrText || null,
      tax_iva_text: row.taxIvaText || null,
      tax_pit_text: row.taxPitText || null,
      shared_with_partner_text: row.sharedWithPartnerText || null,
      total_final_earned_amount_text: row.totalFinalEarnedAmountText || null,
      order_date_text: row.orderDateText || null,
      commission_settlement_date_text: row.commissionSettlementDateText || null,
      raw_payload: row.rawPayload,
    }))

    await insertStagingRows(supabase, stagingRows)

    await supabase
      .from('tiktok_affiliate_import_batches')
      .update({
        status: 'staged',
        staged_row_count: validRows.length,
      })
      .eq('id', batch.id)

    const { data: normalizeResult, error: normalizeError } = await supabase.rpc(
      'normalize_tiktok_affiliate_order_batch',
      { p_import_batch_id: batch.id }
    )

    if (normalizeError) {
      throw new Error(normalizeError.message)
    }

    const normalizationSummary = Array.isArray(normalizeResult)
      ? normalizeResult[0]
      : normalizeResult

    const { data: batchSummary, error: batchSummaryError } = await supabase
      .from('tiktok_affiliate_import_batches')
      .select(
        'status, raw_row_count, staged_row_count, normalized_row_count, skipped_row_count, error_count, metadata'
      )
      .eq('id', batch.id)
      .single()

    if (batchSummaryError || !batchSummary) {
      throw new Error(batchSummaryError?.message || 'Failed to read batch summary after normalization.')
    }

    syncAffiliateBatch(supabase, options.createdBy, batch.id).catch(() => {})

    return {
      batchId: batch.id,
      fileName: parsedWorkbook.fileName,
      sheetName: parsedWorkbook.sheetName,
      headerRowNumber: parsedWorkbook.headerRowNumber,
      rawRowCount: batchSummary.raw_row_count,
      stagedRowCount: batchSummary.staged_row_count,
      preWriteRejectedRowCount,
      validCandidateRowCount: normalizationSummary?.valid_candidate_row_count ?? 0,
      winnerRowCount: normalizationSummary?.winner_row_count ?? 0,
      missingKeyRowCount: normalizationSummary?.missing_key_row_count ?? 0,
      invalidValueRowCount: normalizationSummary?.invalid_value_row_count ?? 0,
      duplicateNonWinnerRowCount: normalizationSummary?.duplicate_non_winner_row_count ?? 0,
      batchStatus: batchSummary.status,
      rejectionDetails: extractRejectionDetails(batchSummary.metadata),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown import error.'

    await supabase
      .from('tiktok_affiliate_import_batches')
      .update({
        status: 'failed',
        notes: message,
      })
      .eq('id', batch.id)

    throw error
  }
}

async function insertStagingRows(
  supabase: ReturnType<typeof createServiceClient>,
  rows: Record<string, unknown>[]
): Promise<void> {
  const chunkSize = 500

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    const { error } = await supabase.from('tiktok_affiliate_order_raw_staging').insert(chunk)

    if (error) {
      throw new Error(`Failed to insert staging rows: ${error.message}`)
    }
  }
}

export function parseTikTokAffiliateWorkbook(
  fileBuffer: Buffer,
  fileName: string,
  preferredSheetName?: string
): TikTokAffiliateParsedWorkbook {
  const workbook = XLSX.read(fileBuffer, {
    type: 'buffer',
    raw: false,
    cellDates: false,
    dense: false,
  })

  const sheetName = preferredSheetName || workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('Excel file has no sheets.')
  }

  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found.`)
  }

  const headerRowIndex = findHeaderRowIndex(worksheet)
  const headers = readRowValues(worksheet, headerRowIndex)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    range: headerRowIndex,
    defval: '',
    raw: false,
  })

  const parsedRows = rows
    .map((rawRow, index) => mapRawRow(rawRow, headerRowIndex + index + 2))
    .filter((row) => !isBlankParsedRow(row))

  return {
    fileName,
    sheetName,
    headerRowNumber: headerRowIndex + 1,
    rowCount: parsedRows.length,
    rows: parsedRows,
    headers,
  }
}

function findHeaderRowIndex(worksheet: XLSX.WorkSheet): number {
  const rowCount = getWorksheetRowCount(worksheet)
  const scanLimit = Math.min(rowCount, 15)

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const normalizedValues = readRowValues(worksheet, rowIndex).map(normalizeHeader)
    const hasOrderId = normalizedValues.some((v) => REQUIRED_ORDER_ID_HEADERS.has(v))
    const hasContentId = normalizedValues.some((v) => REQUIRED_CONTENT_ID_HEADERS.has(v))
    if (hasOrderId && hasContentId) {
      return rowIndex
    }
  }

  throw new Error(
    'Could not find required columns. Expected one of:\n' +
    '  - Order ID / หมายเลขคำสั่งซื้อ\n' +
    '  - Content ID / รหัสเนื้อหา'
  )
}

function getWorksheetRowCount(worksheet: XLSX.WorkSheet): number {
  const ref = worksheet['!ref']
  if (!ref) {
    return 0
  }

  const range = XLSX.utils.decode_range(ref)
  return range.e.r + 1
}

function readRowValues(worksheet: XLSX.WorkSheet, rowIndex: number): string[] {
  const ref = worksheet['!ref']
  if (!ref) {
    return []
  }

  const range = XLSX.utils.decode_range(ref)
  const values: string[] = []

  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    values.push(getCellText(worksheet, rowIndex, columnIndex))
  }

  return values
}

function getCellText(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number): string {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
  const cell = worksheet[address]

  if (!cell) {
    return ''
  }

  if (cell.w !== undefined && cell.w !== null) {
    return String(cell.w).trim()
  }

  if (cell.v !== undefined && cell.v !== null) {
    return String(cell.v).trim()
  }

  return ''
}

function mapRawRow(rawRow: Record<string, unknown>, sourceRowNumber: number): TikTokAffiliateParsedRow {
  const rawPayload = Object.fromEntries(
    Object.entries(rawRow).map(([key, value]) => [String(key), preserveRawText(value)])
  )

  const parsedRow: TikTokAffiliateParsedRow = {
    sourceRowNumber,
    rawPayload,
    orderId: '',
    skuId: '',
    productName: '',
    productId: '',
    priceText: '',
    itemsSoldText: '',
    itemsRefundedText: '',
    shopName: '',
    shopCode: '',
    affiliatePartner: '',
    agency: '',
    currency: '',
    orderType: '',
    orderSettlementStatus: '',
    indirectFlag: '',
    commissionType: '',
    contentType: '',
    contentId: '',
    standardRateText: '',
    shopAdsRateText: '',
    tiktokBonusRateText: '',
    partnerBonusRateText: '',
    revenueSharingPortionRateText: '',
    gmvText: '',
    estCommissionBaseText: '',
    estStandardCommissionText: '',
    estShopAdsCommissionText: '',
    estBonusText: '',
    estAffiliatePartnerBonusText: '',
    estIvaText: '',
    estIsrText: '',
    estPitText: '',
    estRevenueSharingPortionText: '',
    actualCommissionBaseText: '',
    standardCommissionText: '',
    shopAdsCommissionText: '',
    bonusText: '',
    affiliatePartnerBonusText: '',
    taxIsrText: '',
    taxIvaText: '',
    taxPitText: '',
    sharedWithPartnerText: '',
    totalFinalEarnedAmountText: '',
    orderDateText: '',
    commissionSettlementDateText: '',
  }

  // Build a normalized-key → value map from the raw row so that both English
  // and Thai header exports are handled without branching on file locale.
  const normalizedRawRow = new Map<string, unknown>()
  for (const [key, value] of Object.entries(rawRow)) {
    normalizedRawRow.set(normalizeHeader(key), value)
  }

  for (const [normalizedHeader, fieldName] of NORMALIZED_HEADER_TO_FIELD) {
    const value = normalizedRawRow.get(normalizedHeader)
    if (value !== undefined) {
      parsedRow[fieldName] = preserveRawText(value)
    }
  }

  return parsedRow
}

function preserveRawText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
}

function isBlankParsedRow(row: TikTokAffiliateParsedRow): boolean {
  return OBSERVED_HEADERS.every((header) => {
    const fieldName = HEADER_ALIASES[header]
    return row[fieldName].trim() === ''
  })
}

// Returns the names of critical DB key fields that are missing in this row.
// Used for pre-write validation before staging insertion.
function getCriticalFieldFailures(row: TikTokAffiliateParsedRow): string[] {
  const failed: string[] = []
  if (!row.orderId.trim()) failed.push('order_id')
  if (!row.contentId.trim()) failed.push('content_id')
  if (!row.productId.trim()) failed.push('product_id')
  return failed
}

function extractRejectionDetails(metadata: unknown): TikTokAffiliateImportRejectionDetails {
  const payload = isRecord(metadata) ? metadata : {}

  return {
    missingKeyFieldCounts: extractCountMap(payload.missing_key_field_counts),
    missingKeySampleRows: extractRejectedRowSamples(payload.missing_key_sample_rows),
    invalidValueFieldCounts: extractCountMap(payload.invalid_value_field_counts),
    invalidValueSampleRows: extractRejectedRowSamples(payload.invalid_value_sample_rows),
    duplicateNonWinnerSampleRows: extractDuplicateRowSamples(payload.duplicate_non_winner_sample_rows),
  }
}

function extractCountMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  const counts: Record<string, number> = {}

  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'number' && Number.isFinite(entryValue)) {
      counts[key] = entryValue
      continue
    }

    if (typeof entryValue === 'string' && entryValue.trim() !== '') {
      const parsed = Number(entryValue)
      if (Number.isFinite(parsed)) {
        counts[key] = parsed
      }
    }
  }

  return counts
}

function extractRejectedRowSamples(value: unknown): TikTokAffiliateRejectedRowSample[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const stagingRowId = asNonEmptyString(entry.staging_row_id)
    if (!stagingRowId) {
      return []
    }

    return [
      {
        stagingRowId,
        sourceRowNumber: asNullableNumber(entry.source_row_number),
        failedFields: asStringArray(entry.failed_fields),
      },
    ]
  })
}

function extractDuplicateRowSamples(value: unknown): TikTokAffiliateDuplicateRowSample[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const stagingRowId = asNonEmptyString(entry.staging_row_id)
    if (!stagingRowId) {
      return []
    }

    return [
      {
        stagingRowId,
        sourceRowNumber: asNullableNumber(entry.source_row_number),
        orderId: asNullableString(entry.order_id),
        skuId: asNullableString(entry.sku_id),
        productId: asNullableString(entry.product_id),
        contentId: asNullableString(entry.content_id),
        normalizedRowVersionHash: asNullableString(entry.normalized_row_version_hash),
      },
    ]
  })
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => (typeof entry === 'string' && entry.trim() !== '' ? [entry] : []))
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
