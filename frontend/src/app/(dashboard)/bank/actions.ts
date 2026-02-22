'use server';

// Bank Module Actions
// CRUD operations for bank accounts, transactions, and daily summary
// Created: 2026-01-25

import { createClient } from '@/lib/supabase/server';
import { sanitizeCSVField } from '@/lib/csv';
import { revalidatePath } from 'next/cache';
import {
  BankAccount,
  BankTransaction,
  BankDailySummary,
  BankOpeningBalance,
  BankReportedBalance,
  GetBankAccountsResponse,
  GetBankDailySummaryResponse,
  GetBankTransactionsResponse,
  ExportBankTransactionsResponse,
  GetOpeningBalanceResponse,
  UpsertOpeningBalanceResponse,
  GetReportedBalanceResponse,
  SaveReportedBalanceResponse,
  BankBalanceSummary,
} from '@/types/bank';
import { format } from 'date-fns';
import { formatBangkok } from '@/lib/bangkok-time';

// ============================================================================
// Bank Accounts
// ============================================================================

export async function getBankAccounts(): Promise<GetBankAccountsResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('created_by', user.id)
      .eq('is_active', true)
      .order('bank_name', { ascending: true });

    if (error) {
      console.error('getBankAccounts error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as BankAccount[] };
  } catch (error) {
    console.error('getBankAccounts exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function createBankAccount(data: {
  bank_name: string;
  account_number: string;
  account_type: 'savings' | 'current' | 'fixed_deposit' | 'other';
  currency?: string;
}): Promise<{ success: boolean; account?: BankAccount; error?: string }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data: account, error } = await supabase
      .from('bank_accounts')
      .insert({
        created_by: user.id,
        bank_name: data.bank_name,
        account_number: data.account_number,
        account_type: data.account_type,
        currency: data.currency || 'THB',
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('createBankAccount error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/bank');
    return { success: true, account: account as BankAccount };
  } catch (error) {
    console.error('createBankAccount exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Bank Daily Summary
// ============================================================================

export async function getBankDailySummary(
  bankAccountId: string,
  startDate: Date,
  endDate: Date
): Promise<GetBankDailySummaryResponse> {
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

    // Query bank transactions for date range with pagination
    let allTransactions: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('txn_date, deposit, withdrawal')
        .eq('bank_account_id', bankAccountId)
        .eq('created_by', user.id)
        .gte('txn_date', startStr)
        .lte('txn_date', endStr)
        .order('txn_date', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('getBankDailySummary error:', error);
        return { success: false, error: error.message };
      }

      if (data && data.length > 0) {
        allTransactions = allTransactions.concat(data);
        hasMore = data.length === pageSize;
        from += pageSize;
      } else {
        hasMore = false;
      }
    }

    const transactions = allTransactions;

    // Get opening balance from bank_opening_balances table
    // Find the latest opening balance on or before the start date
    const openingBalanceResponse = await getOpeningBalance(bankAccountId);
    const openingBalanceRecord = openingBalanceResponse.data;
    const openingBalance = openingBalanceRecord ? openingBalanceRecord.opening_balance : 0;
    const openingBalanceDate = openingBalanceRecord ? openingBalanceRecord.as_of_date : null;

    if (!transactions || transactions.length === 0) {
      return {
        success: true,
        data: [],
        opening_balance_used: openingBalance,
        opening_balance_date: openingBalanceDate,
      };
    }

    // Aggregate by date
    const dailyMap = new Map<string, { cash_in: number; cash_out: number; count: number }>();

    transactions.forEach((txn) => {
      const date = txn.txn_date;
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { cash_in: 0, cash_out: 0, count: 0 });
      }
      const day = dailyMap.get(date)!;
      day.cash_in += Number(txn.deposit || 0);
      day.cash_out += Number(txn.withdrawal || 0);
      day.count += 1;
    });

    // Build summary with running balance
    const summary: BankDailySummary[] = [];
    let runningBalance = openingBalance;

    const sortedDates = Array.from(dailyMap.keys()).sort();

    for (const date of sortedDates) {
      const day = dailyMap.get(date)!;
      const net = day.cash_in - day.cash_out;
      runningBalance += net;

      summary.push({
        date,
        cash_in: day.cash_in,
        cash_out: day.cash_out,
        net,
        running_balance: runningBalance,
        transaction_count: day.count,
      });
    }

    return {
      success: true,
      data: summary,
      opening_balance_used: openingBalance,
      opening_balance_date: openingBalanceDate,
    };
  } catch (error) {
    console.error('getBankDailySummary exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Bank Transactions (Raw)
// ============================================================================

export async function getBankTransactions(
  bankAccountId: string,
  filters: {
    startDate?: Date;
    endDate?: Date;
    search?: string;
    page?: number;
    perPage?: number;
  }
): Promise<GetBankTransactionsResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const page = filters.page || 1;
    const perPage = filters.perPage || 50;
    const offset = (page - 1) * perPage;

    let query = supabase
      .from('bank_transactions')
      .select('*', { count: 'exact' })
      .eq('bank_account_id', bankAccountId)
      .eq('created_by', user.id);

    // Date range filter
    if (filters.startDate) {
      query = query.gte('txn_date', format(filters.startDate, 'yyyy-MM-dd'));
    }
    if (filters.endDate) {
      query = query.lte('txn_date', format(filters.endDate, 'yyyy-MM-dd'));
    }

    // Search filter (description)
    if (filters.search && filters.search.trim()) {
      query = query.ilike('description', `%${filters.search.trim()}%`);
    }

    // Pagination
    query = query
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('getBankTransactions error:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        transactions: (data as BankTransaction[]) || [],
        total: count || 0,
      },
    };
  } catch (error) {
    console.error('getBankTransactions exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Export CSV
// ============================================================================

export async function exportBankTransactions(
  bankAccountId: string,
  startDate: Date,
  endDate: Date
): Promise<ExportBankTransactionsResponse> {
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

    // Get bank account name
    const { data: account } = await supabase
      .from('bank_accounts')
      .select('bank_name, account_number')
      .eq('id', bankAccountId)
      .eq('created_by', user.id)
      .single();

    const accountName = account
      ? `${account.bank_name}-${account.account_number}`
      : 'unknown';

    // Query all transactions in date range with pagination
    let allTransactions: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('bank_account_id', bankAccountId)
        .eq('created_by', user.id)
        .gte('txn_date', startStr)
        .lte('txn_date', endStr)
        .order('txn_date', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('exportBankTransactions error:', error);
        return { success: false, error: error.message };
      }

      if (data && data.length > 0) {
        allTransactions = allTransactions.concat(data);
        hasMore = data.length === pageSize;
        from += pageSize;
      } else {
        hasMore = false;
      }
    }

    const transactions = allTransactions;

    if (!transactions || transactions.length === 0) {
      return { success: false, error: 'No transactions found for export' };
    }

    // Get opening balance
    const openingBalanceResponse = await getOpeningBalance(bankAccountId);
    const openingBalanceRecord = openingBalanceResponse.data;
    const openingBalance = openingBalanceRecord ? openingBalanceRecord.opening_balance : 0;
    const openingBalanceDate = openingBalanceRecord ? openingBalanceRecord.as_of_date : null;

    // Generate CSV with running balance
    const headers = [
      'Date',
      'Description',
      'Withdrawal',
      'Deposit',
      'Balance',
      'Running Balance',
      'Channel',
      'Reference ID',
      'Created At',
    ];

    // Calculate running balance
    let runningBalance = openingBalance;
    const rows = transactions.map((txn) => {
      const net = Number(txn.deposit || 0) - Number(txn.withdrawal || 0);
      runningBalance += net;

      return [
        txn.txn_date,
        sanitizeCSVField(txn.description || ''),
        txn.withdrawal || '0.00',
        txn.deposit || '0.00',
        txn.balance || '',
        runningBalance.toFixed(2),
        sanitizeCSVField(txn.channel || ''),
        sanitizeCSVField(txn.reference_id || ''),
        formatBangkok(new Date(txn.created_at), 'yyyy-MM-dd HH:mm:ss'),
      ];
    });

    // Add opening balance info as first comment row
    const openingInfo = openingBalanceDate
      ? `# Opening Balance: ${openingBalance.toFixed(2)} THB (as of ${openingBalanceDate})`
      : `# Opening Balance: ${openingBalance.toFixed(2)} THB (default)`;

    const csv = [openingInfo, headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    const timestamp = formatBangkok(new Date(), 'yyyyMMdd-HHmmss');
    const filename = `bank-${accountName}-${timestamp}.csv`;

    return { success: true, csv, filename };
  } catch (error) {
    console.error('exportBankTransactions exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Bank Opening Balance
// ============================================================================

/**
 * Get opening balance for a bank account
 * Returns the opening balance record for the bank account
 * @param bankAccountId - Bank account ID
 */
export async function getOpeningBalance(
  bankAccountId: string
): Promise<GetOpeningBalanceResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Get the opening balance record (one per user per bank account)
    const { data, error } = await supabase
      .from('bank_opening_balances')
      .select('*')
      .eq('user_id', user.id)
      .eq('bank_account_id', bankAccountId)
      .maybeSingle();

    if (error) {
      console.error('getOpeningBalance error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as BankOpeningBalance | null };
  } catch (error) {
    console.error('getOpeningBalance exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Upsert opening balance for a bank account
 * Creates new or updates existing opening balance (one per user per bank account)
 */
export async function upsertOpeningBalance(
  bankAccountId: string,
  asOfDate: string,
  openingBalance: number
): Promise<UpsertOpeningBalanceResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Verify bank account ownership
    const { data: account, error: accountError } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('id', bankAccountId)
      .eq('created_by', user.id)
      .single();

    if (accountError || !account) {
      return { success: false, error: 'Bank account not found or unauthorized' };
    }

    // Check if record exists first
    const { data: existing } = await supabase
      .from('bank_opening_balances')
      .select('id')
      .eq('user_id', user.id)
      .eq('bank_account_id', bankAccountId)
      .maybeSingle();

    let result;
    let upsertError;

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('bank_opening_balances')
        .update({
          as_of_date: asOfDate,
          opening_balance: openingBalance,
        })
        .eq('id', existing.id)
        .select()
        .single();
      result = data;
      upsertError = error;
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('bank_opening_balances')
        .insert({
          user_id: user.id,
          bank_account_id: bankAccountId,
          as_of_date: asOfDate,
          opening_balance: openingBalance,
        })
        .select()
        .single();
      result = data;
      upsertError = error;
    }

    if (upsertError) {
      console.error('Upsert opening balance error:', upsertError);
      return { success: false, error: upsertError.message };
    }

    // Revalidate all related paths (opening balance affects all views)
    revalidatePath('/bank');
    revalidatePath('/company-cashflow');
    revalidatePath('/bank-reconciliation');
    revalidatePath('/reconciliation');

    return { success: true, data: result as BankOpeningBalance };
  } catch (error) {
    console.error('upsertOpeningBalance exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Bank Reported Balance
// ============================================================================

/**
 * Get the latest reported balance for a bank account
 * @param bankAccountId - Bank account ID
 * @param asOfDate - Optional specific date to query (YYYY-MM-DD)
 */
export async function getReportedBalance(
  bankAccountId: string,
  asOfDate?: string
): Promise<GetReportedBalanceResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    let query = supabase
      .from('bank_reported_balances')
      .select('*')
      .eq('user_id', user.id)
      .eq('bank_account_id', bankAccountId);

    if (asOfDate) {
      query = query.eq('reported_as_of_date', asOfDate);
    }

    query = query.order('reported_as_of_date', { ascending: false }).limit(1);

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('getReportedBalance error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data as BankReportedBalance | null };
  } catch (error) {
    console.error('getReportedBalance exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Save a new bank reported balance
 * @param bankAccountId - Bank account ID
 * @param reportedAsOfDate - Date of the reported balance (YYYY-MM-DD)
 * @param reportedBalance - Balance as reported by the bank
 */
export async function saveReportedBalance(
  bankAccountId: string,
  reportedAsOfDate: string,
  reportedBalance: number
): Promise<SaveReportedBalanceResponse> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Verify bank account ownership
    const { data: account, error: accountError } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('id', bankAccountId)
      .eq('created_by', user.id)
      .single();

    if (accountError || !account) {
      return { success: false, error: 'Bank account not found or unauthorized' };
    }

    // Insert new reported balance record
    const { data: result, error: insertError } = await supabase
      .from('bank_reported_balances')
      .insert({
        user_id: user.id,
        bank_account_id: bankAccountId,
        reported_as_of_date: reportedAsOfDate,
        reported_balance: reportedBalance,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Save reported balance error:', insertError);
      return { success: false, error: insertError.message };
    }

    // Revalidate all related paths
    revalidatePath('/bank');
    revalidatePath('/company-cashflow');
    revalidatePath('/bank-reconciliation');
    revalidatePath('/reconciliation');

    return { success: true, data: result as BankReportedBalance };
  } catch (error) {
    console.error('saveReportedBalance exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Bank Balance Summary (with Delta Calculation)
// ============================================================================

/**
 * Get bank balance summary with delta calculation
 * Returns: opening balance, net movement, expected closing, reported balance, and delta
 * @param bankAccountId - Bank account ID
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 */
export async function getBankBalanceSummary(
  bankAccountId: string,
  startDate: string,
  endDate: string
): Promise<{ success: boolean; data?: BankBalanceSummary; error?: string }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Get opening balance
    const openingBalanceResponse = await getOpeningBalance(bankAccountId);
    const openingBalance = openingBalanceResponse.data
      ? openingBalanceResponse.data.opening_balance
      : 0;

    // Get transactions in date range with pagination
    let allTransactions: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('deposit, withdrawal')
        .eq('bank_account_id', bankAccountId)
        .eq('created_by', user.id)
        .gte('txn_date', startDate)
        .lte('txn_date', endDate)
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('getBankBalanceSummary error:', error);
        return { success: false, error: error.message };
      }

      if (data && data.length > 0) {
        allTransactions = allTransactions.concat(data);
        hasMore = data.length === pageSize;
        from += pageSize;
      } else {
        hasMore = false;
      }
    }

    const transactions = allTransactions;

    // Calculate net movement
    let totalDeposits = 0;
    let totalWithdrawals = 0;

    if (transactions && transactions.length > 0) {
      transactions.forEach((txn) => {
        totalDeposits += Number(txn.deposit || 0);
        totalWithdrawals += Number(txn.withdrawal || 0);
      });
    }

    const netMovement = totalDeposits - totalWithdrawals;
    const expectedClosingBalance = openingBalance + netMovement;

    // Get reported balance (latest within or up to end date)
    const reportedBalanceResponse = await getReportedBalance(bankAccountId);
    const reportedBalanceRecord = reportedBalanceResponse.data;

    const reportedBalance = reportedBalanceRecord
      ? reportedBalanceRecord.reported_balance
      : null;
    const reportedAsOfDate = reportedBalanceRecord
      ? reportedBalanceRecord.reported_as_of_date
      : null;

    // Calculate delta (null if no reported balance)
    const delta =
      reportedBalance !== null ? reportedBalance - expectedClosingBalance : null;

    const summary: BankBalanceSummary = {
      opening_balance: openingBalance,
      net_movement: netMovement,
      expected_closing_balance: expectedClosingBalance,
      reported_balance: reportedBalance,
      delta: delta,
      reported_as_of_date: reportedAsOfDate,
    };

    return { success: true, data: summary };
  } catch (error) {
    console.error('getBankBalanceSummary exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
