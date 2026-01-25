import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import crypto from 'crypto';

const BANGKOK_TZ = 'Asia/Bangkok';

// Column mapping for TikTok Onhold Excel files (case-insensitive)
const COLUMN_MAPPINGS: Record<string, string[]> = {
  txn_id: ['order/adjustment id', 'order id', 'adjustment id', 'transaction id'],
  related_order_id: ['related order id', 'order id'],
  type: ['type'],
  estimated_settle_time: ['estimated settle time', 'settle time', 'estimated settlement time'],
  estimated_settlement_amount: [
    'total estimated settlement amount',
    'settlement amount',
    'estimated amount',
    'amount',
  ],
  unsettled_reason: ['unsettled reason', 'reason'],
  currency: ['currency'],
  order_created_date: ['order created time', 'created time', 'order create time'],
  order_deliver_date: ['order delivered time', 'delivered time', 'deliver time'],
};

export interface NormalizedOnholdRow {
  txn_id: string;
  related_order_id: string | null;
  type: string | null;
  currency: string;
  estimated_settle_time: Date | null;
  estimated_settlement_amount: number | null;
  unsettled_reason: string | null;
}

export interface ImportResult {
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
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const variant of variants) {
    const index = normalizedHeaders.indexOf(variant.toLowerCase());
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Safe parse numeric value
 */
function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

/**
 * Safe parse date value (handles Excel dates and string dates)
 */
function parseDate(value: unknown): Date | null {
  if (!value) return null;

  // Excel serial date number
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ);
  }

  // String date
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return fromZonedTime(toZonedTime(date, BANGKOK_TZ), BANGKOK_TZ);
    }
  }

  return null;
}

/**
 * Parse estimated settle time with fallback logic
 * Handles:
 * - Direct dates (Excel number or string)
 * - "Delivered + N days" format
 * - Fallback to order_created_date + 3 days
 */
function parseEstimatedSettleTime(
  estimatedSettleValue: string,
  orderCreatedDate: Date | null,
  orderDeliverDate: Date | null
): Date | null {
  // Try parsing as direct date first
  const directDate = parseDate(estimatedSettleValue);
  if (directDate) {
    return directDate;
  }

  // Try parsing "Delivered + N days" format
  if (typeof estimatedSettleValue === 'string' && estimatedSettleValue.toLowerCase().includes('delivered')) {
    const match = estimatedSettleValue.match(/delivered\s*\+\s*(\d+)\s*days?/i);
    if (match) {
      const daysToAdd = parseInt(match[1], 10);
      const baseDate = orderDeliverDate || orderCreatedDate;
      if (baseDate) {
        const estimated = new Date(baseDate);
        estimated.setDate(estimated.getDate() + daysToAdd);
        return estimated;
      }
    }
  }

  // Fallback: order_created_date + 3 days
  if (orderCreatedDate) {
    const fallback = new Date(orderCreatedDate);
    fallback.setDate(fallback.getDate() + 3);
    return fallback;
  }

  return null;
}

/**
 * Get cell value as string (direct cell access)
 */
function getCellValue(worksheet: XLSX.WorkSheet, row: number, col: number): string {
  const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = worksheet[cellAddress];

  if (!cell) return '';

  // Get raw value to prevent precision loss
  if (cell.w) {
    return String(cell.w).trim(); // Formatted value
  }
  if (cell.v !== null && cell.v !== undefined) {
    return String(cell.v).trim(); // Raw value
  }

  return '';
}

/**
 * Parse Excel buffer and normalize rows (robust cell-by-cell parsing)
 */
export function parseOnholdExcel(buffer: Buffer): {
  rows: NormalizedOnholdRow[];
  warnings: string[];
} {
  const warnings: string[] = [];

  console.log(`[Onhold Parser] ========== PARSE START ==========`);
  console.log(`[Onhold Parser] Buffer size: ${buffer.length} bytes`);
  console.log(`[Onhold Parser] Buffer first 10 bytes: ${buffer.slice(0, 10).toString('hex')}`);

  // CRITICAL: sheetRows MUST be 0 to load ALL rows
  // Force fresh parse by cloning buffer internally
  const bufferCopy = Buffer.alloc(buffer.length);
  buffer.copy(bufferCopy);

  console.log(`[Onhold Parser] Buffer cloned for parsing`);

  const workbook = XLSX.read(bufferCopy, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellStyles: false,
    raw: false, // Keep as string to prevent precision loss
    dense: false, // Force full range
    // NOTE: NOT using sheetRows (would limit range)
    // NOTE: NOT using bookVBA/bookImages (may cause range truncation)
  });

  console.log(`[Onhold Parser] Workbook loaded successfully`);
  console.log(`[Onhold Parser] Total sheets: ${workbook.SheetNames.length}`);

  // Use first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  console.log(`[Onhold Parser] Sheet name: "${sheetName}"`);

  const worksheet = workbook.Sheets[sheetName];

  // Get sheet range
  const sheetRef = worksheet['!ref'];
  console.log(`[Onhold Parser] Worksheet loaded`);
  console.log(`[Onhold Parser] Original !ref: ${sheetRef}`);

  // CRITICAL FIX: !ref may be incorrect for some TikTok files
  // Manually scan worksheet object to find actual last row
  let actualEndRow = 1; // Start from 1 (after header at 0)
  let actualEndCol = 60; // Default to 60 columns

  if (sheetRef) {
    const declaredRange = XLSX.utils.decode_range(sheetRef);
    actualEndCol = declaredRange.e.c;
    console.log(`[Onhold Parser] Declared range: rows=${declaredRange.e.r + 1}, cols=${declaredRange.e.c + 1}`);
  }

  // Scan worksheet keys to find actual max row
  const cellAddressPattern = /^([A-Z]+)(\d+)$/;
  for (const key of Object.keys(worksheet)) {
    if (key.startsWith('!')) continue; // Skip metadata keys
    const match = key.match(cellAddressPattern);
    if (match) {
      const rowNum = parseInt(match[2], 10) - 1; // Convert to 0-indexed
      if (rowNum > actualEndRow) {
        actualEndRow = rowNum;
      }
    }
  }

  const endRow = actualEndRow;
  const endCol = actualEndCol;

  console.log(`[Onhold Parser] Actual scanned range: rows 0 to ${endRow} (${endRow + 1} total), cols 0 to ${endCol}`);

  // CRITICAL CHECK: If endRow suspiciously small after manual scan, log warning (but continue)
  if (endRow < 10) {
    console.warn(`[Onhold Parser] WARNING: endRow is only ${endRow}!`);
    console.warn(`[Onhold Parser] Buffer length: ${buffer.length} bytes`);
    console.warn(`[Onhold Parser] This may indicate an empty or header-only file`);
  }

  // Find header row by scanning first 30 rows
  let headerRowIndex = -1;
  for (let r = 0; r < Math.min(30, endRow + 1); r++) {
    const headerCandidates: string[] = [];
    for (let c = 0; c <= endCol; c++) {
      headerCandidates.push(getCellValue(worksheet, r, c));
    }

    const hasRequiredColumn = findColumn(headerCandidates, COLUMN_MAPPINGS.txn_id);
    if (hasRequiredColumn !== -1) {
      headerRowIndex = r;
      console.log(`[Onhold Parser] Header detected at row ${r + 1} (0-indexed: ${r})`);
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find header row with required columns (scanned first 30 rows)');
  }

  // Build header map
  const headers: string[] = [];
  for (let c = 0; c <= endCol; c++) {
    headers.push(getCellValue(worksheet, headerRowIndex, c));
  }

  const columnIndexes = {
    txn_id: findColumn(headers, COLUMN_MAPPINGS.txn_id),
    related_order_id: findColumn(headers, COLUMN_MAPPINGS.related_order_id),
    type: findColumn(headers, COLUMN_MAPPINGS.type),
    estimated_settle_time: findColumn(headers, COLUMN_MAPPINGS.estimated_settle_time),
    estimated_settlement_amount: findColumn(headers, COLUMN_MAPPINGS.estimated_settlement_amount),
    unsettled_reason: findColumn(headers, COLUMN_MAPPINGS.unsettled_reason),
    currency: findColumn(headers, COLUMN_MAPPINGS.currency),
    order_created_date: findColumn(headers, COLUMN_MAPPINGS.order_created_date),
    order_deliver_date: findColumn(headers, COLUMN_MAPPINGS.order_deliver_date),
  };

  // Validate required columns
  if (columnIndexes.txn_id === -1) {
    throw new Error('Required column "Order/adjustment ID" not found');
  }

  console.log(`[Onhold Parser] Column indexes:`, columnIndexes);
  console.log(`[Onhold Parser] Data starts at row ${headerRowIndex + 2} (Excel row number)`);

  // Parse data rows (from header+1 to endRow)
  const rows: NormalizedOnholdRow[] = [];
  let nullEstimatedCount = 0;

  for (let r = headerRowIndex + 1; r <= endRow; r++) {
    const txnIdStr = getCellValue(worksheet, r, columnIndexes.txn_id);

    // Skip empty rows (but don't break - continue to next row)
    if (!txnIdStr || txnIdStr === '') {
      continue;
    }

    // Parse date fields for fallback logic
    const orderCreatedDate =
      columnIndexes.order_created_date !== -1
        ? parseDate(getCellValue(worksheet, r, columnIndexes.order_created_date))
        : null;

    const orderDeliverDate =
      columnIndexes.order_deliver_date !== -1
        ? parseDate(getCellValue(worksheet, r, columnIndexes.order_deliver_date))
        : null;

    // Parse estimated_settle_time with fallback
    const estimatedSettleValue = getCellValue(worksheet, r, columnIndexes.estimated_settle_time);
    const estimatedSettleTime = parseEstimatedSettleTime(
      estimatedSettleValue,
      orderCreatedDate,
      orderDeliverDate
    );

    if (!estimatedSettleTime) {
      nullEstimatedCount++;
    }

    const normalizedRow: NormalizedOnholdRow = {
      txn_id: txnIdStr,
      related_order_id:
        columnIndexes.related_order_id !== -1
          ? getCellValue(worksheet, r, columnIndexes.related_order_id) || null
          : null,
      type:
        columnIndexes.type !== -1
          ? getCellValue(worksheet, r, columnIndexes.type) || null
          : null,
      currency:
        columnIndexes.currency !== -1
          ? getCellValue(worksheet, r, columnIndexes.currency).toUpperCase() || 'THB'
          : 'THB',
      estimated_settle_time: estimatedSettleTime,
      estimated_settlement_amount:
        columnIndexes.estimated_settlement_amount !== -1
          ? parseNumeric(getCellValue(worksheet, r, columnIndexes.estimated_settlement_amount))
          : null,
      unsettled_reason:
        columnIndexes.unsettled_reason !== -1
          ? getCellValue(worksheet, r, columnIndexes.unsettled_reason) || null
          : null,
    };

    rows.push(normalizedRow);
  }

  console.log(`[Onhold Parser] ========== PARSE COMPLETE ==========`);
  console.log(`[Onhold Parser] Total rows parsed: ${rows.length}`);
  console.log(`[Onhold Parser] estimated_settle_time NULL count: ${nullEstimatedCount} (${((nullEstimatedCount / rows.length) * 100).toFixed(1)}%)`);
  console.log(`[Onhold Parser] First 3 IDs:`, rows.slice(0, 3).map(r => r.txn_id));
  console.log(`[Onhold Parser] Last 3 IDs:`, rows.slice(-3).map(r => r.txn_id));
  console.log(
    `[Onhold Parser] First 3 estimated_settle_time:`,
    rows.slice(0, 3).map((r) => r.estimated_settle_time?.toISOString() || 'NULL')
  );

  return { rows, warnings };
}

/**
 * Upsert rows into unsettled_transactions table (BULK OPERATION)
 */
export async function upsertOnholdRows(
  rows: NormalizedOnholdRow[],
  batchId: string,
  userId: string
): Promise<{
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  errors: string[];
}> {
  const supabase = await createClient();
  const errors: string[] = [];

  // Deduplicate rows by txn_id (keep last occurrence)
  console.log(`[Onhold Upsert] Deduplicating ${rows.length} rows...`);
  const uniqueMap = new Map<string, NormalizedOnholdRow>();
  let duplicateCount = 0;
  for (const row of rows) {
    if (uniqueMap.has(row.txn_id)) {
      duplicateCount++;
    }
    uniqueMap.set(row.txn_id, row); // Overwrite with latest
  }
  const uniqueRows = Array.from(uniqueMap.values());
  console.log(`[Onhold Upsert] After dedup: ${uniqueRows.length} unique rows (${duplicateCount} duplicates removed)`);

  // Get existing transactions with status (single query)
  console.log(`[Onhold Upsert] Checking existing transactions...`);
  const txnIds = uniqueRows.map((r) => r.txn_id);
  const { data: existingTxns } = await supabase
    .from('unsettled_transactions')
    .select('txn_id, status')
    .eq('marketplace', 'tiktok')
    .eq('created_by', userId)
    .in('txn_id', txnIds);

  const existingMap = new Map((existingTxns || []).map((t) => [t.txn_id, t.status]));
  const expectedInsertCount = uniqueRows.length - existingMap.size;
  const expectedUpdateCount = existingMap.size;

  console.log(`[Onhold Upsert] Existing: ${existingMap.size}, New: ${expectedInsertCount}`);

  // Prepare bulk data
  const now = new Date().toISOString();
  const dataToUpsert = uniqueRows.map((row) => {
    const existingStatus = existingMap.get(row.txn_id);
    return {
      marketplace: 'tiktok',
      txn_id: row.txn_id,
      related_order_id: row.related_order_id,
      type: row.type,
      currency: row.currency,
      estimated_settle_time: row.estimated_settle_time,
      estimated_settlement_amount: row.estimated_settlement_amount,
      unsettled_reason: row.unsettled_reason,
      import_batch_id: batchId,
      last_seen_at: now,
      created_by: userId,
      // Only update status to unsettled if not already settled
      status: existingStatus === 'settled' ? 'settled' : 'unsettled',
    };
  });

  // Bulk upsert (single query for all rows)
  console.log(`[Onhold Upsert] Bulk upserting ${uniqueRows.length} rows...`);
  const { error, count } = await supabase
    .from('unsettled_transactions')
    .upsert(dataToUpsert, {
      onConflict: 'marketplace,txn_id',
      count: 'exact',
    });

  if (error) {
    console.error(`[Onhold Upsert] Bulk upsert failed:`, error);
    errors.push(`Bulk upsert failed: ${error.message}`);
    return {
      insertedCount: 0,
      updatedCount: 0,
      errorCount: uniqueRows.length,
      errors,
    };
  }

  console.log(`[Onhold Upsert] Bulk upsert complete. Count: ${count}`);

  return {
    insertedCount: expectedInsertCount,
    updatedCount: expectedUpdateCount,
    errorCount: 0,
    errors: [],
  };
}
