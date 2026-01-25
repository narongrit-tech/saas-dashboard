'use server';

// Bank Reconciliation Actions
// Auto-matching engine between bank transactions and internal records
// Created: 2026-01-25

import { createClient } from '@/lib/supabase/server';
import { format } from 'date-fns';
import {
  ReconciliationSummary,
  UnmatchedBankTransaction,
  UnmatchedInternalRecord,
  GetReconciliationSummaryResponse,
  GetUnmatchedTransactionsResponse,
  GetUnmatchedInternalRecordsResponse,
  RunAutoReconciliationResponse,
} from '@/types/bank';

// ============================================================================
// Get Reconciliation Summary
// ============================================================================

export async function getReconciliationSummary(
  startDate: Date,
  endDate: Date
): Promise<GetReconciliationSummaryResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    // Get bank summary (all active bank accounts)
    const { data: bankTxns } = await supabase
      .from('bank_transactions')
      .select('deposit, withdrawal, id')
      .eq('created_by', user.id)
      .gte('txn_date', startStr)
      .lte('txn_date', endStr);

    const bankIn = bankTxns?.reduce((sum, txn) => sum + Number(txn.deposit || 0), 0) || 0;
    const bankOut = bankTxns?.reduce((sum, txn) => sum + Number(txn.withdrawal || 0), 0) || 0;
    const bankNet = bankIn - bankOut;

    // Get internal summary
    // 1. Marketplace settlements (cash in)
    const { data: settlements } = await supabase
      .from('settlement_transactions')
      .select('settlement_amount, id')
      .eq('created_by', user.id)
      .gte('settled_time', startStr)
      .lte('settled_time', endStr);

    const settlementsTotal =
      settlements?.reduce((sum, s) => sum + Number(s.settlement_amount || 0), 0) || 0;

    // 2. Expenses (cash out)
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, id')
      .eq('created_by', user.id)
      .gte('expense_date', startStr)
      .lte('expense_date', endStr);

    const expensesTotal = expenses?.reduce((sum, e) => sum + Number(e.amount || 0), 0) || 0;

    // 3. Wallet top-ups (cash out)
    const { data: walletTopups } = await supabase
      .from('wallet_ledger')
      .select('amount, id')
      .eq('created_by', user.id)
      .eq('entry_type', 'TOP_UP')
      .gte('date', startStr)
      .lte('date', endStr);

    const walletTopupsTotal =
      walletTopups?.reduce((sum, w) => sum + Number(w.amount || 0), 0) || 0;

    const internalTotal = settlementsTotal - expensesTotal - walletTopupsTotal;

    // Get reconciliation stats
    const { data: matchedBankTxns } = await supabase
      .from('bank_reconciliations')
      .select('bank_transaction_id')
      .eq('created_by', user.id)
      .in(
        'bank_transaction_id',
        bankTxns?.map((t) => t.id) || []
      );

    const matchedBankIds = new Set(matchedBankTxns?.map((r) => r.bank_transaction_id) || []);
    const matchedAmount = 0; // Not tracking matched_amount in new schema

    const unmatchedBankTxns = bankTxns?.filter((t) => !matchedBankIds.has(t.id)) || [];
    const unmatchedBankAmount = unmatchedBankTxns.reduce(
      (sum, txn) => sum + Math.abs(Number(txn.deposit || 0) - Number(txn.withdrawal || 0)),
      0
    );

    const { data: matchedInternal } = await supabase
      .from('bank_reconciliations')
      .select('matched_type, matched_record_id')
      .eq('created_by', user.id)
      .not('matched_record_id', 'is', null); // Only count records with linked IDs

    const matchedInternalIds = new Set(matchedInternal?.map((r) => r.matched_record_id) || []);

    const unmatchedSettlements = settlements?.filter((s) => !matchedInternalIds.has(s.id)) || [];
    const unmatchedExpenses = expenses?.filter((e) => !matchedInternalIds.has(e.id)) || [];
    const unmatchedWalletTopups =
      walletTopups?.filter((w) => !matchedInternalIds.has(w.id)) || [];

    const unmatchedInternalCount =
      unmatchedSettlements.length + unmatchedExpenses.length + unmatchedWalletTopups.length;

    const unmatchedInternalAmount =
      unmatchedSettlements.reduce((sum, s) => sum + Number(s.settlement_amount || 0), 0) +
      unmatchedExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0) +
      unmatchedWalletTopups.reduce((sum, w) => sum + Number(w.amount || 0), 0);

    const gap = bankNet - internalTotal;

    const summary: ReconciliationSummary = {
      date_range: {
        start: startStr,
        end: endStr,
      },
      bank_summary: {
        total_in: bankIn,
        total_out: bankOut,
        net: bankNet,
      },
      internal_summary: {
        settlements: settlementsTotal,
        expenses: expensesTotal,
        wallet_topups: walletTopupsTotal,
        total: internalTotal,
      },
      reconciliation: {
        matched_count: matchedBankIds.size,
        matched_amount: matchedAmount,
        unmatched_bank_count: unmatchedBankTxns.length,
        unmatched_bank_amount: unmatchedBankAmount,
        unmatched_internal_count: unmatchedInternalCount,
        unmatched_internal_amount: unmatchedInternalAmount,
      },
      gap,
    };

    return { success: true, data: summary };
  } catch (error) {
    console.error('getReconciliationSummary exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Get Unmatched Bank Transactions
// ============================================================================

export async function getUnmatchedBankTransactions(
  startDate: Date,
  endDate: Date
): Promise<GetUnmatchedTransactionsResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    const { data: bankTxns } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('created_by', user.id)
      .gte('txn_date', startStr)
      .lte('txn_date', endStr)
      .order('txn_date', { ascending: false });

    if (!bankTxns) {
      return { success: true, data: [] };
    }

    const { data: matched } = await supabase
      .from('bank_reconciliations')
      .select('bank_transaction_id')
      .eq('created_by', user.id)
      .in(
        'bank_transaction_id',
        bankTxns.map((t) => t.id)
      );

    const matchedIds = new Set(matched?.map((r) => r.bank_transaction_id) || []);
    const unmatched = bankTxns.filter((t) => !matchedIds.has(t.id));

    const result: UnmatchedBankTransaction[] = unmatched.map((txn) => ({
      ...txn,
      suggested_match: null,
    }));

    return { success: true, data: result };
  } catch (error) {
    console.error('getUnmatchedBankTransactions exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Get Unmatched Internal Records
// ============================================================================

export async function getUnmatchedInternalRecords(
  startDate: Date,
  endDate: Date,
  entityType: 'settlement' | 'expense' | 'wallet_topup'
): Promise<GetUnmatchedInternalRecordsResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    let records: UnmatchedInternalRecord[] = [];

    if (entityType === 'settlement') {
      const { data: settlements } = await supabase
        .from('settlement_transactions')
        .select('id, settled_time, settlement_amount, txn_id')
        .eq('created_by', user.id)
        .gte('settled_time', startStr)
        .lte('settled_time', endStr);

      if (settlements) {
        const { data: matched } = await supabase
          .from('bank_reconciliations')
          .select('matched_record_id')
          .eq('created_by', user.id)
          .eq('matched_type', 'settlement')
          .in(
            'matched_record_id',
            settlements.map((s) => s.id)
          );

        const matchedIds = new Set(matched?.map((r) => r.matched_record_id) || []);

        records = settlements
          .filter((s) => !matchedIds.has(s.id))
          .map((s) => ({
            entity_type: 'settlement' as const,
            entity_id: s.id,
            date: s.settled_time,
            description: `Settlement ${s.txn_id || ''}`,
            amount: Number(s.settlement_amount || 0),
            suggested_match: null,
          }));
      }
    } else if (entityType === 'expense') {
      const { data: expenses } = await supabase
        .from('expenses')
        .select('id, expense_date, amount, description, category')
        .eq('created_by', user.id)
        .gte('expense_date', startStr)
        .lte('expense_date', endStr);

      if (expenses) {
        const { data: matched } = await supabase
          .from('bank_reconciliations')
          .select('matched_record_id')
          .eq('created_by', user.id)
          .eq('matched_type', 'expense')
          .in(
            'matched_record_id',
            expenses.map((e) => e.id)
          );

        const matchedIds = new Set(matched?.map((r) => r.matched_record_id) || []);

        records = expenses
          .filter((e) => !matchedIds.has(e.id))
          .map((e) => ({
            entity_type: 'expense' as const,
            entity_id: e.id,
            date: e.expense_date,
            description: `${e.category}: ${e.description}`,
            amount: Number(e.amount || 0),
            suggested_match: null,
          }));
      }
    } else if (entityType === 'wallet_topup') {
      const { data: topups } = await supabase
        .from('wallet_ledger')
        .select('id, date, amount, note')
        .eq('created_by', user.id)
        .eq('entry_type', 'TOP_UP')
        .gte('date', startStr)
        .lte('date', endStr);

      if (topups) {
        const { data: matched } = await supabase
          .from('bank_reconciliations')
          .select('matched_record_id')
          .eq('created_by', user.id)
          .eq('matched_type', 'wallet_topup')
          .in(
            'matched_record_id',
            topups.map((t) => t.id)
          );

        const matchedIds = new Set(matched?.map((r) => r.matched_record_id) || []);

        records = topups
          .filter((t) => !matchedIds.has(t.id))
          .map((t) => ({
            entity_type: 'wallet_topup' as const,
            entity_id: t.id,
            date: t.date,
            description: `Wallet Top-up: ${t.note || ''}`,
            amount: Number(t.amount || 0),
            suggested_match: null,
          }));
      }
    }

    return { success: true, data: records };
  } catch (error) {
    console.error('getUnmatchedInternalRecords exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Auto Reconciliation Engine (v1: Placeholder)
// ============================================================================

export async function runAutoReconciliation(
  startDate: Date,
  endDate: Date
): Promise<RunAutoReconciliationResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // TODO: Implement auto-matching algorithm (Phase 2)
    return {
      success: true,
      matchedCount: 0,
    };
  } catch (error) {
    console.error('runAutoReconciliation exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Manual Match: Get Suggested Candidates
// ============================================================================

export interface SuggestedMatch {
  entity_type: 'settlement' | 'expense' | 'wallet_topup';
  entity_id: string;
  date: string;
  description: string;
  amount: number;
  match_score: number; // 0-100 (100 = exact match)
  match_reason: string;
}

export async function getSuggestedMatches(
  bankTransactionId: string
): Promise<{ success: boolean; suggestions?: SuggestedMatch[]; error?: string }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Get bank transaction details
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found' };
    }

    // Check if already matched
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already matched' };
    }

    const suggestions: SuggestedMatch[] = [];
    const txnAmount = Number(bankTxn.deposit || 0) - Number(bankTxn.withdrawal || 0);
    const txnDate = new Date(bankTxn.txn_date);

    // Calculate date range (txn_date +/- 3 days)
    const startDate = new Date(txnDate);
    startDate.setDate(startDate.getDate() - 3);
    const endDate = new Date(txnDate);
    endDate.setDate(endDate.getDate() + 3);

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    // 1. Search unmatched settlements (if txnAmount > 0)
    if (txnAmount > 0) {
      const { data: settlements } = await supabase
        .from('settlement_transactions')
        .select('id, settled_time, settlement_amount, txn_id')
        .eq('created_by', user.id)
        .gte('settled_time', startStr)
        .lte('settled_time', endStr)
        .not(
          'id',
          'in',
          `(SELECT matched_record_id FROM bank_reconciliations WHERE matched_type = 'settlement')`
        );

      settlements?.forEach((s) => {
        const amount = Number(s.settlement_amount || 0);
        const isExactMatch = Math.abs(amount - txnAmount) < 0.01;
        const score = isExactMatch ? 100 : 80;

        suggestions.push({
          entity_type: 'settlement',
          entity_id: s.id,
          date: s.settled_time,
          description: `Settlement - ${s.txn_id || 'N/A'}`,
          amount,
          match_score: score,
          match_reason: isExactMatch ? 'Exact amount match' : 'Similar amount',
        });
      });
    }

    // 2. Search unmatched expenses (if txnAmount < 0 - bank withdrawal)
    if (txnAmount < 0) {
      // Get already reconciled expense IDs
      const { data: reconciledExpenses } = await supabase
        .from('bank_reconciliations')
        .select('matched_record_id')
        .eq('created_by', user.id)
        .eq('matched_type', 'expense')
        .not('matched_record_id', 'is', null);

      const reconciledIds = new Set(reconciledExpenses?.map((r) => r.matched_record_id) || []);

      const { data: expenses } = await supabase
        .from('expenses')
        .select('id, expense_date, category, description, amount')
        .eq('created_by', user.id)
        .gte('expense_date', startStr)
        .lte('expense_date', endStr)
        .order('expense_date', { ascending: false })
        .limit(20);

      expenses?.forEach((e) => {
        // Skip already reconciled expenses
        if (reconciledIds.has(e.id)) return;

        const expenseAmount = Number(e.amount || 0);
        const bankAmount = Math.abs(txnAmount);
        const isExactMatch = Math.abs(expenseAmount - bankAmount) < 0.01;
        const score = isExactMatch ? 100 : 70; // 100 for exact, 70 for near date

        suggestions.push({
          entity_type: 'expense',
          entity_id: e.id,
          date: e.expense_date,
          description: `${e.category} - ${e.description}`,
          amount: expenseAmount, // Keep as positive for display
          match_score: score,
          match_reason: isExactMatch
            ? 'Exact amount + date match'
            : `Similar date (${e.expense_date})`,
        });
      });
    }

    // 3. Search unmatched wallet top-ups (if txnAmount < 0)
    if (txnAmount < 0) {
      const { data: topups } = await supabase
        .from('wallet_ledger')
        .select('id, date, entry_type, amount, note')
        .eq('created_by', user.id)
        .eq('entry_type', 'TOP_UP')
        .gte('date', startStr)
        .lte('date', endStr)
        .not(
          'id',
          'in',
          `(SELECT matched_record_id FROM bank_reconciliations WHERE matched_type = 'wallet_topup')`
        );

      topups?.forEach((t) => {
        const amount = -Number(t.amount || 0); // Negative for cash out
        const isExactMatch = Math.abs(amount - txnAmount) < 0.01;
        const score = isExactMatch ? 100 : 80;

        suggestions.push({
          entity_type: 'wallet_topup',
          entity_id: t.id,
          date: t.date,
          description: `Wallet Top-up - ${t.note || 'N/A'}`,
          amount: Number(t.amount || 0), // Keep as positive for display
          match_score: score,
          match_reason: isExactMatch ? 'Exact amount match' : 'Similar amount',
        });
      });
    }

    // Sort by score (highest first)
    suggestions.sort((a, b) => b.match_score - a.match_score);

    return { success: true, suggestions };
  } catch (error) {
    console.error('getSuggestedMatches exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Manual Match: Create Reconciliation
// ============================================================================

export async function createManualMatch(
  bankTransactionId: string,
  entityType: 'settlement' | 'expense' | 'wallet_topup',
  entityId: string,
  matchedAmount: number,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Verify bank transaction exists and belongs to user
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Check if already matched
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already matched' };
    }

    // Create reconciliation record
    const { error: insertError } = await supabase.from('bank_reconciliations').insert({
      bank_transaction_id: bankTransactionId,
      matched_type: entityType,
      matched_record_id: entityId,
      created_by: user.id,
      notes,
      metadata: {
        matched_amount: matchedAmount,
        matching_rule: 'manual',
      },
    });

    if (insertError) {
      console.error('Create manual match error:', insertError);
      return { success: false, error: insertError.message };
    }

    return { success: true };
  } catch (error) {
    console.error('createManualMatch exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
