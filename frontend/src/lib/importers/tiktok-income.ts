import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import crypto from 'crypto';

const BANGKOK_TZ = 'Asia/Bangkok';

// Column mapping for TikTok Income/Settlement Excel files (case-insensitive)
const COLUMN_MAPPINGS: Record<string, string[]> = {
  txn_id: ['order/adjustment id', 'transaction id', 'adjustment id'],
  order_id: ['order id'],
  type: ['type'],
  settled_time: ['order settled time', 'settled time', 'settlement time'],
  settlement_amount: [
    'total settlement amount',
    'settlement amount',
    'total amount',
  ],
  gross_revenue: ['total revenue', 'gross revenue', 'revenue'],
  currency: ['currency'],
  // Optional fee columns - will be summed if found
  fees: [
    'platform fee',
    'payment processing fee',
    'transaction fee',
    'commission',
    'fee',
  ],
};

export interface NormalizedIncomeRow {
  txn_id: string;
  order_id: string | null;
  type: string | null;
  currency: string;
  settled_time: Date | null;
  settlement_amount: number;
  gross_revenue: number | null;
  fees_total: number | null;
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
 * Find all columns matching fee patterns
 */
function findFeeColumns(headers: string[]): number[] {
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());
  const feeIndexes: number[] = [];

  normalizedHeaders.forEach((header, index) => {
    if (
      header.includes('fee') ||
      header.includes('commission') ||
      header.includes('charge')
    ) {
      feeIndexes.push(index);
    }
  });

  return feeIndexes;
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
export function parseIncomeExcel(buffer: Buffer): {
  rows: NormalizedIncomeRow[];
  warnings: string[];
} {
  const warnings: string[] = [];

  console.log(`[Income Parser] ========== PARSE START ==========`);
  console.log(`[Income Parser] Buffer size: ${buffer.length} bytes`);
  console.log(`[Income Parser] Buffer first 10 bytes: ${buffer.slice(0, 10).toString('hex')}`);

  // CRITICAL: sheetRows MUST be 0 to load ALL rows
  // Force fresh parse by cloning buffer internally
  const bufferCopy = Buffer.alloc(buffer.length);
  buffer.copy(bufferCopy);

  console.log(`[Income Parser] Buffer cloned for parsing`);

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

  console.log(`[Income Parser] Workbook loaded successfully`);
  console.log(`[Income Parser] Total sheets: ${workbook.SheetNames.length}`);
  console.log(`[Income Parser] Available sheets: ${workbook.SheetNames.join(', ')}`);

  // Explicitly select "Order details" sheet first, fallback to first sheet
  let sheetName = workbook.SheetNames.find(
    (name) => name.toLowerCase().includes('order') || name.toLowerCase().includes('detail')
  );

  if (!sheetName) {
    sheetName = workbook.SheetNames[0];
  }

  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  console.log(`[Income Parser] Using sheet: "${sheetName}"`);

  const worksheet = workbook.Sheets[sheetName];

  // Get sheet range
  const sheetRef = worksheet['!ref'];
  console.log(`[Income Parser] Worksheet loaded`);
  console.log(`[Income Parser] Original !ref: ${sheetRef}`);

  // CRITICAL FIX: !ref may be incorrect for some TikTok files
  // Manually scan worksheet object to find actual last row
  let actualEndRow = 1; // Start from 1 (after header at 0)
  let actualEndCol = 60; // Default to 60 columns (BI = 61st column, index 60)

  if (sheetRef) {
    const declaredRange = XLSX.utils.decode_range(sheetRef);
    actualEndCol = declaredRange.e.c;
    console.log(`[Income Parser] Declared range: rows=${declaredRange.e.r + 1}, cols=${declaredRange.e.c + 1}`);
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

  console.log(`[Income Parser] Actual scanned range: rows 0 to ${endRow} (${endRow + 1} total), cols 0 to ${endCol}`);

  // CRITICAL CHECK: If endRow suspiciously small after manual scan, log warning (but continue)
  if (endRow < 10) {
    console.warn(`[Income Parser] WARNING: endRow is only ${endRow}!`);
    console.warn(`[Income Parser] Buffer length: ${buffer.length} bytes`);
    console.warn(`[Income Parser] This may indicate an empty or header-only file`);
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
      console.log(`[Income Parser] Header detected at row ${r + 1} (0-indexed: ${r})`);
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
    order_id: findColumn(headers, COLUMN_MAPPINGS.order_id),
    type: findColumn(headers, COLUMN_MAPPINGS.type),
    settled_time: findColumn(headers, COLUMN_MAPPINGS.settled_time),
    settlement_amount: findColumn(headers, COLUMN_MAPPINGS.settlement_amount),
    gross_revenue: findColumn(headers, COLUMN_MAPPINGS.gross_revenue),
    currency: findColumn(headers, COLUMN_MAPPINGS.currency),
  };

  const feeColumnIndexes = findFeeColumns(headers);

  // Validate required columns
  if (columnIndexes.txn_id === -1) {
    throw new Error('Required column "Order/adjustment ID" not found');
  }
  if (columnIndexes.settlement_amount === -1) {
    throw new Error('Required column "Total settlement amount" not found');
  }

  console.log(`[Income Parser] Column indexes:`, columnIndexes);
  console.log(`[Income Parser] Fee columns found: ${feeColumnIndexes.length}`);
  console.log(`[Income Parser] Data starts at row ${headerRowIndex + 2} (Excel row number)`);

  // Parse data rows (from header+1 to endRow)
  const rows: NormalizedIncomeRow[] = [];
  for (let r = headerRowIndex + 1; r <= endRow; r++) {
    const txnIdStr = getCellValue(worksheet, r, columnIndexes.txn_id);

    // Skip empty rows (but don't break - continue to next row)
    if (!txnIdStr || txnIdStr === '') {
      continue;
    }

    const settlementAmountStr = getCellValue(worksheet, r, columnIndexes.settlement_amount);
    const settlementAmount = parseNumeric(settlementAmountStr);

    if (settlementAmount === null) {
      warnings.push(`Row ${r + 1}: Missing or invalid settlement amount, skipping`);
      continue;
    }

    // Sum all fee columns
    let feesTotal: number | null = null;
    if (feeColumnIndexes.length > 0) {
      let sum = 0;
      let hasAnyFee = false;
      for (const feeIdx of feeColumnIndexes) {
        const feeVal = parseNumeric(getCellValue(worksheet, r, feeIdx));
        if (feeVal !== null) {
          sum += feeVal;
          hasAnyFee = true;
        }
      }
      feesTotal = hasAnyFee ? sum : null;
    }

    const normalizedRow: NormalizedIncomeRow = {
      txn_id: txnIdStr,
      order_id:
        columnIndexes.order_id !== -1
          ? getCellValue(worksheet, r, columnIndexes.order_id) || null
          : null,
      type:
        columnIndexes.type !== -1
          ? getCellValue(worksheet, r, columnIndexes.type) || null
          : null,
      currency:
        columnIndexes.currency !== -1
          ? getCellValue(worksheet, r, columnIndexes.currency).toUpperCase() || 'THB'
          : 'THB',
      settled_time:
        columnIndexes.settled_time !== -1
          ? parseDate(getCellValue(worksheet, r, columnIndexes.settled_time))
          : null,
      settlement_amount: settlementAmount,
      gross_revenue:
        columnIndexes.gross_revenue !== -1
          ? parseNumeric(getCellValue(worksheet, r, columnIndexes.gross_revenue))
          : null,
      fees_total: feesTotal,
    };

    rows.push(normalizedRow);
  }

  console.log(`[Income Parser] ========== PARSE COMPLETE ==========`);
  console.log(`[Income Parser] Total rows parsed: ${rows.length}`);
  console.log(`[Income Parser] First 3 IDs:`, rows.slice(0, 3).map(r => r.txn_id));
  console.log(`[Income Parser] Last 3 IDs:`, rows.slice(-3).map(r => r.txn_id));

  return { rows, warnings };
}

/**
 * Upsert rows into settlement_transactions table (BULK OPERATION)
 */
export async function upsertIncomeRows(
  rows: NormalizedIncomeRow[],
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
  console.log(`[Income Upsert] Deduplicating ${rows.length} rows...`);
  const uniqueMap = new Map<string, NormalizedIncomeRow>();
  let duplicateCount = 0;
  for (const row of rows) {
    if (uniqueMap.has(row.txn_id)) {
      duplicateCount++;
    }
    uniqueMap.set(row.txn_id, row); // Overwrite with latest
  }
  const uniqueRows = Array.from(uniqueMap.values());
  console.log(`[Income Upsert] After dedup: ${uniqueRows.length} unique rows (${duplicateCount} duplicates removed)`);

  // Get existing transaction IDs for this user (single query)
  console.log(`[Income Upsert] Checking existing transactions...`);
  const txnIds = uniqueRows.map((r) => r.txn_id);
  const { data: existingTxns } = await supabase
    .from('settlement_transactions')
    .select('txn_id')
    .eq('marketplace', 'tiktok')
    .eq('created_by', userId)
    .in('txn_id', txnIds);

  const existingSet = new Set((existingTxns || []).map((t) => t.txn_id));
  const expectedInsertCount = uniqueRows.length - existingSet.size;
  const expectedUpdateCount = existingSet.size;

  console.log(`[Income Upsert] Existing: ${existingSet.size}, New: ${expectedInsertCount}`);

  // Prepare bulk data
  const dataToUpsert = uniqueRows.map((row) => ({
    marketplace: 'tiktok',
    txn_id: row.txn_id,
    order_id: row.order_id,
    type: row.type,
    currency: row.currency,
    settled_time: row.settled_time,
    settlement_amount: row.settlement_amount,
    gross_revenue: row.gross_revenue,
    fees_total: row.fees_total,
    import_batch_id: batchId,
    source: 'imported',
    created_by: userId,
  }));

  // Bulk upsert (single query for all rows)
  console.log(`[Income Upsert] Bulk upserting ${uniqueRows.length} rows...`);
  const { error, count } = await supabase
    .from('settlement_transactions')
    .upsert(dataToUpsert, {
      onConflict: 'marketplace,txn_id,created_by',
      count: 'exact',
    });

  if (error) {
    console.error(`[Income Upsert] Bulk upsert failed:`, error);
    errors.push(`Bulk upsert failed: ${error.message}`);
    return {
      insertedCount: 0,
      updatedCount: 0,
      errorCount: uniqueRows.length,
      errors,
    };
  }

  console.log(`[Income Upsert] Bulk upsert complete. Count: ${count}`);

  return {
    insertedCount: expectedInsertCount,
    updatedCount: expectedUpdateCount,
    errorCount: 0,
    errors: [],
  };
}
