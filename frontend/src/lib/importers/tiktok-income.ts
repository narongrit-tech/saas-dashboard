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
 * Parse Excel buffer and normalize rows
 */
export function parseIncomeExcel(buffer: Buffer): {
  rows: NormalizedIncomeRow[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Try to find "Order details" sheet first, otherwise use first sheet
  let sheetName = workbook.SheetNames.find(
    (name) => name.toLowerCase().includes('order') || name.toLowerCase().includes('detail')
  );

  if (!sheetName) {
    sheetName = workbook.SheetNames[0];
  }

  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (data.length < 2) {
    throw new Error('Excel file is empty or has no data rows');
  }

  // Find header row (first row with required columns)
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    if (Array.isArray(row) && row.length > 0) {
      const hasRequiredColumn = findColumn(
        row.map(String),
        COLUMN_MAPPINGS.txn_id
      );
      if (hasRequiredColumn !== -1) {
        headerRowIndex = i;
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find header row with required columns (Order/adjustment ID)');
  }

  const headers = data[headerRowIndex].map(String);
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

  // Parse data rows
  const rows: NormalizedIncomeRow[] = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const txnId = row[columnIndexes.txn_id];
    if (!txnId || String(txnId).trim() === '') {
      warnings.push(`Row ${i + 1}: Missing transaction ID, skipping`);
      continue;
    }

    const settlementAmount = parseNumeric(row[columnIndexes.settlement_amount]);
    if (settlementAmount === null) {
      warnings.push(`Row ${i + 1}: Missing or invalid settlement amount, skipping`);
      continue;
    }

    // Sum all fee columns
    let feesTotal: number | null = null;
    if (feeColumnIndexes.length > 0) {
      let sum = 0;
      let hasAnyFee = false;
      for (const feeIdx of feeColumnIndexes) {
        const feeVal = parseNumeric(row[feeIdx]);
        if (feeVal !== null) {
          sum += feeVal;
          hasAnyFee = true;
        }
      }
      feesTotal = hasAnyFee ? sum : null;
    }

    const normalizedRow: NormalizedIncomeRow = {
      txn_id: String(txnId).trim(),
      order_id:
        columnIndexes.order_id !== -1 && row[columnIndexes.order_id]
          ? String(row[columnIndexes.order_id]).trim()
          : null,
      type:
        columnIndexes.type !== -1 && row[columnIndexes.type]
          ? String(row[columnIndexes.type]).trim()
          : null,
      currency:
        columnIndexes.currency !== -1 && row[columnIndexes.currency]
          ? String(row[columnIndexes.currency]).trim().toUpperCase()
          : 'THB',
      settled_time:
        columnIndexes.settled_time !== -1
          ? parseDate(row[columnIndexes.settled_time])
          : null,
      settlement_amount: settlementAmount,
      gross_revenue:
        columnIndexes.gross_revenue !== -1
          ? parseNumeric(row[columnIndexes.gross_revenue])
          : null,
      fees_total: feesTotal,
    };

    rows.push(normalizedRow);
  }

  return { rows, warnings };
}

/**
 * Upsert rows into settlement_transactions table
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
  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      // Check if exists
      const { data: existing } = await supabase
        .from('settlement_transactions')
        .select('id')
        .eq('marketplace', 'tiktok')
        .eq('txn_id', row.txn_id)
        .eq('created_by', userId)
        .single();

      const dataToUpsert = {
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
      };

      const { error } = await supabase
        .from('settlement_transactions')
        .upsert(dataToUpsert, {
          onConflict: 'marketplace,txn_id,created_by',
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
