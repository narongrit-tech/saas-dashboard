import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';
import crypto from 'crypto';

const BANGKOK_TZ = 'Asia/Bangkok';

// Column mappings for product campaigns (creative data)
const PRODUCT_CAMPAIGN_COLUMNS: Record<string, string[]> = {
  date: ['date', 'day', 'report date'],
  campaign_name: ['campaign name', 'campaign', 'creative name'],
  spend: ['cost', 'spend', 'total cost', 'ad spend'],
  orders: ['conversions', 'orders', 'total orders', 'order count'],
  revenue: ['revenue', 'gmv', 'sales', 'total revenue'],
  roi: ['roi', 'roas', 'return on ad spend'],
};

// Column mappings for live campaigns (livestream data)
const LIVE_CAMPAIGN_COLUMNS: Record<string, string[]> = {
  date: ['date', 'day', 'report date', 'live date'],
  campaign_name: ['live room name', 'room name', 'live name', 'campaign name'],
  spend: ['cost', 'spend', 'total cost', 'ad spend'],
  orders: ['conversions', 'orders', 'total orders', 'product order'],
  revenue: ['revenue', 'gmv', 'sales', 'total gmv'],
  roi: ['roi', 'roas'],
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

/**
 * Calculate SHA256 hash of file buffer
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Find column index by trying multiple name variants (case-insensitive)
 */
function findColumn(headers: string[], variants: string[]): number {
  const normalizedHeaders = headers.map((h) => String(h || '').toLowerCase().trim());
  for (const variant of variants) {
    const index = normalizedHeaders.indexOf(variant.toLowerCase());
    if (index !== -1) return index;
  }
  return -1;
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
 * Detect campaign type from sheet name and columns
 */
function detectCampaignType(sheetName: string, headers: string[]): 'product' | 'live' | null {
  const lowerSheetName = sheetName.toLowerCase();
  const lowerHeaders = headers.map((h) => String(h || '').toLowerCase());

  // Check sheet name for hints
  if (lowerSheetName.includes('live') || lowerSheetName.includes('livestream')) {
    return 'live';
  }
  if (lowerSheetName.includes('product') || lowerSheetName.includes('creative')) {
    return 'product';
  }

  // Check column names for hints
  const hasLiveColumns = lowerHeaders.some(
    (h) => h.includes('live') || h.includes('room')
  );
  const hasCreativeColumns = lowerHeaders.some(
    (h) => h.includes('creative') || h.includes('ad group')
  );

  if (hasLiveColumns) return 'live';
  if (hasCreativeColumns) return 'product';

  // Default to product if unclear
  return 'product';
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

  // Use first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (data.length < 2) {
    throw new Error('Excel file is empty or has no data rows');
  }

  // Find header row
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (Array.isArray(row) && row.length > 3) {
      const headers = row.map((v) => String(v || ''));
      const hasDateColumn =
        findColumn(headers, PRODUCT_CAMPAIGN_COLUMNS.date) !== -1 ||
        findColumn(headers, LIVE_CAMPAIGN_COLUMNS.date) !== -1;
      if (hasDateColumn) {
        headerRowIndex = i;
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find header row with required columns');
  }

  const headers = data[headerRowIndex].map((v) => String(v || ''));
  const campaignType = detectCampaignType(sheetName, headers);
  const columnMappings =
    campaignType === 'live' ? LIVE_CAMPAIGN_COLUMNS : PRODUCT_CAMPAIGN_COLUMNS;

  const columnIndexes = {
    date: findColumn(headers, columnMappings.date),
    campaign_name: findColumn(headers, columnMappings.campaign_name),
    spend: findColumn(headers, columnMappings.spend),
    orders: findColumn(headers, columnMappings.orders),
    revenue: findColumn(headers, columnMappings.revenue),
    roi: findColumn(headers, columnMappings.roi),
  };

  // Validate required columns
  if (columnIndexes.date === -1) {
    throw new Error('Required column "Date" not found');
  }

  // Parse data rows
  const rows: NormalizedAdRow[] = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const dateValue = row[columnIndexes.date];
    const adDate = parseDate(dateValue);

    if (!adDate) {
      warnings.push(`Row ${i + 1}: Invalid or missing date, skipping`);
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
      campaign_type: campaignType,
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

  return { rows, warnings };
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
