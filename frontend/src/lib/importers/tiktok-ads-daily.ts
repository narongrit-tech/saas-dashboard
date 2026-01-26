import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
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
      selectedSheet?: string;
      headers?: string[];
      missingColumns?: string[];
      rowIndex?: number;
      sampleValue?: unknown;
      suggestion?: string;
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

// Column mappings for product campaigns (creative data)
const PRODUCT_CAMPAIGN_COLUMNS: Record<string, string[]> = {
  date: ['date', 'day', 'report date', 'stat date'],
  campaign_name: ['campaign name', 'campaign', 'creative name', 'ad name', 'ad group name'],
  spend: ['cost', 'spend', 'total cost', 'ad spend', 'amount spent'],
  orders: ['conversions', 'orders', 'total orders', 'order count', 'complete payment'],
  revenue: ['revenue', 'gmv', 'sales', 'total revenue', 'conversion value'],
  roi: ['roi', 'roas', 'return on ad spend', 'return on investment'],
};

// Column mappings for live campaigns (livestream data)
const LIVE_CAMPAIGN_COLUMNS: Record<string, string[]> = {
  date: ['date', 'day', 'report date', 'live date', 'stat date'],
  campaign_name: ['live room name', 'room name', 'live name', 'campaign name', 'livestream name'],
  spend: ['cost', 'spend', 'total cost', 'ad spend', 'amount spent'],
  orders: ['conversions', 'orders', 'total orders', 'product order', 'complete payment'],
  revenue: ['revenue', 'gmv', 'sales', 'total gmv', 'conversion value'],
  roi: ['roi', 'roas', 'return on investment'],
};

export interface NormalizedAdRow {
  ad_date: Date;
  campaign_type: 'product' | 'live' | null;
  campaign_name: string | null;
  spend: number;
  orders: number;
  revenue: number;
  roi: number | null;
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

export interface AdPreviewResult {
  success: boolean;
  summary: {
    fileName: string;
    sheetName: string;
    campaignType: 'product' | 'live';
    campaignTypeConfidence: number;
    dateRange: string;
    totalRows: number;
    totalSpend: number;
    totalOrders: number;
    totalRevenue: number;
    avgROI: number;
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
 * Returns: { sheetName, score, headers, campaignType }
 */
function findBestSheet(workbook: XLSX.WorkBook): {
  sheetName: string;
  score: number;
  headers: string[];
  headerRowIndex: number;
  campaignType: { type: 'product' | 'live'; confidence: number; reason: string };
} {
  const candidates: {
    sheetName: string;
    score: number;
    headers: string[];
    headerRowIndex: number;
    campaignType: { type: 'product' | 'live'; confidence: number; reason: string };
  }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

    if (data.length < 2) continue; // Skip empty sheets

    // Find header row
    let headerRowIndex = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (Array.isArray(row) && row.length > 3) {
        const candidateHeaders = row.map((v) => String(v || ''));
        const dateMatch = findColumn(candidateHeaders, PRODUCT_CAMPAIGN_COLUMNS.date);
        if (dateMatch.index !== -1) {
          headerRowIndex = i;
          headers = candidateHeaders;
          break;
        }
      }
    }

    if (headerRowIndex === -1) continue; // No valid header row

    // Calculate match score
    let score = 0;
    const campaignType = detectCampaignType(sheetName, headers);
    const columnMappings =
      campaignType.type === 'live' ? LIVE_CAMPAIGN_COLUMNS : PRODUCT_CAMPAIGN_COLUMNS;

    // Score based on required columns
    const dateMatch = findColumn(headers, columnMappings.date);
    const spendMatch = findColumn(headers, columnMappings.spend);
    const ordersMatch = findColumn(headers, columnMappings.orders);
    const revenueMatch = findColumn(headers, columnMappings.revenue);

    if (dateMatch.index !== -1) score += dateMatch.matchType === 'exact' ? 10 : 5;
    if (spendMatch.index !== -1) score += spendMatch.matchType === 'exact' ? 10 : 5;
    if (ordersMatch.index !== -1) score += ordersMatch.matchType === 'exact' ? 10 : 5;
    if (revenueMatch.index !== -1) score += revenueMatch.matchType === 'exact' ? 10 : 5;

    // Bonus for campaign type confidence
    score += campaignType.confidence * 10;

    candidates.push({ sheetName, score, headers, headerRowIndex, campaignType });
  }

  if (candidates.length === 0) {
    throw new AdsImportError(
      'ไม่พบ sheet ที่มีข้อมูลโฆษณา',
      'NO_VALID_SHEET',
      {
        sheetNames: workbook.SheetNames,
        suggestion: 'ตรวจสอบว่าไฟล์มี columns: Date, Campaign, Cost, GMV, Orders',
      }
    );
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  console.log('[Ads Import] Sheet candidates:', candidates.map(c => ({
    name: c.sheetName,
    score: c.score,
    type: c.campaignType.type,
    confidence: c.campaignType.confidence.toFixed(2)
  })));

  return candidates[0];
}

/**
 * Parse Excel buffer and normalize ad rows
 */
export function parseAdsExcel(buffer: Buffer): {
  rows: NormalizedAdRow[];
  warnings: string[];
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
    reason: campaignType.reason
  });

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (data.length < 2) {
    throw new AdsImportError(
      'Sheet ไม่มีข้อมูล',
      'EMPTY_SHEET',
      {
        sheetName,
        suggestion: 'ตรวจสอบว่า sheet มีข้อมูลอย่างน้อย 2 แถว (header + data)',
      }
    );
  }

  const columnMappings =
    campaignType.type === 'live' ? LIVE_CAMPAIGN_COLUMNS : PRODUCT_CAMPAIGN_COLUMNS;

  const columnMatches = {
    date: findColumn(headers, columnMappings.date),
    campaign_name: findColumn(headers, columnMappings.campaign_name),
    spend: findColumn(headers, columnMappings.spend),
    orders: findColumn(headers, columnMappings.orders),
    revenue: findColumn(headers, columnMappings.revenue),
    roi: findColumn(headers, columnMappings.roi),
  };

  const columnIndexes = {
    date: columnMatches.date.index,
    campaign_name: columnMatches.campaign_name.index,
    spend: columnMatches.spend.index,
    orders: columnMatches.orders.index,
    revenue: columnMatches.revenue.index,
    roi: columnMatches.roi.index,
  };

  // Log detected columns
  console.log('[Ads Import] Detected columns:', {
    date: columnMatches.date.matchedVariant || 'NOT FOUND',
    spend: columnMatches.spend.matchedVariant || 'NOT FOUND',
    orders: columnMatches.orders.matchedVariant || 'NOT FOUND',
    revenue: columnMatches.revenue.matchedVariant || 'NOT FOUND',
    roi: columnMatches.roi.matchedVariant || 'NOT FOUND',
  });

  // Validate required columns
  const missingColumns: string[] = [];
  if (columnIndexes.date === -1) missingColumns.push('Date');
  if (columnIndexes.spend === -1) missingColumns.push('Cost/Spend');
  if (columnIndexes.orders === -1) missingColumns.push('Orders/Conversions');
  if (columnIndexes.revenue === -1) missingColumns.push('Revenue/GMV');

  if (missingColumns.length > 0) {
    throw new AdsImportError(
      `ไม่พบ columns ที่จำเป็น: ${missingColumns.join(', ')}`,
      'MISSING_REQUIRED_COLUMNS',
      {
        sheetName,
        headers,
        missingColumns,
        suggestion: `ตรวจสอบว่าไฟล์มี columns: ${missingColumns.join(', ')}`,
      }
    );
  }

  // Parse data rows
  const rows: NormalizedAdRow[] = [];
  let skippedRows = 0;
  let invalidDates = 0;

  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) {
      skippedRows++;
      continue;
    }

    const dateValue = row[columnIndexes.date];
    const adDate = parseDate(dateValue);

    if (!adDate) {
      invalidDates++;
      warnings.push(`Row ${i + 1}: Invalid or missing date "${dateValue}", skipping`);
      continue;
    }

    const spend = columnIndexes.spend !== -1 ? parseNumeric(row[columnIndexes.spend]) : 0;
    const orders = columnIndexes.orders !== -1 ? parseNumeric(row[columnIndexes.orders]) : 0;
    const revenue = columnIndexes.revenue !== -1 ? parseNumeric(row[columnIndexes.revenue]) : 0;
    let roi = columnIndexes.roi !== -1 ? parseNumeric(row[columnIndexes.roi]) : null;

    // Calculate ROI if not provided and spend > 0
    if (roi === null && spend > 0) {
      roi = revenue / spend;
    }

    const normalizedRow: NormalizedAdRow = {
      ad_date: adDate,
      campaign_type: campaignType.type,
      campaign_name:
        columnIndexes.campaign_name !== -1 && row[columnIndexes.campaign_name]
          ? String(row[columnIndexes.campaign_name]).trim()
          : null,
      spend,
      orders: Math.floor(orders), // Ensure integer
      revenue,
      roi,
    };

    rows.push(normalizedRow);
  }

  console.log('[Ads Import] Parse summary:', {
    totalRows: data.length - headerRowIndex - 1,
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

  return { rows, warnings };
}

/**
 * Preview ads file without inserting to database
 * Returns summary and sample rows for user confirmation
 */
export function previewAdsExcel(buffer: Buffer, fileName: string): AdPreviewResult {
  try {
    const { rows, warnings } = parseAdsExcel(buffer);

    if (rows.length === 0) {
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

    // Calculate summary
    const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
    const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
    const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const avgROI = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    // Get date range
    const dates = rows
      .map((r) => r.ad_date.toISOString().split('T')[0])
      .sort();
    const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown';

    // Get sample rows (first 5)
    const sampleRows = rows.slice(0, 5).map((row) => ({
      date: row.ad_date.toISOString().split('T')[0],
      campaignName: row.campaign_name,
      spend: row.spend,
      orders: row.orders,
      revenue: row.revenue,
      roi: row.roi,
    }));

    // Get detected column names
    const columnMappings =
      bestSheet.campaignType.type === 'live' ? LIVE_CAMPAIGN_COLUMNS : PRODUCT_CAMPAIGN_COLUMNS;
    const columnMatches = {
      date: findColumn(bestSheet.headers, columnMappings.date),
      campaign_name: findColumn(bestSheet.headers, columnMappings.campaign_name),
      spend: findColumn(bestSheet.headers, columnMappings.spend),
      orders: findColumn(bestSheet.headers, columnMappings.orders),
      revenue: findColumn(bestSheet.headers, columnMappings.revenue),
      roi: findColumn(bestSheet.headers, columnMappings.roi),
    };

    const detectedColumns = {
      date: columnMatches.date.matchedVariant || 'NOT FOUND',
      campaign: columnMatches.campaign_name.matchedVariant || 'NOT FOUND',
      spend: columnMatches.spend.matchedVariant || 'NOT FOUND',
      orders: columnMatches.orders.matchedVariant || 'NOT FOUND',
      revenue: columnMatches.revenue.matchedVariant || 'NOT FOUND',
      roi: columnMatches.roi.matchedVariant || 'NOT FOUND',
    };

    return {
      success: true,
      summary: {
        fileName,
        sheetName: bestSheet.sheetName,
        campaignType: bestSheet.campaignType.type,
        campaignTypeConfidence: bestSheet.campaignType.confidence,
        dateRange,
        totalRows: rows.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalOrders: Math.round(totalOrders),
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        avgROI: Math.round(avgROI * 100) / 100,
      },
      sampleRows,
      warnings,
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
      // Check if exists
      const { data: existing } = await supabase
        .from('ad_daily_performance')
        .select('id')
        .eq('marketplace', 'tiktok')
        .eq('ad_date', row.ad_date.toISOString().split('T')[0])
        .eq('campaign_type', row.campaign_type || 'product')
        .eq('campaign_name', row.campaign_name || '')
        .eq('created_by', userId)
        .single();

      const dataToUpsert = {
        marketplace: 'tiktok',
        ad_date: row.ad_date.toISOString().split('T')[0],
        campaign_type: row.campaign_type,
        campaign_name: row.campaign_name,
        spend: row.spend,
        orders: row.orders,
        revenue: row.revenue,
        roi: row.roi,
        source: 'imported',
        import_batch_id: batchId,
        created_by: userId,
      };

      const { error } = await supabase
        .from('ad_daily_performance')
        .upsert(dataToUpsert, {
          onConflict: 'marketplace,ad_date,campaign_type,campaign_name,created_by',
        });

      if (error) {
        errorCount++;
        errors.push(`Ad record ${row.ad_date.toISOString().split('T')[0]}: ${error.message}`);
      } else {
        if (existing) {
          updatedCount++;
        } else {
          insertedCount++;
        }
      }
    } catch (err) {
      errorCount++;
      errors.push(
        `Ad record ${row.ad_date.toISOString().split('T')[0]}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return { insertedCount, updatedCount, errorCount, errors };
}
