import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import crypto from 'crypto';

const BANGKOK_TZ = 'Asia/Bangkok';

/**
 * Custom error class for ads import with detailed context
 */
export class AdsImportError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: {
      sheetName?: string;
      sheetNames?: string[];
      scannedSheets?: string[];
      selectedSheet?: string;
      headers?: string[];
      missingColumns?: string[];
      rowIndex?: number;
      headerRow?: number;
      sampleValue?: unknown;
      suggestion?: string;
      scores?: Record<string, number>;
      headerRows?: Record<string, number>;
      detectedColumns?: Record<string, string>;
      candidateRows?: Array<{
        rowIndex: number;
        cellsPreview: string[];
        matchedFields: string[];
        score: number;
      }>;
      firstRowsPreview?: Array<{
        rowIndex: number;
        cells: string[];
      }>;
    }
  ) {
    super(message);
    this.name = 'AdsImportError';
  }
}

/**
 * Normalize header text: remove BOM, trim, lowercase, normalize whitespace
 */
function normalizeHeader(header: string): string {
  return String(header || '')
    .replace(/^\uFEFF/, '') // Remove BOM
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .toLowerCase();
}

/**
 * Normalize cell text for robust header detection
 * - Removes BOM, newlines, tabs, extra spaces
 * - Trims and lowercases
 */
function normalizeText(text: any): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/^\uFEFF/, '') // Remove BOM
    .replace(/[\n\r\t]+/g, ' ') // Remove newlines, tabs
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .toLowerCase();
}

// Column mappings for product campaigns (creative data)
// Supports English, Thai, and Chinese variants
const PRODUCT_CAMPAIGN_COLUMNS: Record<string, string[]> = {
  date: [
    'date', 'day', 'report date', 'stat date',
    'วันที่', 'วันเริ่มต้น', 'วันเริ่ม', 'เวลาเริ่มต้น', 'เวลาเริ่ม',
    '日期', '日',
  ],
  campaign_name: [
    'campaign name', 'campaign', 'creative name', 'ad name', 'ad group name',
    'ชื่อแคมเปญ', 'ชื่อแคมเปญโฆษณา', 'ชื่อโฆษณา', 'แคมเปญ',
    '广告系列名称', '活动名称',
  ],
  campaign_id: [
    'campaign id', 'id แคมเปญ', 'แคมเปญ id', 'campaignid',
    '广告系列id', '活动id',
  ],
  video_id: [
    'video id', 'id วิดีโอ', 'วิดีโอ id', 'videoid',
    '视频id',
  ],
  spend: [
    'cost', 'spend', 'total cost', 'ad spend', 'amount spent',
    'ต้นทุน', 'ค่าใช้จ่าย', 'ยอดใช้จ่าย', 'ค่าโฆษณา',
    '费用', '花费', '成本',
  ],
  orders: [
    'conversions', 'orders', 'total orders', 'order count', 'complete payment',
    'ยอดการซื้อ', 'คำสั่งซื้อ', 'จำนวนคำสั่งซื้อ', 'ออเดอร์', 'การแปลง',
    '订单', '转化', '购买',
  ],
  revenue: [
    'revenue', 'gmv', 'sales', 'total revenue', 'conversion value',
    'รายได้ขั้นต้น', 'รายได้', 'มูลค่ายอดขาย', 'ยอดขาย', 'รายได้รวม',
    '收入', 'gmv', '销售额',
  ],
  roi: [
    'roi', 'roas', 'return on ad spend', 'return on investment',
    'ผลตอบแทน', 'อัตราผลตอบแทน',
    '投资回报率',
  ],
};

// Column mappings for live campaigns (livestream data)
const LIVE_CAMPAIGN_COLUMNS: Record<string, string[]> = {
  date: [
    'date', 'day', 'report date', 'live date', 'stat date',
    'วันที่', 'เวลาเริ่มต้น', 'เวลาเริ่ม', 'วันไลฟ์', 'วันเริ่มต้น',
    '日期', '直播日期',
  ],
  campaign_name: [
    'live room name', 'room name', 'live name', 'campaign name', 'livestream name',
    'ชื่อ live', 'ชื่อไลฟ์', 'ชื่อห้องไลฟ์', 'ชื่อแคมเปญ',
    '直播间名称', '直播名称',
  ],
  campaign_id: [
    'campaign id', 'id แคมเปญ', 'แคมเปญ id', 'campaignid', 'live id',
    '广告系列id', '活动id', '直播id',
  ],
  video_id: [
    'video id', 'id วิดีโอ', 'วิดีโอ id', 'videoid', 'live video id',
    '视频id', '直播视频id',
  ],
  spend: [
    'cost', 'spend', 'total cost', 'ad spend', 'amount spent',
    'ต้นทุน', 'ค่าใช้จ่าย', 'ยอดใช้จ่าย', 'ค่าโฆษณา',
    '费用', '花费', '成本',
  ],
  orders: [
    'conversions', 'orders', 'total orders', 'product order', 'complete payment',
    'ยอดการซื้อ', 'คำสั่งซื้อ', 'จำนวนคำสั่งซื้อ', 'ออเดอร์', 'การแปลง',
    '订单', '转化', '购买',
  ],
  revenue: [
    'revenue', 'gmv', 'sales', 'total gmv', 'conversion value',
    'รายได้ขั้นต้น', 'รายได้', 'มูลค่ายอดขาย', 'ยอดขาย', 'รายได้รวม',
    '收入', 'gmv', '销售额',
  ],
  roi: [
    'roi', 'roas', 'return on investment',
    'ผลตอบแทน', 'อัตราผลตอบแทน',
    '投资回报率',
  ],
};

export interface NormalizedAdRow {
  ad_date: Date;
  campaign_type: 'product' | 'live' | null;
  campaign_name: string | null;
  campaign_id: string | null;
  video_id: string | null;
  spend: number;
  orders: number;
  revenue: number;
  roi: number | null;
  source_row_hash: string; // MD5 hash of normalized key + value fields
}

export interface AdImportResult {
  success: boolean;
  batchId: string | null;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
  warnings: string[];
}

/**
 * Create deterministic MD5 hash of row content
 * Used for deduplication and detecting data changes
 * @param row - Normalized ad row data
 * @returns MD5 hash string
 */
function makeSourceRowHash(row: Omit<NormalizedAdRow, 'source_row_hash'>): string {
  // Normalize numeric values to 2 decimal places (matches SQL TO_CHAR format)
  const normalizedSpend = row.spend.toFixed(2);
  const normalizedRevenue = row.revenue.toFixed(2);
  const normalizedOrders = String(row.orders);

  // Normalize strings: trim, lowercase, use empty string for null
  // This matches SQL: LOWER(TRIM(COALESCE(column, '')))
  const normalizedCampaignName = (row.campaign_name || '').trim().toLowerCase();
  const normalizedCampaignId = (row.campaign_id || '').trim().toLowerCase();
  const normalizedVideoId = (row.video_id || '').trim().toLowerCase();

  // Concatenate fields with pipe separator (exclude marketplace/date/type for deterministic hash)
  // Hash format: campaign_name|campaign_id|video_id|spend|orders|revenue
  const content = [
    normalizedCampaignName,
    normalizedCampaignId,
    normalizedVideoId,
    normalizedSpend,
    normalizedOrders,
    normalizedRevenue,
  ].join('|');

  // Return MD5 hash
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

export interface AdPreviewResult {
  success: boolean;
  summary: {
    fileName: string;
    sheetName: string;
    campaignType: 'product' | 'live';
    campaignTypeConfidence: number;
    dateRange: string;
    totalRows: number;
    keptRows: number;
    skippedAllZeroRows: number;
    totalSpend: number;
    totalOrders: number;
    totalRevenue: number;
    avgROI: number;
    skipZeroRowsUsed: boolean;
  };
  sampleRows: Array<{
    date: string;
    campaignName: string | null;
    spend: number;
    orders: number;
    revenue: number;
    roi: number | null;
  }>;
  warnings: string[];
  detectedColumns: {
    date: string;
    campaign: string;
    spend: string;
    orders: string;
    revenue: string;
    roi: string;
  };
}

/**
 * Calculate SHA256 hash of file buffer
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Find column index by trying multiple name variants with fuzzy matching
 * Returns: { index: number, matchType: 'exact' | 'partial' | 'none', matchedVariant?: string }
 */
function findColumn(
  headers: string[],
  variants: string[]
): { index: number; matchType: 'exact' | 'partial' | 'none'; matchedVariant?: string } {
  const normalizedHeaders = headers.map(normalizeHeader);

  // Try exact match first
  for (const variant of variants) {
    const normalizedVariant = variant.toLowerCase();
    const index = normalizedHeaders.indexOf(normalizedVariant);
    if (index !== -1) {
      return { index, matchType: 'exact', matchedVariant: variant };
    }
  }

  // Try partial match (header includes variant)
  for (const variant of variants) {
    const normalizedVariant = variant.toLowerCase();
    const index = normalizedHeaders.findIndex((h) => h.includes(normalizedVariant));
    if (index !== -1) {
      return { index, matchType: 'partial', matchedVariant: variant };
    }
  }

  return { index: -1, matchType: 'none' };
}

/**
 * Safe parse numeric value
 */
function parseNumeric(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * Safe parse date value
 */
function parseDate(value: unknown): Date | null {
  if (!value) return null;

  // Excel serial date number
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return fromZonedTime(startOfDay(toZonedTime(date, BANGKOK_TZ)), BANGKOK_TZ);
  }

  // String date
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return fromZonedTime(startOfDay(toZonedTime(date, BANGKOK_TZ)), BANGKOK_TZ);
    }
  }

  return null;
}

/**
 * Filter rows to skip all-zero rows (optional optimization)
 * Keeps rows where: spend > 0 OR orders > 0 OR revenue > 0
 * Skips rows where: spend = 0 AND orders = 0 AND revenue = 0
 *
 * @param rows - Parsed ad rows
 * @param skipZeroRows - If true, filter out all-zero rows (default: true)
 * @returns Filtered data with counts and totals
 */
interface FilteredAdData {
  totalRows: number;
  keptRows: NormalizedAdRow[];
  skippedAllZeroRows: number;
  totals: {
    spend: number;
    revenue: number;
    orders: number;
  };
}

function filterRows(
  rows: NormalizedAdRow[],
  skipZeroRows: boolean = true
): FilteredAdData {
  const totalRows = rows.length;

  // Apply filter if enabled
  const keptRows = skipZeroRows
    ? rows.filter((r) => {
        // Treat null/undefined as 0
        const spend = r.spend || 0;
        const orders = r.orders || 0;
        const revenue = r.revenue || 0;
        // Keep if ANY value > 0
        return spend > 0 || orders > 0 || revenue > 0;
      })
    : rows;

  const skippedAllZeroRows = totalRows - keptRows.length;

  // Compute totals from kept rows ONLY
  const totals = keptRows.reduce(
    (acc, r) => ({
      spend: acc.spend + (r.spend || 0),
      revenue: acc.revenue + (r.revenue || 0),
      orders: acc.orders + (r.orders || 0),
    }),
    { spend: 0, revenue: 0, orders: 0 }
  );

  return {
    totalRows,
    keptRows,
    skippedAllZeroRows,
    totals,
  };
}

/**
 * Detect header row in a sheet by scanning and scoring candidate rows
 * Returns detailed debug info including top candidates and first rows preview
 */
interface HeaderDetectionResult {
  headerRowIndex: number | null;
  score: number;
  mapping: Record<string, number>;
  headers: string[];
  candidateRows: Array<{
    rowIndex: number;
    cellsPreview: string[];
    matchedFields: string[];
    score: number;
  }>;
  firstRowsPreview: Array<{
    rowIndex: number;
    cells: string[];
  }>;
}

function detectHeaderRow(
  sheet: XLSX.WorkSheet,
  synonymDict: Record<string, string[]>,
  maxScanRows: number = 50
): HeaderDetectionResult {
  // Get sheet range
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const maxRow = Math.min(range.e.r, maxScanRows - 1);

  const candidateRows: Array<{
    rowIndex: number;
    cellsPreview: string[];
    matchedFields: string[];
    score: number;
  }> = [];

  const firstRowsPreview: Array<{
    rowIndex: number;
    cells: string[];
  }> = [];

  let bestRowIndex: number | null = null;
  let bestScore = 0;
  let bestMapping: Record<string, number> = {};
  let bestHeaders: string[] = [];

  // Scan rows
  for (let r = 0; r <= maxRow; r++) {
    const cells: string[] = [];

    // Read all cells in row (across full range)
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellAddress];
      const value = cell ? (cell.v ?? '') : '';
      cells.push(String(value));
    }

    // Store first 10 rows for debug preview
    if (r < 10) {
      firstRowsPreview.push({
        rowIndex: r + 1, // 1-indexed for display
        cells: cells.slice(0, 10), // First 10 columns only
      });
    }

    // Skip empty rows (all cells empty or whitespace)
    if (cells.every((c) => !c || normalizeText(c) === '')) {
      continue;
    }

    // Normalize cells for matching
    const normalizedCells = cells.map(normalizeText);

    // Try to match columns with synonym dictionary
    const mapping: Record<string, number> = {};
    const matchedFields: string[] = [];
    let score = 0;

    for (const [field, synonyms] of Object.entries(synonymDict)) {
      let bestColIdx = -1;
      let bestMatchScore = 0;

      for (let colIdx = 0; colIdx < normalizedCells.length; colIdx++) {
        const cellText = normalizedCells[colIdx];

        if (!cellText) continue;

        for (const synonym of synonyms) {
          const normalizedSynonym = normalizeText(synonym);

          // Exact match (score 100)
          if (cellText === normalizedSynonym) {
            if (100 > bestMatchScore) {
              bestMatchScore = 100;
              bestColIdx = colIdx;
            }
          }
          // Contains match (score 50)
          else if (
            cellText.includes(normalizedSynonym) ||
            normalizedSynonym.includes(cellText)
          ) {
            if (50 > bestMatchScore) {
              bestMatchScore = 50;
              bestColIdx = colIdx;
            }
          }
        }
      }

      if (bestColIdx >= 0) {
        mapping[field] = bestColIdx;
        matchedFields.push(field);
        score += bestMatchScore;
      }
    }

    // Store as candidate
    candidateRows.push({
      rowIndex: r + 1, // 1-indexed for display
      cellsPreview: cells.slice(0, 10), // First 10 columns
      matchedFields,
      score,
    });

    // Update best if better score
    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = r;
      bestMapping = mapping;
      bestHeaders = cells;
    }
  }

  // Sort candidates by score (desc)
  candidateRows.sort((a, b) => b.score - a.score);

  return {
    headerRowIndex: bestRowIndex,
    score: bestScore,
    mapping: bestMapping,
    headers: bestHeaders,
    candidateRows: candidateRows.slice(0, 5), // Top 5
    firstRowsPreview,
  };
}

/**
 * Detect campaign type from sheet name and columns with confidence score
 * Returns: { type, confidence, reason }
 */
function detectCampaignType(
  sheetName: string,
  headers: string[]
): { type: 'product' | 'live'; confidence: number; reason: string } {
  const normalizedSheetName = normalizeHeader(sheetName);
  const normalizedHeaders = headers.map(normalizeHeader);

  let liveScore = 0;
  let productScore = 0;
  const reasons: string[] = [];

  // Check sheet name for strong hints (weight: 2x)
  if (normalizedSheetName.includes('live') || normalizedSheetName.includes('livestream')) {
    liveScore += 2;
    reasons.push('sheet name contains "live"');
  }
  if (normalizedSheetName.includes('product') || normalizedSheetName.includes('creative')) {
    productScore += 2;
    reasons.push('sheet name contains "product/creative"');
  }

  // Check column names for hints (weight: 1x each)
  const liveKeywords = ['live room', 'room name', 'livestream'];
  const productKeywords = ['creative', 'ad group', 'ad name'];

  for (const keyword of liveKeywords) {
    if (normalizedHeaders.some((h) => h.includes(keyword))) {
      liveScore += 1;
      reasons.push(`column contains "${keyword}"`);
    }
  }

  for (const keyword of productKeywords) {
    if (normalizedHeaders.some((h) => h.includes(keyword))) {
      productScore += 1;
      reasons.push(`column contains "${keyword}"`);
    }
  }

  // Determine type and confidence
  const totalScore = liveScore + productScore;
  if (liveScore > productScore) {
    return {
      type: 'live',
      confidence: totalScore > 0 ? liveScore / totalScore : 0.5,
      reason: reasons.join(', ') || 'default detection',
    };
  } else {
    // Default to product if unclear or tie
    return {
      type: 'product',
      confidence: totalScore > 0 ? productScore / totalScore : 0.5,
      reason: reasons.join(', ') || 'default to product',
    };
  }
}

/**
 * Scan all sheets and find the best match for ads data
 * Now uses detectHeaderRow for robust header detection
 */
function findBestSheet(workbook: XLSX.WorkBook): {
  sheetName: string;
  score: number;
  headers: string[];
  headerRowIndex: number;
  campaignType: { type: 'product' | 'live'; confidence: number; reason: string };
  debug: {
    scannedSheets: string[];
    headerRows: Record<string, number>;
    scores: Record<string, number>;
    columnMatches: Record<string, any>;
    candidateRows?: Array<any>;
    firstRowsPreview?: Array<any>;
  };
} {
  const candidates: {
    sheetName: string;
    score: number;
    headers: string[];
    headerRowIndex: number;
    campaignType: { type: 'product' | 'live'; confidence: number; reason: string };
    mapping: Record<string, number>;
    detectionResult: HeaderDetectionResult;
  }[] = [];

  const debug = {
    scannedSheets: [] as string[],
    headerRows: {} as Record<string, number>,
    scores: {} as Record<string, number>,
    columnMatches: {} as Record<string, any>,
    candidateRows: [] as any[],
    firstRowsPreview: [] as any[],
  };

  for (const sheetName of workbook.SheetNames) {
    debug.scannedSheets.push(sheetName);

    const worksheet = workbook.Sheets[sheetName];

    // Try product columns first
    const synonymDict = {
      date: PRODUCT_CAMPAIGN_COLUMNS.date,
      campaign_name: PRODUCT_CAMPAIGN_COLUMNS.campaign_name,
      campaign_id: PRODUCT_CAMPAIGN_COLUMNS.campaign_id,
      video_id: PRODUCT_CAMPAIGN_COLUMNS.video_id,
      spend: PRODUCT_CAMPAIGN_COLUMNS.spend,
      orders: PRODUCT_CAMPAIGN_COLUMNS.orders,
      revenue: PRODUCT_CAMPAIGN_COLUMNS.revenue,
      roi: PRODUCT_CAMPAIGN_COLUMNS.roi,
    };

    const result = detectHeaderRow(worksheet, synonymDict, 50);

    if (result.headerRowIndex === null) {
      // No valid header found in this sheet
      continue;
    }

    debug.headerRows[sheetName] = result.headerRowIndex + 1; // 1-indexed for display
    debug.scores[sheetName] = result.score;

    // Detect campaign type based on sheet name and headers
    const campaignType = detectCampaignType(sheetName, result.headers);

    // Final score: header detection score + campaign type confidence bonus
    const finalScore = result.score + campaignType.confidence * 10;

    candidates.push({
      sheetName,
      score: finalScore,
      headers: result.headers,
      headerRowIndex: result.headerRowIndex,
      campaignType,
      mapping: result.mapping,
      detectionResult: result,
    });
  }

  if (candidates.length === 0) {
    // No sheets with valid headers found - provide detailed debug
    // Use detection result from first sheet for debug info
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const firstResult = firstSheet
      ? detectHeaderRow(
          firstSheet,
          {
            date: PRODUCT_CAMPAIGN_COLUMNS.date,
            campaign_name: PRODUCT_CAMPAIGN_COLUMNS.campaign_name,
            spend: PRODUCT_CAMPAIGN_COLUMNS.spend,
            orders: PRODUCT_CAMPAIGN_COLUMNS.orders,
            revenue: PRODUCT_CAMPAIGN_COLUMNS.revenue,
          },
          50
        )
      : null;

    throw new AdsImportError(
      'ไม่พบ sheet ที่มีข้อมูลโฆษณา - ไม่มี sheet ใดที่มี columns ที่จำเป็น',
      'NO_VALID_SHEET',
      {
        sheetNames: workbook.SheetNames,
        scannedSheets: debug.scannedSheets,
        headerRows: debug.headerRows,
        scores: debug.scores,
        candidateRows: firstResult?.candidateRows,
        firstRowsPreview: firstResult?.firstRowsPreview,
        suggestion:
          'ตรวจสอบว่าไฟล์มี columns ที่จำเป็น:\n' +
          '- Date/วันที่/วันเริ่มต้น/เวลาเริ่มต้น\n' +
          '- Campaign/แคมเปญ/ชื่อแคมเปญ/ชื่อ LIVE\n' +
          '- Cost/ต้นทุน/ค่าใช้จ่าย\n' +
          '- GMV/รายได้/รายได้ขั้นต้น\n' +
          '- Orders/ยอดการซื้อ/คำสั่งซื้อ',
      }
    );
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];

  // Include debug details from best sheet
  debug.candidateRows = best.detectionResult.candidateRows;
  debug.firstRowsPreview = best.detectionResult.firstRowsPreview;
  debug.columnMatches = {
    selectedSheet: best.sheetName,
    mapping: best.mapping,
  };

  console.log('[Ads Import] Sheet candidates:', candidates.map(c => ({
    name: c.sheetName,
    score: c.score,
    type: c.campaignType.type,
    confidence: c.campaignType.confidence.toFixed(2),
    headerRow: c.headerRowIndex + 1,
  })));

  console.log('[Ads Import] Selected sheet debug:', {
    sheet: best.sheetName,
    headerRow: best.headerRowIndex + 1,
    score: best.score,
    detectedScore: best.detectionResult.score,
    mapping: best.mapping,
  });

  return {
    sheetName: best.sheetName,
    score: best.score,
    headers: best.headers,
    headerRowIndex: best.headerRowIndex,
    campaignType: best.campaignType,
    debug,
  };
}

/**
 * Parse Excel buffer and normalize ad rows
 * @param buffer - Excel file buffer
 * @param reportDate - Report date (required if file has no Date column)
 * @param adsType - Ads type: 'product' or 'live' (required)
 * @param skipZeroRows - If true, filter out all-zero rows (default: true)
 */
export function parseAdsExcel(
  buffer: Buffer,
  reportDate?: Date,
  adsType?: 'product' | 'live',
  skipZeroRows: boolean = true
): {
  totalRows: number;
  keptRows: NormalizedAdRow[];
  skippedAllZeroRows: number;
  totals: {
    spend: number;
    revenue: number;
    orders: number;
  };
  warnings: string[];
  skipZeroRowsUsed: boolean;
} {
  const warnings: string[] = [];
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  if (workbook.SheetNames.length === 0) {
    throw new AdsImportError(
      'ไฟล์ Excel ไม่มี sheet',
      'NO_SHEETS',
      {
        suggestion: 'ตรวจสอบว่าไฟล์ถูกต้องและไม่เสียหาย',
      }
    );
  }

  // Find best sheet
  const bestSheet = findBestSheet(workbook);
  const { sheetName, headers, headerRowIndex, campaignType } = bestSheet;

  console.log('[Ads Import] Selected sheet:', {
    name: sheetName,
    type: campaignType.type,
    confidence: campaignType.confidence.toFixed(2),
    reason: campaignType.reason,
    headerRowIndex: headerRowIndex + 1,
  });

  const worksheet = workbook.Sheets[sheetName];

  // Re-detect header with correct campaign type columns
  const columnMappings =
    campaignType.type === 'live' ? LIVE_CAMPAIGN_COLUMNS : PRODUCT_CAMPAIGN_COLUMNS;

  const synonymDict = {
    date: columnMappings.date,
    campaign_name: columnMappings.campaign_name,
    campaign_id: columnMappings.campaign_id,
    video_id: columnMappings.video_id,
    spend: columnMappings.spend,
    orders: columnMappings.orders,
    revenue: columnMappings.revenue,
    roi: columnMappings.roi,
  };

  const detectionResult = detectHeaderRow(worksheet, synonymDict, 50);

  if (detectionResult.headerRowIndex === null) {
    throw new AdsImportError(
      'Sheet ไม่มีข้อมูล',
      'EMPTY_SHEET',
      {
        sheetName,
        suggestion: 'ตรวจสอบว่า sheet มีข้อมูลอย่างน้อย 2 แถว (header + data)',
        candidateRows: detectionResult.candidateRows,
        firstRowsPreview: detectionResult.firstRowsPreview,
      }
    );
  }

  const columnIndexes = {
    date: detectionResult.mapping.date ?? -1,
    campaign_name: detectionResult.mapping.campaign_name ?? -1,
    campaign_id: detectionResult.mapping.campaign_id ?? -1,
    video_id: detectionResult.mapping.video_id ?? -1,
    spend: detectionResult.mapping.spend ?? -1,
    orders: detectionResult.mapping.orders ?? -1,
    revenue: detectionResult.mapping.revenue ?? -1,
    roi: detectionResult.mapping.roi ?? -1,
  };

  // Log detected columns
  console.log('[Ads Import] Detected columns:', {
    date: columnIndexes.date >= 0 ? `Column ${columnIndexes.date + 1}` : 'NOT FOUND',
    campaign_name: columnIndexes.campaign_name >= 0 ? `Column ${columnIndexes.campaign_name + 1}` : 'NOT FOUND',
    campaign_id: columnIndexes.campaign_id >= 0 ? `Column ${columnIndexes.campaign_id + 1}` : 'NOT FOUND',
    video_id: columnIndexes.video_id >= 0 ? `Column ${columnIndexes.video_id + 1}` : 'NOT FOUND',
    spend: columnIndexes.spend >= 0 ? `Column ${columnIndexes.spend + 1}` : 'NOT FOUND',
    orders: columnIndexes.orders >= 0 ? `Column ${columnIndexes.orders + 1}` : 'NOT FOUND',
    revenue: columnIndexes.revenue >= 0 ? `Column ${columnIndexes.revenue + 1}` : 'NOT FOUND',
    roi: columnIndexes.roi >= 0 ? `Column ${columnIndexes.roi + 1}` : 'NOT FOUND',
  });

  // Validate required columns
  const missingColumns: string[] = [];
  const missingDetails: string[] = [];

  // Date column is optional if reportDate is provided
  if (columnIndexes.date === -1 && !reportDate) {
    missingColumns.push('Date');
    missingDetails.push('Date/วันที่/วันเริ่มต้น/เวลาเริ่มต้น (or provide Report Date)');
  }
  if (columnIndexes.spend === -1) {
    missingColumns.push('Cost/Spend');
    missingDetails.push('Cost/ต้นทุน/ค่าใช้จ่าย');
  }
  if (columnIndexes.orders === -1) {
    missingColumns.push('Orders');
    missingDetails.push('Orders/ยอดการซื้อ/คำสั่งซื้อ');
  }
  if (columnIndexes.revenue === -1) {
    missingColumns.push('Revenue');
    missingDetails.push('Revenue/GMV/รายได้/รายได้ขั้นต้น');
  }

  // Add warning if date column is missing but reportDate is provided
  if (columnIndexes.date === -1 && reportDate) {
    warnings.push('⚠️ ไฟล์ไม่มี Date column - ใช้ Report Date สำหรับทุก row');
  }

  if (missingColumns.length > 0) {
    throw new AdsImportError(
      `ไม่พบ columns ที่จำเป็น: ${missingColumns.join(', ')}`,
      'MISSING_REQUIRED_COLUMNS',
      {
        sheetName,
        headers: detectionResult.headers,
        missingColumns,
        selectedSheet: sheetName,
        headerRow: detectionResult.headerRowIndex + 1,
        detectedColumns: {
          date: columnIndexes.date >= 0 ? `Column ${columnIndexes.date + 1}` : 'NOT FOUND',
          campaign: columnIndexes.campaign_name >= 0 ? `Column ${columnIndexes.campaign_name + 1}` : 'NOT FOUND',
          spend: columnIndexes.spend >= 0 ? `Column ${columnIndexes.spend + 1}` : 'NOT FOUND',
          orders: columnIndexes.orders >= 0 ? `Column ${columnIndexes.orders + 1}` : 'NOT FOUND',
          revenue: columnIndexes.revenue >= 0 ? `Column ${columnIndexes.revenue + 1}` : 'NOT FOUND',
        },
        candidateRows: detectionResult.candidateRows,
        firstRowsPreview: detectionResult.firstRowsPreview,
        suggestion:
          `ตรวจสอบว่าไฟล์มี columns ที่จำเป็น:\n` +
          missingDetails.map((detail) => `- ${detail}`).join('\n') +
          `\n\nHeaders ที่เจอในไฟล์: ${detectionResult.headers.slice(0, 10).join(', ')}${detectionResult.headers.length > 10 ? '...' : ''}`,
      }
    );
  }

  // Parse data rows manually (bypass sheet_to_json)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const rows: NormalizedAdRow[] = [];
  let skippedRows = 0;
  let invalidDates = 0;

  for (let r = detectionResult.headerRowIndex + 1; r <= range.e.r; r++) {
    // Read row cells manually
    const rowCells: any[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellAddress];
      rowCells.push(cell ? cell.v : null);
    }

    // Skip empty rows
    if (rowCells.every((v) => v === null || v === undefined || v === '')) {
      skippedRows++;
      continue;
    }

    // Get date: use file date if available, otherwise use reportDate
    let adDate: Date | null = null;
    if (columnIndexes.date !== -1) {
      const dateValue = rowCells[columnIndexes.date];
      adDate = parseDate(dateValue);

      if (!adDate && !reportDate) {
        invalidDates++;
        warnings.push(`Row ${r + 1}: Invalid or missing date "${dateValue}", skipping`);
        continue;
      }
    }

    // Fallback to reportDate if file date is missing or invalid
    if (!adDate && reportDate) {
      adDate = reportDate;
    }

    if (!adDate) {
      invalidDates++;
      warnings.push(`Row ${r + 1}: No valid date (file date and reportDate both missing), skipping`);
      continue;
    }

    const spend = columnIndexes.spend !== -1 ? parseNumeric(rowCells[columnIndexes.spend]) : 0;
    const orders = columnIndexes.orders !== -1 ? parseNumeric(rowCells[columnIndexes.orders]) : 0;
    const revenue = columnIndexes.revenue !== -1 ? parseNumeric(rowCells[columnIndexes.revenue]) : 0;
    let roi = columnIndexes.roi !== -1 ? parseNumeric(rowCells[columnIndexes.roi]) : null;

    // Calculate ROI if not provided and spend > 0
    if (roi === null && spend > 0) {
      roi = revenue / spend;
    }

    // Parse campaign_id and video_id (fallback to null if not found)
    const campaignId =
      columnIndexes.campaign_id !== -1 && rowCells[columnIndexes.campaign_id]
        ? String(rowCells[columnIndexes.campaign_id]).trim()
        : null;

    const videoId =
      columnIndexes.video_id !== -1 && rowCells[columnIndexes.video_id]
        ? String(rowCells[columnIndexes.video_id]).trim()
        : null;

    // Use adsType if provided, otherwise use auto-detected campaignType
    const finalCampaignType = adsType || campaignType.type;

    // Build row without hash first
    const rowWithoutHash = {
      ad_date: adDate,
      campaign_type: finalCampaignType,
      campaign_name:
        columnIndexes.campaign_name !== -1 && rowCells[columnIndexes.campaign_name]
          ? String(rowCells[columnIndexes.campaign_name]).trim()
          : null,
      campaign_id: campaignId,
      video_id: videoId,
      spend,
      orders: Math.floor(orders), // Ensure integer
      revenue,
      roi,
    };

    // Calculate source_row_hash from normalized fields
    const sourceRowHash = makeSourceRowHash(rowWithoutHash);

    // Add hash to final row
    const normalizedRow: NormalizedAdRow = {
      ...rowWithoutHash,
      source_row_hash: sourceRowHash,
    };

    rows.push(normalizedRow);
  }

  console.log('[Ads Import] Parse summary:', {
    totalDataRows: range.e.r - detectionResult.headerRowIndex,
    validRows: rows.length,
    skippedRows,
    invalidDates,
    warningCount: warnings.length,
  });

  if (rows.length === 0) {
    throw new AdsImportError(
      'ไม่มีข้อมูลที่ valid ในไฟล์',
      'NO_VALID_DATA',
      {
        sheetName,
        headers,
        rowIndex: headerRowIndex,
        suggestion: 'ตรวจสอบว่ามีข้อมูลใน sheet และ columns ถูกต้อง',
      }
    );
  }

  // Apply filter (skip all-zero rows if enabled)
  const filtered = filterRows(rows, skipZeroRows);

  console.log('[Ads Import] Filter summary:', {
    skipZeroRows,
    totalRows: filtered.totalRows,
    keptRows: filtered.keptRows.length,
    skippedAllZeroRows: filtered.skippedAllZeroRows,
    totals: filtered.totals,
  });

  return {
    totalRows: filtered.totalRows,
    keptRows: filtered.keptRows,
    skippedAllZeroRows: filtered.skippedAllZeroRows,
    totals: filtered.totals,
    warnings,
    skipZeroRowsUsed: skipZeroRows,
  };
}

/**
 * Preview ads file without inserting to database
 * Returns summary and sample rows for user confirmation
 * @param buffer - Excel file buffer
 * @param fileName - File name
 * @param reportDate - Report date (required if file has no Date column)
 * @param adsType - Ads type: 'product' or 'live' (required)
 * @param skipZeroRows - If true, filter out all-zero rows (default: true)
 */
export function previewAdsExcel(
  buffer: Buffer,
  fileName: string,
  reportDate?: Date,
  adsType?: 'product' | 'live',
  skipZeroRows: boolean = true
): AdPreviewResult {
  try {
    const parseResult = parseAdsExcel(buffer, reportDate, adsType, skipZeroRows);

    if (parseResult.keptRows.length === 0) {
      throw new AdsImportError(
        'ไม่พบข้อมูลที่ valid ในไฟล์',
        'NO_VALID_DATA',
        {
          suggestion: 'ตรวจสอบว่าไฟล์มีข้อมูลและ format ถูกต้อง',
        }
      );
    }

    // Get workbook for metadata
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const bestSheet = findBestSheet(workbook);

    // Calculate summary from kept rows (already computed in parseResult.totals)
    const totalSpend = parseResult.totals.spend;
    const totalOrders = parseResult.totals.orders;
    const totalRevenue = parseResult.totals.revenue;
    const avgROI = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    // Get date range from kept rows (format as Bangkok dates)
    const dates = parseResult.keptRows
      .map((r) => formatInTimeZone(r.ad_date, BANGKOK_TZ, 'yyyy-MM-dd'))
      .sort();
    const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown';

    // Get sample rows (first 5 from kept rows)
    const sampleRows = parseResult.keptRows.slice(0, 5).map((row) => ({
      date: formatInTimeZone(row.ad_date, BANGKOK_TZ, 'yyyy-MM-dd'),
      campaignName: row.campaign_name,
      spend: row.spend,
      orders: row.orders,
      revenue: row.revenue,
      roi: row.roi,
    }));

    // Get detected column names from first parsed row's mapping
    const worksheet = workbook.Sheets[bestSheet.sheetName];
    const columnMappings =
      bestSheet.campaignType.type === 'live' ? LIVE_CAMPAIGN_COLUMNS : PRODUCT_CAMPAIGN_COLUMNS;

    const synonymDict = {
      date: columnMappings.date,
      campaign_name: columnMappings.campaign_name,
      campaign_id: columnMappings.campaign_id,
      video_id: columnMappings.video_id,
      spend: columnMappings.spend,
      orders: columnMappings.orders,
      revenue: columnMappings.revenue,
      roi: columnMappings.roi,
    };

    const detectionResult = detectHeaderRow(worksheet, synonymDict, 50);

    const detectedColumns = {
      date: detectionResult.mapping.date !== undefined
        ? `Column ${detectionResult.mapping.date + 1} (${detectionResult.headers[detectionResult.mapping.date] || ''})`
        : 'NOT FOUND',
      campaign: detectionResult.mapping.campaign_name !== undefined
        ? `Column ${detectionResult.mapping.campaign_name + 1} (${detectionResult.headers[detectionResult.mapping.campaign_name] || ''})`
        : 'NOT FOUND',
      spend: detectionResult.mapping.spend !== undefined
        ? `Column ${detectionResult.mapping.spend + 1} (${detectionResult.headers[detectionResult.mapping.spend] || ''})`
        : 'NOT FOUND',
      orders: detectionResult.mapping.orders !== undefined
        ? `Column ${detectionResult.mapping.orders + 1} (${detectionResult.headers[detectionResult.mapping.orders] || ''})`
        : 'NOT FOUND',
      revenue: detectionResult.mapping.revenue !== undefined
        ? `Column ${detectionResult.mapping.revenue + 1} (${detectionResult.headers[detectionResult.mapping.revenue] || ''})`
        : 'NOT FOUND',
      roi: detectionResult.mapping.roi !== undefined
        ? `Column ${detectionResult.mapping.roi + 1} (${detectionResult.headers[detectionResult.mapping.roi] || ''})`
        : 'NOT FOUND',
    };

    return {
      success: true,
      summary: {
        fileName,
        sheetName: bestSheet.sheetName,
        campaignType: bestSheet.campaignType.type,
        campaignTypeConfidence: bestSheet.campaignType.confidence,
        dateRange,
        totalRows: parseResult.totalRows,
        keptRows: parseResult.keptRows.length,
        skippedAllZeroRows: parseResult.skippedAllZeroRows,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalOrders: Math.round(totalOrders),
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        avgROI: Math.round(avgROI * 100) / 100,
        skipZeroRowsUsed: parseResult.skipZeroRowsUsed,
      },
      sampleRows,
      warnings: parseResult.warnings,
      detectedColumns,
    };
  } catch (error) {
    if (error instanceof AdsImportError) {
      throw error;
    }
    throw new AdsImportError(
      'ไม่สามารถ preview ไฟล์ได้',
      'PREVIEW_ERROR',
      {
        suggestion: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
}

/**
 * Upsert rows into ad_daily_performance table
 */
export async function upsertAdRows(
  rows: NormalizedAdRow[],
  batchId: string,
  userId: string
): Promise<{
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  errors: string[];
}> {
  const supabase = await createClient();
  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      // Format ad_date as Bangkok date (YYYY-MM-DD) to avoid UTC shift
      const adDate = formatInTimeZone(row.ad_date, BANGKOK_TZ, 'yyyy-MM-dd');
      const campaignType = row.campaign_type || 'product';
      const campaignName = row.campaign_name || '';
      const campaignId = row.campaign_id || '';
      const videoId = row.video_id || '';
      const sourceRowHash = row.source_row_hash;

      // Check if exists using source_row_hash (deterministic and robust)
      // This prevents duplicate rows with same campaign_id/video_id but different spend/orders/revenue
      const { data: existing, error: selectError } = await supabase
        .from('ad_daily_performance')
        .select('id')
        .eq('source_row_hash', sourceRowHash)
        .eq('created_by', userId)
        .maybeSingle();

      if (selectError) {
        throw selectError;
      }

      // DEBUG: Log first 3 rows
      if (rows.indexOf(row) < 3) {
        console.log(`[UPSERT_DEBUG] Row ${rows.indexOf(row) + 1}:`, {
          adDate,
          campaign: campaignName.substring(0, 30),
          campaignId: campaignId || '(empty)',
          videoId: videoId || '(empty)',
          spend: row.spend,
          orders: row.orders,
          revenue: row.revenue,
          roi: row.roi,
          hash: sourceRowHash.substring(0, 8),
          existing: existing ? `Found (id=${existing.id})` : 'Not found (will INSERT)',
        });
      }

      if (existing) {
        // UPDATE existing row
        const { error: updateError } = await supabase
          .from('ad_daily_performance')
          .update({
            campaign_name: campaignName, // Keep campaign_name full (no truncation)
            campaign_id: campaignId === '' ? null : campaignId,
            video_id: videoId === '' ? null : videoId,
            spend: row.spend,
            orders: row.orders,
            revenue: row.revenue,
            roi: row.roi,
            source_row_hash: sourceRowHash,
            import_batch_id: batchId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (updateError) {
          errorCount++;
          errors.push(`UPDATE failed for ${adDate} ${campaignName.substring(0, 30)}: ${updateError.message}`);
          console.error('[UPSERT_ERROR] UPDATE failed:', updateError);
        } else {
          updatedCount++;
          if (rows.indexOf(row) < 3) {
            console.log(`[UPSERT_SUCCESS] Updated row ${rows.indexOf(row) + 1}`);
          }
        }
      } else {
        // INSERT new row
        const { error: insertError } = await supabase
          .from('ad_daily_performance')
          .insert({
            marketplace: 'tiktok',
            ad_date: adDate,
            campaign_type: campaignType,
            campaign_name: campaignName, // Keep campaign_name full (no truncation)
            campaign_id: campaignId === '' ? null : campaignId,
            video_id: videoId === '' ? null : videoId,
            spend: row.spend,
            orders: row.orders,
            revenue: row.revenue,
            roi: row.roi,
            source_row_hash: sourceRowHash,
            source: 'imported',
            import_batch_id: batchId,
            created_by: userId,
          });

        if (insertError) {
          errorCount++;
          errors.push(`INSERT failed for ${adDate} ${campaignName.substring(0, 30)}: ${insertError.message}`);
          console.error('[UPSERT_ERROR] INSERT failed:', insertError);
        } else {
          insertedCount++;
          if (rows.indexOf(row) < 3) {
            console.log(`[UPSERT_SUCCESS] Inserted row ${rows.indexOf(row) + 1}`);
          }
        }
      }
    } catch (err) {
      errorCount++;
      errors.push(
        `Ad record ${row.ad_date.toISOString().split('T')[0]}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
      console.error('[UPSERT_ERROR] Exception:', err);
    }
  }

  return { insertedCount, updatedCount, errorCount, errors };
}
