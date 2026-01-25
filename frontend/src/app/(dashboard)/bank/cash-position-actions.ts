'use server';

// Cash Position Server Actions - Single Source of Truth
// This is the ONLY place that queries DB for cash position
// All pages MUST call this action
// Created: 2026-01-25

import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { format } from 'date-fns';
import {
  computeCashPositionFromBankTxns,
  CashPositionResult,
  BankTransactionInput,
  OpeningBalanceRow,
} from '@/lib/cashflow/cash-position';
import { getOpeningBalance } from './actions';

// ============================================================================
// Response Type
// ============================================================================

export interface GetCashPositionResponse {
  success: boolean;
  data?: CashPositionResult;
  error?: string;
}

// ============================================================================
// Main Action: Get Cash Position
// ============================================================================

/**
 * Get cash position for a bank account within date range
 * This is the SINGLE SOURCE OF TRUTH for cash position calculations
 *
 * Used by:
 * - /bank page
 * - /company-cashflow (Bank View)
 * - /bank-reconciliation
 * - /reconciliation (P&L vs Cashflow)
 *
 * @param params.bankAccountId - Bank account ID
 * @param params.startDate - Start date (YYYY-MM-DD, Bangkok timezone)
 * @param params.endDate - End date (YYYY-MM-DD, Bangkok timezone)
 * @returns CashPositionResult with opening balance, daily breakdown, and totals
 */
export async function getCashPosition(params: {
  bankAccountId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}): Promise<GetCashPositionResponse> {
  noStore(); // Disable caching - always fetch live data

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { bankAccountId, startDate, endDate } = params;

    // ========================================================================
    // 1. Fetch opening balance (latest on or before start date)
    // ========================================================================
    const openingBalanceResponse = await getOpeningBalance(bankAccountId, startDate);
    const openingBalanceRow: OpeningBalanceRow = openingBalanceResponse.data
      ? {
          opening_balance: openingBalanceResponse.data.opening_balance,
          effective_date: openingBalanceResponse.data.effective_date,
        }
      : null;

    // ========================================================================
    // 2. Fetch bank transactions within date range
    // ========================================================================
    const { data: transactions, error: txnError } = await supabase
      .from('bank_transactions')
      .select('txn_date, deposit, withdrawal')
      .eq('bank_account_id', bankAccountId)
      .eq('created_by', user.id)
      .gte('txn_date', startDate)
      .lte('txn_date', endDate)
      .order('txn_date', { ascending: true });

    if (txnError) {
      console.error('getCashPosition - fetch transactions error:', txnError);
      return { success: false, error: txnError.message };
    }

    // ========================================================================
    // 3. Compute cash position (SINGLE SOURCE OF TRUTH)
    // ========================================================================
    const result = computeCashPositionFromBankTxns(
      (transactions || []) as BankTransactionInput[],
      openingBalanceRow
    );

    return { success: true, data: result };
  } catch (error) {
    console.error('getCashPosition exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Helper: Get Cash Position from Date Objects (for convenience)
// ============================================================================

/**
 * Get cash position using Date objects (converts to YYYY-MM-DD)
 * Convenience wrapper for getCashPosition
 */
export async function getCashPositionFromDates(
  bankAccountId: string,
  startDate: Date,
  endDate: Date
): Promise<GetCashPositionResponse> {
  const startStr = format(startDate, 'yyyy-MM-dd');
  const endStr = format(endDate, 'yyyy-MM-dd');

  return getCashPosition({
    bankAccountId,
    startDate: startStr,
    endDate: endStr,
  });
}

// ============================================================================
// Company-Level Cash Position (All Bank Accounts)
// ============================================================================

/**
 * Get company-level cash position (all bank accounts aggregated)
 * Used by /company-cashflow (Bank View)
 *
 * @param params.startDate - Start date (YYYY-MM-DD, Bangkok timezone)
 * @param params.endDate - End date (YYYY-MM-DD, Bangkok timezone)
 * @returns Aggregated CashPositionResult from all bank accounts
 */
export async function getCompanyCashPosition(params: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}): Promise<GetCashPositionResponse> {
  noStore(); // Disable caching - always fetch live data

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { startDate, endDate } = params;

    // ========================================================================
    // 1. Get all active bank accounts for user
    // ========================================================================
    const { data: accounts, error: accountsError } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('created_by', user.id)
      .eq('is_active', true);

    if (accountsError) {
      console.error('getCompanyCashPosition - fetch accounts error:', accountsError);
      return { success: false, error: accountsError.message };
    }

    if (!accounts || accounts.length === 0) {
      // No bank accounts - return empty result
      return {
        success: true,
        data: {
          openingBalance: 0,
          openingEffectiveDate: null,
          cashInTotal: 0,
          cashOutTotal: 0,
          netTotal: 0,
          endingBalance: 0,
          daily: [],
        },
      };
    }

    // ========================================================================
    // 2. Get cash position for each bank account
    // ========================================================================
    const { aggregateCashPositions } = await import('@/lib/cashflow/cash-position');
    const results: CashPositionResult[] = [];

    for (const account of accounts) {
      const response = await getCashPosition({
        bankAccountId: account.id,
        startDate,
        endDate,
      });

      if (response.success && response.data) {
        results.push(response.data);
      }
      // Skip accounts with errors (don't fail entire request)
    }

    // ========================================================================
    // 3. Aggregate results
    // ========================================================================
    const aggregated = aggregateCashPositions(results);

    return { success: true, data: aggregated };
  } catch (error) {
    console.error('getCompanyCashPosition exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
