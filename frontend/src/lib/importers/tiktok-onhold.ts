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
    cellFormula: false,
    cellStyles: false,
    bookVBA: false, // Skip VBA
    bookImages: false, // Skip images
    sheetRows: 0, // 0 = unlimited rows
    cellDates: true,
    raw: false, // Keep as string to prevent precision loss
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

  // Force re-decode to ensure range is correct
  if (sheetRef) {
    const testRange = XLSX.utils.decode_range(sheetRef);
    console.log(`[Onhold Parser] Range validation: rows=${testRange.e.r + 1}, cols=${testRange.e.c + 1}`);
  }

  if (!sheetRef) {
    throw new Error('Worksheet has no range reference (!ref is missing)');
  }

  const range = XLSX.utils.decode_range(sheetRef);
  const endRow = range.e.r; // Last row index
  const endCol = range.e.c; // Last column index

  console.log(`[Onhold Parser] Decoded range: rows ${range.s.r} to ${endRow} (${endRow + 1} total), cols ${range.s.c} to ${endCol}`);

  // CRITICAL CHECK: If endRow suspiciously small, abort!
  if (endRow < 10) {
    console.error(`[Onhold Parser] ERROR: endRow is only ${endRow}! Worksheet was truncated!`);
    console.error(`[Onhold Parser] Buffer length: ${buffer.length} bytes`);
    console.error(`[Onhold Parser] This indicates buffer was not fully read or XLSX truncated data`);
    throw new Error(`Worksheet appears truncated (only ${endRow + 1} rows). Expected hundreds of rows. Check file upload and buffer handling.`);
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
  };

  // Validate required columns
  if (columnIndexes.txn_id === -1) {
    throw new Error('Required column "Order/adjustment ID" not found');
  }

  console.log(`[Onhold Parser] Column indexes:`, columnIndexes);
  console.log(`[Onhold Parser] Data starts at row ${headerRowIndex + 2} (Excel row number)`);

  // Parse data rows (from header+1 to endRow)
  const rows: NormalizedOnholdRow[] = [];
  for (let r = headerRowIndex + 1; r <= endRow; r++) {
    const txnIdStr = getCellValue(worksheet, r, columnIndexes.txn_id);

    // Skip empty rows (but don't break - continue to next row)
    if (!txnIdStr || txnIdStr === '') {
      continue;
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
      estimated_settle_time:
        columnIndexes.estimated_settle_time !== -1
          ? parseDate(getCellValue(worksheet, r, columnIndexes.estimated_settle_time))
          : null,
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
  console.log(`[Onhold Parser] First 3 IDs:`, rows.slice(0, 3).map(r => r.txn_id));
  console.log(`[Onhold Parser] Last 3 IDs:`, rows.slice(-3).map(r => r.txn_id));

  return { rows, warnings };
}

/**
 * Upsert rows into unsettled_transactions table
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
  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      // Check if exists
      const { data: existing } = await supabase
        .from('unsettled_transactions')
        .select('id, status')
        .eq('marketplace', 'tiktok')
        .eq('txn_id', row.txn_id)
        .eq('created_by', userId)
        .single();

      const dataToUpsert = {
        marketplace: 'tiktok',
        txn_id: row.txn_id,
        related_order_id: row.related_order_id,
        type: row.type,
        currency: row.currency,
        estimated_settle_time: row.estimated_settle_time,
        estimated_settlement_amount: row.estimated_settlement_amount,
        unsettled_reason: row.unsettled_reason,
        import_batch_id: batchId,
        last_seen_at: new Date().toISOString(),
        created_by: userId,
        // Only update status to unsettled if not already settled
        status: existing && existing.status === 'settled' ? 'settled' : 'unsettled',
      };

      const { error } = await supabase
        .from('unsettled_transactions')
        .upsert(dataToUpsert, {
          onConflict: 'marketplace,txn_id',
        });

      if (error) {
        errorCount++;
        errors.push(`Transaction ${row.txn_id}: ${error.message}`);
      } else {
        if (existing) {
          updatedCount++;
        } else {
          insertedCount++;
        }
      }
    } catch (err) {
      errorCount++;
      errors.push(`Transaction ${row.txn_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { insertedCount, updatedCount, errorCount, errors };
}
