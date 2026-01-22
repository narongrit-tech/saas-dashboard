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
 * Parse Excel buffer and normalize rows
 */
export function parseOnholdExcel(buffer: Buffer): {
  rows: NormalizedOnholdRow[];
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
    throw new Error('Could not find header row with required columns');
  }

  const headers = data[headerRowIndex].map(String);
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

  // Parse data rows
  const rows: NormalizedOnholdRow[] = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const txnId = row[columnIndexes.txn_id];
    if (!txnId || String(txnId).trim() === '') {
      warnings.push(`Row ${i + 1}: Missing transaction ID, skipping`);
      continue;
    }

    const normalizedRow: NormalizedOnholdRow = {
      txn_id: String(txnId).trim(),
      related_order_id:
        columnIndexes.related_order_id !== -1 && row[columnIndexes.related_order_id]
          ? String(row[columnIndexes.related_order_id]).trim()
          : null,
      type:
        columnIndexes.type !== -1 && row[columnIndexes.type]
          ? String(row[columnIndexes.type]).trim()
          : null,
      currency:
        columnIndexes.currency !== -1 && row[columnIndexes.currency]
          ? String(row[columnIndexes.currency]).trim().toUpperCase()
          : 'THB',
      estimated_settle_time:
        columnIndexes.estimated_settle_time !== -1
          ? parseDate(row[columnIndexes.estimated_settle_time])
          : null,
      estimated_settlement_amount:
        columnIndexes.estimated_settlement_amount !== -1
          ? parseNumeric(row[columnIndexes.estimated_settlement_amount])
          : null,
      unsettled_reason:
        columnIndexes.unsettled_reason !== -1 && row[columnIndexes.unsettled_reason]
          ? String(row[columnIndexes.unsettled_reason]).trim()
          : null,
    };

    rows.push(normalizedRow);
  }

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
