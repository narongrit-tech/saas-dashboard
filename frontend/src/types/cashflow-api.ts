// Cashflow API Types (Performance-Optimized)

// ============================================
// SUMMARY ENDPOINT
// ============================================

export interface CashflowSummary {
  // Totals
  forecast_total: number;
  forecast_count: number;
  actual_total: number;
  actual_count: number;
  gap_total: number;

  // Status counts
  matched_count: number;
  overdue_count: number;
  forecast_only_count: number;
  actual_only_count: number;
  exceptions_count: number; // overdue + forecast_only + actual_only

  // Daily breakdown for chart (aggregated)
  daily_aggregate: DailyAggregate[];

  // Timing (dev only)
  _timing?: {
    total_ms: number;
    db_ms: number;
  };
}

export interface DailyAggregate {
  date: string; // ISO date (YYYY-MM-DD)
  forecast_sum: number;
  actual_sum: number;
  gap_sum: number;
}

// ============================================
// TRANSACTIONS ENDPOINT (PAGINATED)
// ============================================

export type TransactionType = 'forecast' | 'actual' | 'exceptions';

export interface TransactionsRequest {
  type: TransactionType;
  startDate: string; // ISO date
  endDate: string; // ISO date
  page?: number;
  pageSize?: number;
  sortBy?: 'date' | 'amount';
  sortOrder?: 'asc' | 'desc';
}

export interface TransactionsResponse {
  rows: TransactionRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  _timing?: {
    total_ms: number;
    db_ms: number;
  };
}

export interface TransactionRow {
  id: string;
  txn_id: string;
  type: string | null;
  date: string; // ISO datetime
  amount: number;
  currency: string;
  status?: string; // for forecast: unsettled/settled
  marketplace: string;
}

// ============================================
// REBUILD SUMMARY (ADMIN/DEV)
// ============================================

export interface RebuildSummaryRequest {
  startDate: string;
  endDate: string;
}

export interface RebuildSummaryResponse {
  success: boolean;
  rows_affected: number;
  message: string;
}

// ============================================
// DAILY SUMMARY TABLE
// ============================================

export interface DailySummaryRow {
  date: string;
  forecast_sum: number;
  actual_sum: number;
  gap: number;
  status: 'actual_over' | 'pending' | 'actual_only' | 'forecast_only';
}

export interface DailySummaryResponse {
  rows: DailySummaryRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  _timing?: {
    total_ms: number;
    db_ms: number;
  };
}
