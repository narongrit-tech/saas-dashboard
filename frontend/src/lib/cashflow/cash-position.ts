// Cash Position Calculator - Single Source of Truth
// Computes opening balance + bank net movements + running balances
// Used across: /bank, /company-cashflow, /bank-reconciliation, /pl-reconciliation
// Created: 2026-01-25

import { format, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const BANGKOK_TZ = 'Asia/Bangkok';

// ============================================================================
// Types
// ============================================================================

export type DateRange = {
  start: Date;
  end: Date;
};

export type CashPositionInput = {
  bankAccountId: string;
  range: DateRange;
  timezone: 'Asia/Bangkok';
};

export type DailyCashRow = {
  date: string; // YYYY-MM-DD (Bangkok)
  cashIn: number; // deposits
  cashOut: number; // withdrawals
  net: number; // cashIn - cashOut
  runningBalance: number; // opening + cumulative net from range.start..day
  txnCount: number;
};

export type CashPositionResult = {
  openingBalance: number;
  openingEffectiveDate: string | null; // YYYY-MM-DD or null
  cashInTotal: number;
  cashOutTotal: number;
  netTotal: number; // cashInTotal - cashOutTotal (net movement in range)
  endingBalance: number; // openingBalance + netTotal
  daily: DailyCashRow[];
};

export type BankTransactionInput = {
  txn_date: string; // YYYY-MM-DD
  deposit: number;
  withdrawal: number;
};

export type OpeningBalanceRow = {
  opening_balance: number;
  effective_date: string; // YYYY-MM-DD
} | null;

// ============================================================================
// Core Computation Function
// ============================================================================

/**
 * Compute cash position from bank transactions and opening balance
 * This is the SINGLE SOURCE OF TRUTH for cash position calculations
 *
 * @param transactions - Bank transactions within date range (YYYY-MM-DD format)
 * @param openingBalanceRow - Opening balance record (latest on or before range start)
 * @returns CashPositionResult with daily breakdown and totals
 */
export function computeCashPositionFromBankTxns(
  transactions: BankTransactionInput[],
  openingBalanceRow: OpeningBalanceRow
): CashPositionResult {
  // Extract opening balance
  const openingBalance = openingBalanceRow ? openingBalanceRow.opening_balance : 0;
  const openingEffectiveDate = openingBalanceRow ? openingBalanceRow.effective_date : null;

  // If no transactions, return empty result
  if (!transactions || transactions.length === 0) {
    return {
      openingBalance,
      openingEffectiveDate,
      cashInTotal: 0,
      cashOutTotal: 0,
      netTotal: 0,
      endingBalance: openingBalance,
      daily: [],
    };
  }

  // Group transactions by date (Bangkok day)
  const dailyMap = new Map<
    string,
    { cashIn: number; cashOut: number; count: number }
  >();

  for (const txn of transactions) {
    const date = txn.txn_date; // Already YYYY-MM-DD from database

    if (!dailyMap.has(date)) {
      dailyMap.set(date, { cashIn: 0, cashOut: 0, count: 0 });
    }

    const day = dailyMap.get(date)!;

    // Normalize amounts (ensure positive)
    const deposit = Math.abs(Number(txn.deposit || 0));
    const withdrawal = Math.abs(Number(txn.withdrawal || 0));

    day.cashIn += deposit;
    day.cashOut += withdrawal;
    day.count += 1;
  }

  // Build daily breakdown with running balance
  const daily: DailyCashRow[] = [];
  let runningBalance = openingBalance;

  // Sort dates ascending
  const sortedDates = Array.from(dailyMap.keys()).sort();

  for (const date of sortedDates) {
    const day = dailyMap.get(date)!;
    const net = day.cashIn - day.cashOut;
    runningBalance += net;

    daily.push({
      date,
      cashIn: day.cashIn,
      cashOut: day.cashOut,
      net,
      runningBalance,
      txnCount: day.count,
    });
  }

  // Calculate totals
  const cashInTotal = daily.reduce((sum, day) => sum + day.cashIn, 0);
  const cashOutTotal = daily.reduce((sum, day) => sum + day.cashOut, 0);
  const netTotal = cashInTotal - cashOutTotal;
  const endingBalance = openingBalance + netTotal;

  return {
    openingBalance,
    openingEffectiveDate,
    cashInTotal,
    cashOutTotal,
    netTotal,
    endingBalance,
    daily,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert Date to Bangkok timezone start of day
 */
export function toBangkokDayStart(date: Date): Date {
  const bangkokDate = toZonedTime(date, BANGKOK_TZ);
  return startOfDay(bangkokDate);
}

/**
 * Convert Date to Bangkok timezone end of day
 */
export function toBangkokDayEnd(date: Date): Date {
  const bangkokDate = toZonedTime(date, BANGKOK_TZ);
  return endOfDay(bangkokDate);
}

/**
 * Format Date to Bangkok YYYY-MM-DD
 */
export function toBangkokDateString(date: Date): string {
  const bangkokDate = toZonedTime(date, BANGKOK_TZ);
  return format(bangkokDate, 'yyyy-MM-dd');
}

/**
 * Group transactions by Bangkok date
 * (Alternative helper if needed for client-side grouping)
 */
export function groupTransactionsByBangkokDate(
  transactions: BankTransactionInput[]
): Map<string, BankTransactionInput[]> {
  const map = new Map<string, BankTransactionInput[]>();

  for (const txn of transactions) {
    const date = txn.txn_date;
    if (!map.has(date)) {
      map.set(date, []);
    }
    map.get(date)!.push(txn);
  }

  return map;
}

/**
 * Aggregate multiple CashPositionResult (from different bank accounts)
 * Used for company-level cash position (all bank accounts combined)
 *
 * @param results - Array of CashPositionResult from different bank accounts
 * @returns Aggregated CashPositionResult
 */
export function aggregateCashPositions(
  results: CashPositionResult[]
): CashPositionResult {
  if (results.length === 0) {
    return {
      openingBalance: 0,
      openingEffectiveDate: null,
      cashInTotal: 0,
      cashOutTotal: 0,
      netTotal: 0,
      endingBalance: 0,
      daily: [],
    };
  }

  // Aggregate opening balances
  const totalOpeningBalance = results.reduce(
    (sum, r) => sum + r.openingBalance,
    0
  );

  // Find earliest opening effective date (for display)
  const openingDates = results
    .map((r) => r.openingEffectiveDate)
    .filter((d): d is string => d !== null)
    .sort();
  const earliestOpeningDate = openingDates.length > 0 ? openingDates[0] : null;

  // Aggregate daily data by date
  const dailyMap = new Map<string, { cashIn: number; cashOut: number; count: number }>();

  for (const result of results) {
    for (const day of result.daily) {
      if (!dailyMap.has(day.date)) {
        dailyMap.set(day.date, { cashIn: 0, cashOut: 0, count: 0 });
      }
      const existing = dailyMap.get(day.date)!;
      existing.cashIn += day.cashIn;
      existing.cashOut += day.cashOut;
      existing.count += day.txnCount;
    }
  }

  // Build aggregated daily breakdown with running balance
  const daily: DailyCashRow[] = [];
  let runningBalance = totalOpeningBalance;
  const sortedDates = Array.from(dailyMap.keys()).sort();

  for (const date of sortedDates) {
    const day = dailyMap.get(date)!;
    const net = day.cashIn - day.cashOut;
    runningBalance += net;

    daily.push({
      date,
      cashIn: day.cashIn,
      cashOut: day.cashOut,
      net,
      runningBalance,
      txnCount: day.count,
    });
  }

  // Calculate totals
  const cashInTotal = daily.reduce((sum, day) => sum + day.cashIn, 0);
  const cashOutTotal = daily.reduce((sum, day) => sum + day.cashOut, 0);
  const netTotal = cashInTotal - cashOutTotal;
  const endingBalance = totalOpeningBalance + netTotal;

  return {
    openingBalance: totalOpeningBalance,
    openingEffectiveDate: earliestOpeningDate,
    cashInTotal,
    cashOutTotal,
    netTotal,
    endingBalance,
    daily,
  };
}
