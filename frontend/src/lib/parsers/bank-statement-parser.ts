// Bank Statement Parser
// Supports: KBIZ, K PLUS, and Generic formats
// Created: 2026-01-25

import * as XLSX from 'xlsx';
import { BankTransactionRow, BankColumnMapping } from '@/types/bank';
import { format, parse, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { detectHeaderRow } from './header-detector';

const BANGKOK_TZ = 'Asia/Bangkok';

// ============================================================================
// Auto-detect format and parse
// ============================================================================

export interface ParsedBankStatement {
  transactions: BankTransactionRow[];
  format_type: 'kbiz' | 'kplus' | 'generic' | 'unknown';
  detected_columns: string[];
  auto_mapping: BankColumnMapping | null;
  requires_manual_mapping: boolean;
  errors: string[];
  diagnostics?: ParseDiagnostics;
}

export function parseBankStatementAuto(
  buffer: ArrayBuffer,
  fileName: string
): ParsedBankStatement {
  const errors: string[] = [];

  try {
    // Detect file type
    const isCSV = fileName.toLowerCase().endsWith('.csv');
    const workbook = isCSV
      ? XLSX.read(buffer, { type: 'array', raw: true, codepage: 65001 }) // UTF-8
      : XLSX.read(buffer, { type: 'array', raw: true });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      errors.push('No worksheet found in file');
      return {
        transactions: [],
        format_type: 'unknown',
        detected_columns: [],
        auto_mapping: null,
        requires_manual_mapping: true,
        errors,
      };
    }

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    if (jsonData.length === 0) {
      errors.push('No data found in file');
      return {
        transactions: [],
        format_type: 'unknown',
        detected_columns: [],
        auto_mapping: null,
        requires_manual_mapping: true,
        errors,
      };
    }

    // ========================================================================
    // CRITICAL: Use header detection to handle files with metadata rows
    // (e.g., KBANK files have 3 meta rows before actual header)
    // ========================================================================
    const detection = detectHeaderRow(jsonData, 30);
    const headerRowIndex = detection.headerRowIndex ?? 0;
    const dataStartRowIndex = detection.dataStartRowIndex ?? 1;
    const headerRow = jsonData[headerRowIndex] as string[];
    const detectedColumns = detection.columns.length > 0 ? detection.columns : headerRow.filter(Boolean);

    // Try KBIZ format
    const kbizMapping = detectKBIZFormat(detectedColumns);
    if (kbizMapping) {
      const { transactions, diagnostics } = parseWithMappingDiagnostics(
        jsonData.slice(dataStartRowIndex), // Use detected data start row
        kbizMapping,
        headerRow
      );
      return {
        transactions,
        format_type: 'kbiz',
        detected_columns: detectedColumns,
        auto_mapping: kbizMapping,
        requires_manual_mapping: false,
        errors: transactions.length === 0 ? ['No valid transactions parsed'] : [],
        diagnostics,
      };
    }

    // Try K PLUS format
    const kplusMapping = detectKPLUSFormat(detectedColumns);
    if (kplusMapping) {
      const { transactions, diagnostics } = parseWithMappingDiagnostics(
        jsonData.slice(dataStartRowIndex), // Use detected data start row
        kplusMapping,
        headerRow
      );
      return {
        transactions,
        format_type: 'kplus',
        detected_columns: detectedColumns,
        auto_mapping: kplusMapping,
        requires_manual_mapping: false,
        errors: transactions.length === 0 ? ['No valid transactions parsed'] : [],
        diagnostics,
      };
    }

    // Try generic format
    const genericMapping = detectGenericFormat(detectedColumns);
    if (genericMapping) {
      const { transactions, diagnostics } = parseWithMappingDiagnostics(
        jsonData.slice(dataStartRowIndex), // Use detected data start row
        genericMapping,
        headerRow
      );
      return {
        transactions,
        format_type: 'generic',
        detected_columns: detectedColumns,
        auto_mapping: genericMapping,
        requires_manual_mapping: false,
        errors: transactions.length === 0 ? ['No valid transactions parsed'] : [],
        diagnostics,
      };
    }

    // Cannot auto-detect → requires manual mapping
    return {
      transactions: [],
      format_type: 'unknown',
      detected_columns: detectedColumns,
      auto_mapping: null,
      requires_manual_mapping: true,
      errors: ['Cannot auto-detect format. Please use manual column mapping.'],
    };
  } catch (error) {
    errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
    return {
      transactions: [],
      format_type: 'unknown',
      detected_columns: [],
      auto_mapping: null,
      requires_manual_mapping: true,
      errors,
    };
  }
}

// ============================================================================
// Format Detection Functions
// ============================================================================

function detectKBIZFormat(columns: string[]): BankColumnMapping | null {
  // KBIZ format typically has: Date, Description, Withdrawal, Deposit, Balance
  const dateCol = columns.find(c =>
    c.toLowerCase().includes('date') ||
    c.toLowerCase().includes('วันที่')
  );
  const descCol = columns.find(c =>
    c.toLowerCase().includes('description') ||
    c.toLowerCase().includes('รายละเอียด') ||
    c.toLowerCase().includes('detail')
  );
  const withdrawalCol = columns.find(c =>
    c.toLowerCase().includes('withdrawal') ||
    c.toLowerCase().includes('จ่าย') ||
    c.toLowerCase().includes('debit')
  );
  const depositCol = columns.find(c =>
    c.toLowerCase().includes('deposit') ||
    c.toLowerCase().includes('รับ') ||
    c.toLowerCase().includes('credit')
  );
  const balanceCol = columns.find(c =>
    c.toLowerCase().includes('balance') ||
    c.toLowerCase().includes('คงเหลือ') ||
    c.toLowerCase().includes('ยอดคงเหลือ')
  );

  if (dateCol && descCol && (withdrawalCol || depositCol)) {
    return {
      txn_date: dateCol,
      description: descCol,
      withdrawal: withdrawalCol || '',
      deposit: depositCol || '',
      balance: balanceCol,
      channel: undefined,
      reference_id: undefined,
    };
  }

  return null;
}

function detectKPLUSFormat(columns: string[]): BankColumnMapping | null {
  // K PLUS format similar to KBIZ but with different column names
  const dateCol = columns.find(c =>
    c.toLowerCase().includes('วันที่') ||
    c.toLowerCase().includes('date')
  );
  const descCol = columns.find(c =>
    c.toLowerCase().includes('รายการ') ||
    c.toLowerCase().includes('description')
  );
  const withdrawalCol = columns.find(c =>
    c.toLowerCase().includes('ถอน') ||
    c.toLowerCase().includes('จ่าย') ||
    c.toLowerCase().includes('withdrawal')
  );
  const depositCol = columns.find(c =>
    c.toLowerCase().includes('ฝาก') ||
    c.toLowerCase().includes('รับ') ||
    c.toLowerCase().includes('deposit')
  );
  const balanceCol = columns.find(c =>
    c.toLowerCase().includes('คงเหลือ') ||
    c.toLowerCase().includes('balance')
  );
  const channelCol = columns.find(c =>
    c.toLowerCase().includes('ช่องทาง') ||
    c.toLowerCase().includes('channel')
  );

  if (dateCol && descCol && (withdrawalCol || depositCol)) {
    return {
      txn_date: dateCol,
      description: descCol,
      withdrawal: withdrawalCol || '',
      deposit: depositCol || '',
      balance: balanceCol,
      channel: channelCol,
      reference_id: undefined,
    };
  }

  return null;
}

function detectGenericFormat(columns: string[]): BankColumnMapping | null {
  // Generic format: try to find date and amount columns
  const dateCol = columns.find(c =>
    c.toLowerCase().includes('date') ||
    c.toLowerCase().includes('วันที่') ||
    /^\d{2}[\/-]\d{2}[\/-]\d{4}/.test(c) // date-like column name
  );

  const descCol = columns.find(c =>
    c.toLowerCase().includes('desc') ||
    c.toLowerCase().includes('detail') ||
    c.toLowerCase().includes('รายละเอียด') ||
    c.toLowerCase().includes('remark') ||
    c.toLowerCase().includes('transaction')
  );

  const amountCol = columns.find(c =>
    c.toLowerCase().includes('amount') ||
    c.toLowerCase().includes('จำนวน')
  );

  const withdrawalCol = columns.find(c =>
    c.toLowerCase().includes('withdrawal') ||
    c.toLowerCase().includes('debit') ||
    c.toLowerCase().includes('จ่าย') ||
    c.toLowerCase().includes('out')
  );

  const depositCol = columns.find(c =>
    c.toLowerCase().includes('deposit') ||
    c.toLowerCase().includes('credit') ||
    c.toLowerCase().includes('รับ') ||
    c.toLowerCase().includes('in')
  );

  const balanceCol = columns.find(c =>
    c.toLowerCase().includes('balance') ||
    c.toLowerCase().includes('คงเหลือ')
  );

  if (dateCol && (amountCol || withdrawalCol || depositCol)) {
    // Smart fallback: prefer "Transaction" over "Channel"
    let fallbackDesc = '';
    if (!descCol) {
      const transactionCol = columns.find(c =>
        c.toLowerCase().includes('transaction') ||
        c.toLowerCase().includes('รายการ')
      );
      fallbackDesc = transactionCol || columns[1] || '';
    }

    return {
      txn_date: dateCol,
      description: descCol || fallbackDesc,
      withdrawal: withdrawalCol || amountCol || '',
      deposit: depositCol || '',
      balance: balanceCol,
      channel: undefined,
      reference_id: undefined,
    };
  }

  return null;
}

// ============================================================================
// Parse with Column Mapping
// ============================================================================

export interface ParseDiagnostics {
  totalRows: number;
  parsedRows: number; // Successfully parsed rows (at least 1 is enough to import)
  invalidDateCount: number;
  invalidAmountCount: number;
  sampleBadRows: Array<{
    rowIndex: number;
    reason: string;
    data: any;
  }>;
}

// ============================================================================
// Parse with Column Mapping + Diagnostics
// IMPORTANT: Import succeeds if at least 1 valid row exists (not all rows must be valid)
// ============================================================================

export function parseWithMappingDiagnostics(
  rows: any[],
  mapping: BankColumnMapping,
  headerRow: string[]
): { transactions: BankTransactionRow[]; diagnostics: ParseDiagnostics } {
  const transactions: BankTransactionRow[] = [];
  const diagnostics: ParseDiagnostics = {
    totalRows: rows.length,
    parsedRows: 0,
    invalidDateCount: 0,
    invalidAmountCount: 0,
    sampleBadRows: [],
  };

  // Find column indexes
  const dateIdx = headerRow.indexOf(mapping.txn_date);
  const descIdx = mapping.description ? headerRow.indexOf(mapping.description) : -1;
  const withdrawalIdx = mapping.withdrawal ? headerRow.indexOf(mapping.withdrawal) : -1;
  const depositIdx = mapping.deposit ? headerRow.indexOf(mapping.deposit) : -1;
  const balanceIdx = mapping.balance ? headerRow.indexOf(mapping.balance) : -1;
  const channelIdx = mapping.channel ? headerRow.indexOf(mapping.channel) : -1;
  const refIdx = mapping.reference_id ? headerRow.indexOf(mapping.reference_id) : -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length === 0) {
      if (diagnostics.sampleBadRows.length < 5) {
        diagnostics.sampleBadRows.push({
          rowIndex: i,
          reason: 'Empty or invalid row',
          data: row,
        });
      }
      continue;
    }

    const dateValue = row[dateIdx];
    if (!dateValue) {
      diagnostics.invalidDateCount++;
      if (diagnostics.sampleBadRows.length < 5) {
        diagnostics.sampleBadRows.push({
          rowIndex: i,
          reason: 'Missing date value',
          data: row,
        });
      }
      continue;
    }

    const txnDate = parseBangkokDate(dateValue);
    if (!txnDate) {
      diagnostics.invalidDateCount++;
      if (diagnostics.sampleBadRows.length < 5) {
        diagnostics.sampleBadRows.push({
          rowIndex: i,
          reason: `Invalid date format: ${dateValue}`,
          data: row,
        });
      }
      continue;
    }

    const description = descIdx >= 0 ? String(row[descIdx] || '') : '';
    const withdrawal = withdrawalIdx >= 0 ? parseAmount(row[withdrawalIdx]) : 0;
    const deposit = depositIdx >= 0 ? parseAmount(row[depositIdx]) : 0;
    const balance = balanceIdx >= 0 ? parseAmount(row[balanceIdx]) : null;
    const channel = channelIdx >= 0 ? String(row[channelIdx] || '') : null;
    const referenceId = refIdx >= 0 ? String(row[refIdx] || '') : null;

    // ========================================================================
    // VALIDATION RULE: Valid transaction if:
    // - Has valid date (checked above)
    // - AND (withdrawal > 0 OR deposit > 0)
    //
    // NOTE: We DO NOT require withdrawal > 0 AND deposit > 0
    // A transaction with only withdrawal OR only deposit is valid
    // ========================================================================
    if (withdrawal === 0 && deposit === 0) {
      diagnostics.invalidAmountCount++;
      if (diagnostics.sampleBadRows.length < 5) {
        diagnostics.sampleBadRows.push({
          rowIndex: i,
          reason: 'Both withdrawal and deposit are 0',
          data: row,
        });
      }
      continue;
    }

    // Valid transaction
    diagnostics.parsedRows++;
    transactions.push({
      txn_date: format(txnDate, 'yyyy-MM-dd'),
      description,
      withdrawal,
      deposit,
      balance,
      channel,
      reference_id: referenceId,
    });
  }

  return { transactions, diagnostics };
}

export function parseWithMapping(
  rows: any[],
  mapping: BankColumnMapping,
  headerRow: string[]
): BankTransactionRow[] {
  const transactions: BankTransactionRow[] = [];

  // Find column indexes
  const dateIdx = headerRow.indexOf(mapping.txn_date);
  const descIdx = mapping.description ? headerRow.indexOf(mapping.description) : -1;
  const withdrawalIdx = mapping.withdrawal ? headerRow.indexOf(mapping.withdrawal) : -1;
  const depositIdx = mapping.deposit ? headerRow.indexOf(mapping.deposit) : -1;
  const balanceIdx = mapping.balance ? headerRow.indexOf(mapping.balance) : -1;
  const channelIdx = mapping.channel ? headerRow.indexOf(mapping.channel) : -1;
  const refIdx = mapping.reference_id ? headerRow.indexOf(mapping.reference_id) : -1;

  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) continue;

    const dateValue = row[dateIdx];
    if (!dateValue) continue; // skip rows without date

    const txnDate = parseBangkokDate(dateValue);
    if (!txnDate) continue; // skip invalid dates

    const description = descIdx >= 0 ? String(row[descIdx] || '') : '';
    const withdrawal = withdrawalIdx >= 0 ? parseAmount(row[withdrawalIdx]) : 0;
    const deposit = depositIdx >= 0 ? parseAmount(row[depositIdx]) : 0;
    const balance = balanceIdx >= 0 ? parseAmount(row[balanceIdx]) : null;
    const channel = channelIdx >= 0 ? String(row[channelIdx] || '') : null;
    const referenceId = refIdx >= 0 ? String(row[refIdx] || '') : null;

    // Skip rows with no amount
    if (withdrawal === 0 && deposit === 0) continue;

    transactions.push({
      txn_date: format(txnDate, 'yyyy-MM-dd'),
      description,
      withdrawal,
      deposit,
      balance,
      channel,
      reference_id: referenceId,
    });
  }

  return transactions;
}

// ============================================================================
// Date Parsing (Bangkok timezone)
// ============================================================================

export function parseBangkokDate(value: any): Date | null {
  if (!value) return null;

  const strValue = String(value).trim();
  if (!strValue) return null;

  // Try common Thai date formats
  const formats = [
    'dd/MM/yyyy',
    'dd-MM-yyyy',
    'yyyy-MM-dd',
    'dd/MM/yyyy HH:mm:ss',
    'dd-MM-yyyy HH:mm:ss',
    'yyyy-MM-dd HH:mm:ss',
  ];

  for (const fmt of formats) {
    try {
      const parsed = parse(strValue, fmt, new Date());
      if (isValid(parsed)) {
        return toZonedTime(parsed, BANGKOK_TZ);
      }
    } catch {
      continue;
    }
  }

  // Try Excel serial date (numeric)
  if (!isNaN(Number(value))) {
    try {
      const excelDate = XLSX.SSF.parse_date_code(Number(value));
      if (excelDate) {
        const date = new Date(excelDate.y, excelDate.m - 1, excelDate.d);
        if (isValid(date)) {
          return toZonedTime(date, BANGKOK_TZ);
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

// ============================================================================
// Amount Parsing
// ============================================================================

function parseAmount(value: any): number {
  // Handle null, undefined, empty, or dash
  if (value === null || value === undefined || value === '' || value === '-') return 0;

  // Handle numeric type directly (e.g., -6, -1 from Excel)
  if (typeof value === 'number') {
    if (isNaN(value)) return 0;
    return Math.abs(value); // Normalize negative withdrawals to positive
  }

  const strValue = String(value).trim();
  if (!strValue || strValue === '-') return 0;

  // Remove commas, spaces, and Thai currency symbols
  const cleaned = strValue.replace(/[,฿\s]/g, '');

  // Remove parentheses (accounting negative format)
  // Keep negative sign for parseFloat
  const numericStr = cleaned.replace(/[()]/g, '');

  const parsed = parseFloat(numericStr);
  if (isNaN(parsed)) return 0;

  // ALWAYS return absolute value
  // IMPORTANT: KBANK files use NEGATIVE numbers for withdrawals (e.g., -6, -1)
  // We normalize to positive because column mapping determines meaning (withdrawal vs deposit)
  return Math.abs(parsed);
}
