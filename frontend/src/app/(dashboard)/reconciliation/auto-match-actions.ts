'use server';

// Auto Match Bank Transactions (Exact Only)
// Conservative exact matching: same date + same amount + only 1 candidate
// Created: 2026-01-26

import { createClient } from '@/lib/supabase/server';
import { format } from 'date-fns';

export interface AutoMatchResult {
  success: boolean;
  matched_count: number;
  skipped_count: number;
  details: {
    no_candidate: number;
    multiple_candidates: number;
    already_matched: number;
    not_exact: number;
  };
  matched_items: Array<{
    bank_txn_id: string;
    entity_type: 'expense' | 'settlement';
    entity_id: string;
    amount: number;
  }>;
  error?: string;
}

export async function autoMatchBankTransactions(
  startDate: Date,
  endDate: Date
): Promise<AutoMatchResult> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        matched_count: 0,
        skipped_count: 0,
        details: {
          no_candidate: 0,
          multiple_candidates: 0,
          already_matched: 0,
          not_exact: 0,
        },
        matched_items: [],
        error: 'Unauthorized',
      };
    }

    console.log('Auto-matching bank transactions:', {
      user_id: user.id,
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(endDate, 'yyyy-MM-dd'),
    });

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    // Get all bank transactions in date range (with pagination)
    interface BankTxnRow {
      id: string;
      txn_date: string;
      deposit: number | null;
      withdrawal: number | null;
      description: string | null;
    }
    let bankTxns: BankTxnRow[] = [];
    let bankFrom = 0;
    const pageSize = 1000;
    let hasMoreBank = true;

    while (hasMoreBank) {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('id, txn_date, deposit, withdrawal, description')
        .eq('created_by', user.id)
        .gte('txn_date', startStr)
        .lte('txn_date', endStr)
        .order('txn_date', { ascending: true })
        .range(bankFrom, bankFrom + pageSize - 1);

      if (error) {
        return {
          success: false,
          matched_count: 0,
          skipped_count: 0,
          details: {
            no_candidate: 0,
            multiple_candidates: 0,
            already_matched: 0,
            not_exact: 0,
          },
          matched_items: [],
          error: error.message,
        };
      }

      if (data && data.length > 0) {
        bankTxns = bankTxns.concat(data);
        hasMoreBank = data.length === pageSize;
        bankFrom += pageSize;
      } else {
        hasMoreBank = false;
      }
    }

    if (!bankTxns || bankTxns.length === 0) {
      return {
        success: true,
        matched_count: 0,
        skipped_count: 0,
        details: {
          no_candidate: 0,
          multiple_candidates: 0,
          already_matched: 0,
          not_exact: 0,
        },
        matched_items: [],
      };
    }

    // Get already reconciled bank transaction IDs
    const { data: existingReconciliations } = await supabase
      .from('bank_reconciliations')
      .select('bank_transaction_id')
      .eq('created_by', user.id)
      .in(
        'bank_transaction_id',
        bankTxns.map((t) => t.id)
      );

    const reconciledBankIds = new Set(
      existingReconciliations?.map((r) => r.bank_transaction_id) || []
    );

    // Get all expenses in date range (with pagination)
    interface ExpenseRow {
      id: string;
      expense_date: string;
      category: string;
      description: string;
      amount: number;
    }
    let expenses: ExpenseRow[] = [];
    let expenseFrom = 0;
    let hasMoreExpenses = true;

    while (hasMoreExpenses) {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_date, category, description, amount')
        .eq('created_by', user.id)
        .gte('expense_date', startStr)
        .lte('expense_date', endStr)
        .range(expenseFrom, expenseFrom + pageSize - 1);

      if (error) {
        console.error('Expenses query error:', error);
        break;
      }

      if (data && data.length > 0) {
        expenses = expenses.concat(data);
        hasMoreExpenses = data.length === pageSize;
        expenseFrom += pageSize;
      } else {
        hasMoreExpenses = false;
      }
    }

    // Get already reconciled expense IDs
    const { data: reconciledExpenses } = await supabase
      .from('bank_reconciliations')
      .select('matched_record_id')
      .eq('created_by', user.id)
      .eq('matched_type', 'expense')
      .not('matched_record_id', 'is', null);

    const reconciledExpenseIds = new Set(
      reconciledExpenses?.map((r) => r.matched_record_id) || []
    );

    // Get all settlements in date range (with pagination)
    interface SettlementRow {
      id: string;
      settled_time: string;
      settlement_amount: number;
      txn_id: string | null;
    }
    let settlements: SettlementRow[] = [];
    let settlementFrom = 0;
    let hasMoreSettlements = true;

    while (hasMoreSettlements) {
      const { data, error } = await supabase
        .from('settlement_transactions')
        .select('id, settled_time, settlement_amount, txn_id')
        .eq('created_by', user.id)
        .gte('settled_time', startStr)
        .lte('settled_time', endStr)
        .range(settlementFrom, settlementFrom + pageSize - 1);

      if (error) {
        console.error('Settlements query error:', error);
        break;
      }

      if (data && data.length > 0) {
        settlements = settlements.concat(data);
        hasMoreSettlements = data.length === pageSize;
        settlementFrom += pageSize;
      } else {
        hasMoreSettlements = false;
      }
    }

    // Get already reconciled settlement IDs
    const { data: reconciledSettlements } = await supabase
      .from('bank_reconciliations')
      .select('matched_record_id')
      .eq('created_by', user.id)
      .eq('matched_type', 'settlement')
      .not('matched_record_id', 'is', null);

    const reconciledSettlementIds = new Set(
      reconciledSettlements?.map((r) => r.matched_record_id) || []
    );

    // Process each bank transaction
    const matchedItems: Array<{
      bank_txn_id: string;
      entity_type: 'expense' | 'settlement';
      entity_id: string;
      amount: number;
    }> = [];

    const details = {
      no_candidate: 0,
      multiple_candidates: 0,
      already_matched: 0,
      not_exact: 0,
    };

    for (const bankTxn of bankTxns) {
      // Skip if already reconciled
      if (reconciledBankIds.has(bankTxn.id)) {
        details.already_matched++;
        continue;
      }

      const txnAmount = Number(bankTxn.deposit || 0) - Number(bankTxn.withdrawal || 0);
      const bankDate = bankTxn.txn_date;

      const candidates: Array<{
        entity_type: 'expense' | 'settlement';
        entity_id: string;
        amount: number;
        date: string;
      }> = [];

      // Find expense candidates (if withdrawal)
      if (txnAmount < 0) {
        const bankAmount = Math.abs(txnAmount);
        const matchingExpenses = expenses?.filter((e) => {
          if (reconciledExpenseIds.has(e.id)) return false;
          if (e.expense_date !== bankDate) return false;
          const expenseAmount = Number(e.amount || 0);
          return Math.abs(expenseAmount - bankAmount) < 0.01;
        });

        matchingExpenses?.forEach((e) => {
          candidates.push({
            entity_type: 'expense',
            entity_id: e.id,
            amount: Number(e.amount || 0),
            date: e.expense_date,
          });
        });
      }

      // Find settlement candidates (if deposit)
      if (txnAmount > 0) {
        const bankAmount = Math.abs(txnAmount);
        const matchingSettlements = settlements?.filter((s) => {
          if (reconciledSettlementIds.has(s.id)) return false;
          const settlementDate = s.settled_time.split('T')[0]; // Extract date part
          if (settlementDate !== bankDate) return false;
          const settlementAmount = Number(s.settlement_amount || 0);
          return Math.abs(settlementAmount - bankAmount) < 0.01;
        });

        matchingSettlements?.forEach((s) => {
          candidates.push({
            entity_type: 'settlement',
            entity_id: s.id,
            amount: Number(s.settlement_amount || 0),
            date: s.settled_time.split('T')[0],
          });
        });
      }

      // Apply matching logic
      if (candidates.length === 0) {
        details.no_candidate++;
        continue;
      }

      if (candidates.length > 1) {
        details.multiple_candidates++;
        continue;
      }

      // Exactly 1 candidate - auto match
      const candidate = candidates[0];
      const positiveAmount = Math.abs(txnAmount);

      console.log('Auto-matching:', {
        bank_txn_id: bankTxn.id,
        entity_type: candidate.entity_type,
        entity_id: candidate.entity_id,
        amount: candidate.amount,
      });

      // Create reconciliation
      const { error: reconError } = await supabase.from('bank_reconciliations').insert({
        bank_transaction_id: bankTxn.id,
        matched_type: candidate.entity_type,
        matched_record_id: candidate.entity_id,
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: `Auto-matched (exact): ${candidate.entity_type} ${candidate.amount}`,
        metadata: {
          auto_matched: true,
          match_criteria: 'exact_date_amount',
          matched_amount: positiveAmount,
          matching_rule: 'auto_exact',
        },
      });

      if (reconError) {
        console.error('Auto-match reconciliation error:', reconError);
        // Skip this one but continue with others
        details.not_exact++;
        continue;
      }

      matchedItems.push({
        bank_txn_id: bankTxn.id,
        entity_type: candidate.entity_type,
        entity_id: candidate.entity_id,
        amount: candidate.amount,
      });
    }

    const matched_count = matchedItems.length;
    const skipped_count = bankTxns.length - matched_count - details.already_matched;

    console.log('Auto-match complete:', {
      total: bankTxns.length,
      matched: matched_count,
      skipped: skipped_count,
      details,
    });

    return {
      success: true,
      matched_count,
      skipped_count,
      details,
      matched_items: matchedItems,
    };
  } catch (error) {
    console.error('autoMatchBankTransactions exception:', error);
    return {
      success: false,
      matched_count: 0,
      skipped_count: 0,
      details: {
        no_candidate: 0,
        multiple_candidates: 0,
        already_matched: 0,
        not_exact: 0,
      },
      matched_items: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
