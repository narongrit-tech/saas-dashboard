'use server';

// Manual Bank Reconciliation Override Actions
// Purpose: Create expense/wallet/adjustment/ignore from unmatched bank transactions
// Created: 2026-01-26

import { createClient } from '@/lib/supabase/server';
import { getBangkokNow, formatBangkok } from '@/lib/bangkok-time';
import { format } from 'date-fns';

// ============================================================================
// Response Types
// ============================================================================

export interface ManualMatchResponse {
  success: boolean;
  reconciliationId?: string;
  createdRecordId?: string; // ID of expense/wallet entry created
  error?: string;
}

export interface SuggestedMatchesResponse {
  success: boolean;
  settlements?: SuggestedSettlement[];
  expenses?: SuggestedExpense[];
  walletEntries?: SuggestedWalletEntry[];
  error?: string;
}

interface SuggestedSettlement {
  id: string;
  settled_time: string;
  settlement_amount: number;
  txn_id: string;
  match_score: number;
}

interface SuggestedExpense {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  match_score: number;
}

interface SuggestedWalletEntry {
  id: string;
  date: string;
  entry_type: string;
  amount: number;
  note: string | null;
  match_score: number;
}

// ============================================================================
// 1. Create Expense from Bank Transaction
// ============================================================================

export async function createExpenseFromBankTransaction(
  bankTransactionId: string,
  category: 'Advertising' | 'COGS' | 'Operating' | 'Tax',
  description: string,
  amount: number,
  subcategory?: string,
  notes?: string
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Validate category
    const validCategories = ['Advertising', 'COGS', 'Operating', 'Tax'];
    if (!validCategories.includes(category)) {
      return { success: false, error: 'Invalid category' };
    }

    // Validate amount (ensure positive)
    const positiveAmount = Math.abs(amount);
    if (positiveAmount <= 0) {
      return { success: false, error: 'Amount must be greater than 0' };
    }

    // Verify bank transaction exists and belongs to user
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id, txn_date, withdrawal, deposit')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Validate: client amount must match actual bank transaction amount (source of truth)
    const bankAmount = Math.abs(Number(bankTxn.withdrawal || bankTxn.deposit || 0));
    if (Math.round(positiveAmount * 100) !== Math.round(bankAmount * 100)) {
      return { success: false, error: 'amount_mismatch: ยอดเงินไม่ตรงกับ bank transaction' };
    }

    // Check if already reconciled
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already reconciled' };
    }

    // Create expense record
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        category,
        subcategory: subcategory || null,
        description,
        amount: bankAmount,
        expense_date: bankTxn.txn_date,
        created_by: user.id,
        source: 'manual', // Source: manual entry from bank reconciliation (lowercase for expenses)
      })
      .select('id')
      .single();

    if (expenseError || !expense) {
      console.error('Create expense error:', expenseError);
      console.error('Error details:', {
        message: expenseError?.message,
        code: expenseError?.code,
        details: expenseError?.details,
        hint: expenseError?.hint,
      });
      return {
        success: false,
        error: `Failed to create expense: ${expenseError?.message || 'Unknown error'} (Code: ${expenseError?.code || 'N/A'})`,
      };
    }

    // Create audit log for expense
    const auditChanges = {
      created: {
        category,
        subcategory: subcategory || null,
        description,
        amount: bankAmount,
        expense_date: bankTxn.txn_date,
        source: 'manual',
      },
    };

    await supabase.rpc('create_expense_audit_log', {
      p_expense_id: expense.id,
      p_action: 'CREATE',
      p_performed_by: user.id,
      p_changes: auditChanges,
      p_notes: `Created from bank transaction ${bankTransactionId}`,
    });

    // Debug log before reconciliation insert
    console.log('Inserting bank_reconciliation:', {
      bank_transaction_id: bankTransactionId,
      matched_type: 'expense',
      matched_record_id: expense.id,
      created_by: user.id,
      notes: notes || `Manual match: Created expense ${category} - ${description}`,
    });

    // Create reconciliation record
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'expense',
        entity_id: expense.id,
        matched_amount: bankAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'expense',
        matched_record_id: expense.id,
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: notes || `Manual match: Created expense ${category} - ${description}`,
        metadata: {
          category,
          subcategory,
          description,
          amount: bankAmount,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      // Rollback expense (delete it)
      await supabase.from('expenses').delete().eq('id', expense.id);
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
      createdRecordId: expense.id,
    };
  } catch (error) {
    console.error('createExpenseFromBankTransaction exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 2. Create Wallet Top-up from Bank Transaction
// ============================================================================

export async function createWalletTopupFromBankTransaction(
  bankTransactionId: string,
  walletId: string,
  amount: number,
  notes?: string
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    console.log('User authenticated (createWalletTopupFromBankTransaction):', user.id);

    // Validate amount (ensure positive)
    const positiveAmount = Math.abs(amount);
    if (positiveAmount <= 0) {
      return { success: false, error: 'Amount must be greater than 0' };
    }

    // Verify wallet exists
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, name')
      .eq('id', walletId)
      .eq('created_by', user.id)
      .single();

    if (walletError || !wallet) {
      return { success: false, error: 'Wallet not found' };
    }

    // Verify bank transaction exists
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id, txn_date, withdrawal, deposit')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Validate: client amount must match actual bank transaction amount (source of truth)
    const bankAmount = Math.abs(Number(bankTxn.withdrawal || bankTxn.deposit || 0));
    if (Math.round(positiveAmount * 100) !== Math.round(bankAmount * 100)) {
      return { success: false, error: 'amount_mismatch: ยอดเงินไม่ตรงกับ bank transaction' };
    }

    // Check if already reconciled
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already reconciled' };
    }

    // Convert bank transaction timestamp to DATE string for wallet_ledger.date
    const txnDate = new Date(bankTxn.txn_date);
    const dateString = format(txnDate, 'yyyy-MM-dd'); // 'YYYY-MM-DD' format for DATE type

    // Debug log before insert
    console.log('Inserting wallet_ledger (TOP_UP):', {
      wallet_id: walletId,
      entry_type: 'TOP_UP',
      direction: 'IN',
      amount: bankAmount,
      date: dateString,
      source: 'MANUAL', // Source constraint only allows 'manual' or 'IMPORTED'
      reference_id: bankTransactionId,
      created_by: user.id,
    });

    // Create wallet ledger entry
    const { data: walletEntry, error: ledgerError } = await supabase
      .from('wallet_ledger')
      .insert({
        wallet_id: walletId,
        entry_type: 'TOP_UP',
        direction: 'IN', // TOP_UP = เงินเข้า wallet (ธนาคารลด, wallet เพิ่ม)
        amount: bankAmount,
        date: dateString, // Use DATE string, not TIMESTAMPTZ
        note: notes || `Top-up from bank reconciliation`,
        source: 'MANUAL', // Source constraint only allows 'manual' or 'IMPORTED'
        reference_id: bankTransactionId, // Link back to bank transaction
        created_by: user.id,
      })
      .select('id')
      .single();

    if (ledgerError || !walletEntry) {
      console.error('Create wallet entry error:', ledgerError);
      console.error('Error details:', {
        message: ledgerError?.message,
        code: ledgerError?.code,
        details: ledgerError?.details,
        hint: ledgerError?.hint,
      });
      return {
        success: false,
        error: `Failed to create wallet entry: ${ledgerError?.message || 'Unknown error'} (Code: ${ledgerError?.code || 'N/A'})`,
      };
    }

    // Debug log before reconciliation insert
    console.log('Inserting bank_reconciliation:', {
      bank_transaction_id: bankTransactionId,
      matched_type: 'wallet_topup',
      matched_record_id: walletEntry.id,
      created_by: user.id,
      notes: notes || `Manual match: Wallet top-up ${wallet.name}`,
    });

    // Create reconciliation record
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'wallet_topup',
        entity_id: walletEntry.id,
        matched_amount: bankAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'wallet_topup',
        matched_record_id: walletEntry.id,
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: notes || `Manual match: Wallet top-up ${wallet.name}`,
        metadata: {
          wallet_id: walletId,
          wallet_name: wallet.name,
          amount: bankAmount,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      // Rollback wallet entry
      await supabase.from('wallet_ledger').delete().eq('id', walletEntry.id);
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
      createdRecordId: walletEntry.id,
    };
  } catch (error) {
    console.error('createWalletTopupFromBankTransaction exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 3. Create Wallet Spend from Bank Transaction
// ============================================================================

export async function createWalletSpendFromBankTransaction(
  bankTransactionId: string,
  walletId: string,
  amount: number,
  notes?: string
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    console.log('User authenticated (createWalletSpendFromBankTransaction):', user.id);

    // Validate amount (ensure positive)
    const positiveAmount = Math.abs(amount);
    if (positiveAmount <= 0) {
      return { success: false, error: 'Amount must be greater than 0' };
    }

    // Verify wallet exists and check business rules
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, name, wallet_type')
      .eq('id', walletId)
      .eq('created_by', user.id)
      .single();

    if (walletError || !wallet) {
      return { success: false, error: 'Wallet not found' };
    }

    // CRITICAL: Block manual SPEND for ADS wallet
    if (wallet.wallet_type === 'ADS') {
      return {
        success: false,
        error: '❌ ห้ามสร้าง SPEND แบบ Manual สำหรับ ADS Wallet (ต้อง import จาก report เท่านั้น)',
      };
    }

    // Verify bank transaction exists
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id, txn_date, withdrawal, deposit')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Validate: client amount must match actual bank transaction amount (source of truth)
    const bankAmount = Math.abs(Number(bankTxn.withdrawal || bankTxn.deposit || 0));
    if (Math.round(positiveAmount * 100) !== Math.round(bankAmount * 100)) {
      return { success: false, error: 'amount_mismatch: ยอดเงินไม่ตรงกับ bank transaction' };
    }

    // Check if already reconciled
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already reconciled' };
    }

    // Convert bank transaction timestamp to DATE string for wallet_ledger.date
    const txnDate = new Date(bankTxn.txn_date);
    const dateString = format(txnDate, 'yyyy-MM-dd'); // 'YYYY-MM-DD' format for DATE type

    // Debug log before insert
    console.log('Inserting wallet_ledger (SPEND):', {
      wallet_id: walletId,
      entry_type: 'SPEND',
      direction: 'OUT',
      amount: bankAmount,
      date: dateString,
      source: 'MANUAL', // Source constraint only allows 'manual' or 'IMPORTED'
      reference_id: bankTransactionId,
      created_by: user.id,
    });

    // Create wallet ledger entry
    const { data: walletEntry, error: ledgerError } = await supabase
      .from('wallet_ledger')
      .insert({
        wallet_id: walletId,
        entry_type: 'SPEND',
        direction: 'OUT', // SPEND = เงินออก wallet (ธนาคารลด, wallet ลด)
        amount: bankAmount,
        date: dateString, // Use DATE string, not TIMESTAMPTZ
        note: notes || `Spend from bank reconciliation`,
        source: 'MANUAL', // Source constraint only allows 'manual' or 'IMPORTED'
        reference_id: bankTransactionId, // Link back to bank transaction
        created_by: user.id,
      })
      .select('id')
      .single();

    if (ledgerError || !walletEntry) {
      console.error('Create wallet entry error:', ledgerError);
      console.error('Error details:', {
        message: ledgerError?.message,
        code: ledgerError?.code,
        details: ledgerError?.details,
        hint: ledgerError?.hint,
      });
      return {
        success: false,
        error: `Failed to create wallet entry: ${ledgerError?.message || 'Unknown error'} (Code: ${ledgerError?.code || 'N/A'})`,
      };
    }

    // Debug log before reconciliation insert
    console.log('Inserting bank_reconciliation:', {
      bank_transaction_id: bankTransactionId,
      matched_type: 'wallet_spend',
      matched_record_id: walletEntry.id,
      created_by: user.id,
      notes: notes || `Manual match: Wallet spend ${wallet.name}`,
    });

    // Create reconciliation record
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'wallet_spend',
        entity_id: walletEntry.id,
        matched_amount: bankAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'wallet_spend',
        matched_record_id: walletEntry.id,
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: notes || `Manual match: Wallet spend ${wallet.name}`,
        metadata: {
          wallet_id: walletId,
          wallet_name: wallet.name,
          amount: bankAmount,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      // Rollback wallet entry
      await supabase.from('wallet_ledger').delete().eq('id', walletEntry.id);
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
      createdRecordId: walletEntry.id,
    };
  } catch (error) {
    console.error('createWalletSpendFromBankTransaction exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 4. Match Bank Transaction to Settlement
// ============================================================================

export async function matchBankTransactionToSettlement(
  bankTransactionId: string,
  settlementTransactionId: string,
  notes?: string
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    console.log('User authenticated (matchBankTransactionToSettlement):', user.id);

    // Verify bank transaction exists
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Verify settlement exists
    const { data: settlement, error: settlementError } = await supabase
      .from('settlement_transactions')
      .select('id, txn_id, settlement_amount')
      .eq('id', settlementTransactionId)
      .eq('created_by', user.id)
      .single();

    if (settlementError || !settlement) {
      return { success: false, error: 'Settlement transaction not found' };
    }

    // Check if bank transaction already reconciled
    const { data: existingBankMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingBankMatch) {
      return { success: false, error: 'Bank transaction already reconciled' };
    }

    // Check if settlement already matched
    const { data: existingSettlementMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('matched_type', 'settlement')
      .eq('matched_record_id', settlementTransactionId)
      .maybeSingle();

    if (existingSettlementMatch) {
      return { success: false, error: 'Settlement already matched' };
    }

    // Debug log before reconciliation insert
    console.log('Inserting bank_reconciliation:', {
      bank_transaction_id: bankTransactionId,
      matched_type: 'settlement',
      matched_record_id: settlementTransactionId,
      created_by: user.id,
      notes: notes || `Manual match to settlement ${settlement.txn_id}`,
    });

    const positiveAmount = Math.abs(Number(settlement.settlement_amount || 0));

    // Create reconciliation record
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'settlement',
        entity_id: settlementTransactionId,
        matched_amount: positiveAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'settlement',
        matched_record_id: settlementTransactionId,
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: notes || `Manual match to settlement ${settlement.txn_id}`,
        metadata: {
          settlement_txn_id: settlement.txn_id,
          settlement_amount: settlement.settlement_amount,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
      createdRecordId: settlementTransactionId,
    };
  } catch (error) {
    console.error('matchBankTransactionToSettlement exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 5. Create Adjustment for Bank Transaction
// ============================================================================

export async function createAdjustmentForBankTransaction(
  bankTransactionId: string,
  adjustmentType: 'bank_error' | 'timing_difference' | 'other',
  notes: string // Required for adjustments
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    console.log('User authenticated (createAdjustmentForBankTransaction):', user.id);

    // Validate notes (required)
    if (!notes || notes.trim().length === 0) {
      return { success: false, error: 'Notes are required for adjustments' };
    }

    // Verify bank transaction exists
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id, txn_date, withdrawal, deposit')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Check if already reconciled
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already reconciled' };
    }

    // Debug log before reconciliation insert
    console.log('Inserting bank_reconciliation:', {
      bank_transaction_id: bankTransactionId,
      matched_type: 'adjustment',
      matched_record_id: null,
      created_by: user.id,
      notes,
    });

    const txnAmount = Math.abs(Number(bankTxn.withdrawal || bankTxn.deposit || 0));

    // Create reconciliation record (no matched_record_id for adjustment)
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'adjustment',
        entity_id: null, // No linked record
        matched_amount: txnAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'adjustment',
        matched_record_id: null, // No linked record
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes,
        metadata: {
          adjustment_type: adjustmentType,
          bank_txn_date: bankTxn.txn_date,
          withdrawal: bankTxn.withdrawal,
          deposit: bankTxn.deposit,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
    };
  } catch (error) {
    console.error('createAdjustmentForBankTransaction exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 6. Ignore Bank Transaction
// ============================================================================

export async function ignoreBankTransaction(
  bankTransactionId: string,
  reason: string // Required
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    console.log('User authenticated (ignoreBankTransaction):', user.id);

    // Validate reason (required)
    if (!reason || reason.trim().length === 0) {
      return { success: false, error: 'Reason is required to ignore transaction' };
    }

    // Verify bank transaction exists
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found or unauthorized' };
    }

    // Check if already reconciled
    const { data: existingMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingMatch) {
      return { success: false, error: 'Transaction already reconciled' };
    }

    // Debug log before reconciliation insert
    console.log('Inserting bank_reconciliation:', {
      bank_transaction_id: bankTransactionId,
      matched_type: 'ignore',
      matched_record_id: null,
      created_by: user.id,
      notes: `IGNORED: ${reason}`,
    });

    // Get transaction amount
    const { data: bankTxnDetails, error: txnDetailsError } = await supabase
      .from('bank_transactions')
      .select('withdrawal, deposit')
      .eq('id', bankTransactionId)
      .single();

    const txnAmount = Math.abs(Number(bankTxnDetails?.withdrawal || bankTxnDetails?.deposit || 0));

    // Create reconciliation record (no matched_record_id for ignore)
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'ignore',
        entity_id: null, // No linked record
        matched_amount: txnAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'ignore',
        matched_record_id: null, // No linked record
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: `IGNORED: ${reason}`,
        metadata: {
          ignore_reason: reason,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
    };
  } catch (error) {
    console.error('ignoreBankTransaction exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 7. Get Suggested Matches (delegating to existing function)
// ============================================================================

import { getSuggestedMatches } from './bank-reconciliation-actions';

export { getSuggestedMatches };

// ============================================================================
// 8. Get Available Wallets for Manual Match
// ============================================================================

export async function getAvailableWallets(): Promise<{
  success: boolean;
  wallets?: Array<{ id: string; name: string; wallet_type: string }>;
  error?: string;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data: wallets, error } = await supabase
      .from('wallets')
      .select('id, name, wallet_type')
      .eq('created_by', user.id)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Get wallets error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, wallets: wallets || [] };
  } catch (error) {
    console.error('getAvailableWallets exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 9. Search Expenses for Manual Matching
// ============================================================================

export interface ExpenseSearchResult {
  id: string;
  expense_date: string;
  category: string;
  subcategory: string | null;
  description: string;
  amount: number;
  is_reconciled: boolean;
  match_score: number;
}

export async function searchExpenses(
  keyword: string,
  startDate: Date,
  endDate: Date,
  bankAmount?: number // Optional: for match scoring
): Promise<{ success: boolean; expenses?: ExpenseSearchResult[]; error?: string }> {
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

    // Build query
    let query = supabase
      .from('expenses')
      .select('id, expense_date, category, subcategory, description, amount')
      .eq('created_by', user.id)
      .gte('expense_date', startStr)
      .lte('expense_date', endStr)
      .order('expense_date', { ascending: false })
      .limit(50);

    // Add keyword search if provided
    if (keyword && keyword.trim().length > 0) {
      query = query.or(`description.ilike.%${keyword}%,category.ilike.%${keyword}%,subcategory.ilike.%${keyword}%`);
    }

    const { data: expenses, error: queryError } = await query;

    if (queryError) {
      console.error('Search expenses error:', queryError);
      return { success: false, error: queryError.message };
    }

    if (!expenses || expenses.length === 0) {
      return { success: true, expenses: [] };
    }

    // Get reconciled expense IDs
    const expenseIds = expenses.map((e) => e.id);
    const { data: reconciled } = await supabase
      .from('bank_reconciliations')
      .select('matched_record_id')
      .eq('created_by', user.id)
      .eq('matched_type', 'expense')
      .in('matched_record_id', expenseIds);

    const reconciledIds = new Set(reconciled?.map((r) => r.matched_record_id) || []);

    // Calculate match scores
    const results: ExpenseSearchResult[] = expenses.map((e) => {
      const expenseAmount = Number(e.amount || 0);
      let match_score = 50; // Base score

      if (bankAmount) {
        const bankAbs = Math.abs(bankAmount);
        const isExactMatch = Math.abs(expenseAmount - bankAbs) < 0.01;
        if (isExactMatch) {
          match_score = 100;
        } else if (Math.abs(expenseAmount - bankAbs) < bankAbs * 0.1) {
          match_score = 80; // Within 10%
        }
      }

      return {
        ...e,
        is_reconciled: reconciledIds.has(e.id),
        match_score,
      };
    });

    // Sort by match score (highest first)
    results.sort((a, b) => b.match_score - a.match_score);

    return { success: true, expenses: results };
  } catch (error) {
    console.error('searchExpenses exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// 10. Match Bank Transaction to Existing Expense
// ============================================================================

export async function matchBankTransactionToExpense(
  bankTransactionId: string,
  expenseId: string,
  notes?: string
): Promise<ManualMatchResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    console.log('User authenticated (matchBankTransactionToExpense):', user.id);

    // Verify bank transaction
    const { data: bankTxn, error: txnError } = await supabase
      .from('bank_transactions')
      .select('id, withdrawal, txn_date')
      .eq('id', bankTransactionId)
      .eq('created_by', user.id)
      .single();

    if (txnError || !bankTxn) {
      return { success: false, error: 'Bank transaction not found' };
    }

    // Verify expense
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .select('id, amount, category, description')
      .eq('id', expenseId)
      .eq('created_by', user.id)
      .single();

    if (expenseError || !expense) {
      return { success: false, error: 'Expense not found' };
    }

    // Check if bank transaction already reconciled
    const { data: existingBankMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('bank_transaction_id', bankTransactionId)
      .maybeSingle();

    if (existingBankMatch) {
      return { success: false, error: 'Bank transaction already reconciled' };
    }

    // Check if expense already matched
    const { data: existingExpenseMatch } = await supabase
      .from('bank_reconciliations')
      .select('id')
      .eq('matched_type', 'expense')
      .eq('matched_record_id', expenseId)
      .maybeSingle();

    if (existingExpenseMatch) {
      return { success: false, error: 'Expense already matched' };
    }

    const positiveAmount = Math.abs(Number(bankTxn.withdrawal || 0));

    console.log('Inserting bank_reconciliation (match expense):', {
      bank_transaction_id: bankTransactionId,
      entity_type: 'expense',
      entity_id: expenseId,
      matched_type: 'expense',
      matched_record_id: expenseId,
      created_by: user.id,
    });

    // Create reconciliation
    const { data: reconciliation, error: reconError } = await supabase
      .from('bank_reconciliations')
      .insert({
        // Old columns (backward compatibility)
        entity_type: 'expense',
        entity_id: expenseId,
        matched_amount: positiveAmount,
        matching_rule: 'manual',
        matched_by: user.id,
        matched_at: new Date().toISOString(),

        // New columns (migration-020)
        bank_transaction_id: bankTransactionId,
        matched_type: 'expense',
        matched_record_id: expenseId,
        created_by: user.id,
        created_at: new Date().toISOString(),
        notes: notes || `Manual match to expense: ${expense.category} - ${expense.description}`,
        metadata: {
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          bank_amount: positiveAmount,
        },
      })
      .select('id')
      .single();

    if (reconError) {
      console.error('Create reconciliation error:', reconError);
      console.error('Reconciliation error details:', {
        message: reconError?.message,
        code: reconError?.code,
        details: reconError?.details,
        hint: reconError?.hint,
      });
      return {
        success: false,
        error: `Failed to create reconciliation: ${reconError?.message || 'Unknown error'} (Code: ${reconError?.code || 'N/A'})`,
      };
    }

    return {
      success: true,
      reconciliationId: reconciliation.id,
      createdRecordId: expenseId,
    };
  } catch (error) {
    console.error('matchBankTransactionToExpense exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
