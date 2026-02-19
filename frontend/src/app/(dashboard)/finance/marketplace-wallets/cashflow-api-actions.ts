'use server';

import { createClient } from '@/lib/supabase/server';
import { formatBangkok } from '@/lib/bangkok-time';
import type {
  CashflowSummary,
  TransactionsRequest,
  TransactionsResponse,
  RebuildSummaryRequest,
  RebuildSummaryResponse,
  DailyAggregate,
  TransactionRow,
} from '@/types/cashflow-api';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Get aggregated cashflow summary (FAST - no raw rows)
 */
export async function getCashflowSummary(
  startDate: Date,
  endDate: Date
): Promise<CashflowSummary> {
  const startTime = Date.now();
  let dbTime = 0;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  // Try to read from pre-aggregated table first
  // NOTE: Removed created_by filter to support service role imports (internal dashboard - single tenant)
  const dbStart = Date.now();
  const { data: dailySummary, error: summaryError } = await supabase
    .from('cashflow_daily_summary')
    .select('*')
    .gte('date', formatBangkok(startDate, 'yyyy-MM-dd'))
    .lte('date', formatBangkok(endDate, 'yyyy-MM-dd'))
    .order('date', { ascending: true });

  dbTime += Date.now() - dbStart;

  if (summaryError) {
    console.error('[Cashflow Summary] Pre-aggregated query failed:', summaryError);
    throw new Error('Failed to load cashflow summary');
  }

  // If no pre-aggregated data, fallback to raw queries (slower)
  if (!dailySummary || dailySummary.length === 0) {
    if (IS_DEV) {
      console.warn('[Cashflow Summary] No pre-aggregated data, falling back to raw queries');
    }
    return await getCashflowSummaryFallback(user.id, startDate, endDate, dbTime, startTime);
  }

  // Aggregate from daily summary
  let forecast_total = 0;
  let forecast_count = 0;
  let actual_total = 0;
  let actual_count = 0;
  let matched_count = 0;
  let overdue_count = 0;
  let forecast_only_count = 0;
  let actual_only_count = 0;

  const daily_aggregate: DailyAggregate[] = dailySummary.map((row) => {
    forecast_total += Number(row.forecast_sum);
    forecast_count += row.forecast_count;
    actual_total += Number(row.actual_sum);
    actual_count += row.actual_count;
    matched_count += row.matched_count;
    overdue_count += row.overdue_count;
    forecast_only_count += row.forecast_only_count;
    actual_only_count += row.actual_only_count;

    return {
      date: row.date,
      forecast_sum: Number(row.forecast_sum),
      actual_sum: Number(row.actual_sum),
      gap_sum: Number(row.gap_sum),
    };
  });

  const gap_total = actual_total - forecast_total;
  const exceptions_count = overdue_count + forecast_only_count + actual_only_count;

  const totalTime = Date.now() - startTime;

  if (IS_DEV) {
    console.log(`[Cashflow Summary] Total: ${totalTime}ms, DB: ${dbTime}ms`);
  }

  return {
    forecast_total,
    forecast_count,
    actual_total,
    actual_count,
    gap_total,
    matched_count,
    overdue_count,
    forecast_only_count,
    actual_only_count,
    exceptions_count,
    daily_aggregate,
    ...(IS_DEV && {
      _timing: {
        total_ms: totalTime,
        db_ms: dbTime,
      },
    }),
  };
}

/**
 * Fallback: Calculate summary from raw data (slower, used when pre-aggregation missing)
 */
async function getCashflowSummaryFallback(
  userId: string,
  startDate: Date,
  endDate: Date,
  initialDbTime: number,
  startTime: number
): Promise<CashflowSummary> {
  let dbTime = initialDbTime;
  const supabase = await createClient();

  // Query forecast (removed created_by filter)
  // Use Bangkok date strings to match database timezone bucketing
  const startDateStr = formatBangkok(startDate, 'yyyy-MM-dd');
  const endDateStr = formatBangkok(endDate, 'yyyy-MM-dd');

  const dbStart1 = Date.now();
  const { data: forecastData } = await supabase
    .from('unsettled_transactions')
    .select('estimated_settle_time, estimated_settlement_amount')
    .eq('status', 'unsettled')
    .gte('estimated_settle_time', `${startDateStr}T00:00:00+07:00`)
    .lte('estimated_settle_time', `${endDateStr}T23:59:59+07:00`);
  dbTime += Date.now() - dbStart1;

  // Query actual (removed created_by filter)
  const dbStart2 = Date.now();
  const { data: actualData } = await supabase
    .from('settlement_transactions')
    .select('settled_time, settlement_amount')
    .gte('settled_time', `${startDateStr}T00:00:00+07:00`)
    .lte('settled_time', `${endDateStr}T23:59:59+07:00`);
  dbTime += Date.now() - dbStart2;

  // Aggregate manually
  const forecast_total = (forecastData || []).reduce(
    (sum, r) => sum + Number(r.estimated_settlement_amount || 0),
    0
  );
  const forecast_count = (forecastData || []).length;
  const actual_total = (actualData || []).reduce(
    (sum, r) => sum + Number(r.settlement_amount || 0),
    0
  );
  const actual_count = (actualData || []).length;
  const gap_total = actual_total - forecast_total;

  const totalTime = Date.now() - startTime;

  if (IS_DEV) {
    console.log(`[Cashflow Summary Fallback] Total: ${totalTime}ms, DB: ${dbTime}ms`);
  }

  return {
    forecast_total,
    forecast_count,
    actual_total,
    actual_count,
    gap_total,
    matched_count: 0,
    overdue_count: 0,
    forecast_only_count: 0,
    actual_only_count: 0,
    exceptions_count: 0,
    daily_aggregate: [],
    ...(IS_DEV && {
      _timing: {
        total_ms: totalTime,
        db_ms: dbTime,
      },
    }),
  };
}

/**
 * Get paginated transaction rows (LAZY LOAD - called when tab clicked)
 */
export async function getCashflowTransactions(
  req: TransactionsRequest
): Promise<TransactionsResponse> {
  const startTime = Date.now();
  let dbTime = 0;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const page = req.page || 1;
  const pageSize = req.pageSize || 50;
  const offset = (page - 1) * pageSize;
  const sortBy = req.sortBy || 'date';
  const sortOrder = req.sortOrder || 'desc';

  let query;
  let countQuery;
  let dateField: string;
  let amountField: string;

  // Removed created_by filter to support service role imports
  if (req.type === 'forecast') {
    dateField = 'estimated_settle_time';
    amountField = 'estimated_settlement_amount';
    query = supabase
      .from('unsettled_transactions')
      .select('id, txn_id, type, estimated_settle_time, estimated_settlement_amount, currency, status, marketplace')
      .neq('status', 'settled') // Show all except settled (includes unsettled, pending, null)
      .gte(dateField, req.startDate)
      .lte(dateField, req.endDate);

    countQuery = supabase
      .from('unsettled_transactions')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'settled') // Show all except settled
      .gte(dateField, req.startDate)
      .lte(dateField, req.endDate);
  } else if (req.type === 'actual') {
    dateField = 'settled_time';
    amountField = 'settlement_amount';
    query = supabase
      .from('settlement_transactions')
      .select('id, txn_id, type, settled_time, settlement_amount, currency, marketplace')
      .gte(dateField, req.startDate)
      .lte(dateField, req.endDate);

    countQuery = supabase
      .from('settlement_transactions')
      .select('id', { count: 'exact', head: true })
      .gte(dateField, req.startDate)
      .lte(dateField, req.endDate);
  } else {
    // exceptions: forecast without match or overdue
    dateField = 'estimated_settle_time';
    amountField = 'estimated_settlement_amount';
    query = supabase
      .from('unsettled_transactions')
      .select('id, txn_id, type, estimated_settle_time, estimated_settlement_amount, currency, status, marketplace')
      .eq('status', 'unsettled')
      .gte(dateField, req.startDate)
      .lte(dateField, req.endDate);

    countQuery = supabase
      .from('unsettled_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'unsettled')
      .gte(dateField, req.startDate)
      .lte(dateField, req.endDate);
  }

  // Sort
  if (sortBy === 'date') {
    query = query.order(dateField, { ascending: sortOrder === 'asc' });
  } else if (sortBy === 'amount') {
    query = query.order(amountField, { ascending: sortOrder === 'asc' });
  }

  // Paginate
  query = query.range(offset, offset + pageSize - 1);

  // Execute queries
  const dbStart1 = Date.now();
  const { data: rows, error: queryError } = await query;
  dbTime += Date.now() - dbStart1;

  const dbStart2 = Date.now();
  const { count, error: countError } = await countQuery;
  dbTime += Date.now() - dbStart2;

  if (queryError || countError) {
    console.error('[Cashflow Transactions] Query failed:', queryError || countError);
    throw new Error('Failed to load transactions');
  }

  // Map to TransactionRow
  const mappedRows: TransactionRow[] = (rows || []).map((r: any) => ({
    id: r.id,
    txn_id: r.txn_id,
    type: r.type || null,
    date: r.estimated_settle_time || r.settled_time,
    amount: Number(r.estimated_settlement_amount || r.settlement_amount || 0),
    currency: r.currency || 'THB',
    status: r.status,
    marketplace: r.marketplace || 'tiktok',
  }));

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const totalTime = Date.now() - startTime;

  if (IS_DEV) {
    console.log(`[Cashflow Transactions] Type: ${req.type}, Page: ${page}, Total: ${totalTime}ms, DB: ${dbTime}ms`);
  }

  return {
    rows: mappedRows,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages,
    },
    ...(IS_DEV && {
      _timing: {
        total_ms: totalTime,
        db_ms: dbTime,
      },
    }),
  };
}

/**
 * Get daily cashflow summary table (PRIMARY VIEW - answers "เงินจะเข้าแต่ละวันเท่าไหร่?")
 */
export async function getDailyCashflowSummary(
  startDate: Date,
  endDate: Date,
  page: number = 1,
  pageSize: number = 14
): Promise<{
  rows: Array<{
    date: string;
    forecast_sum: number;
    actual_sum: number;
    gap: number;
    status: 'actual_over' | 'pending' | 'actual_only' | 'forecast_only';
  }>;
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}> {
  const startTime = Date.now();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const offset = (page - 1) * pageSize;

  // Use Bangkok date strings to match database timezone
  const startDateStr = formatBangkok(startDate, 'yyyy-MM-dd');
  const endDateStr = formatBangkok(endDate, 'yyyy-MM-dd');

  // Count total rows (removed created_by filter)
  const { count } = await supabase
    .from('cashflow_daily_summary')
    .select('id', { count: 'exact', head: true })
    .gte('date', startDateStr)
    .lte('date', endDateStr);

  // Fetch paginated data (removed created_by filter)
  const { data, error } = await supabase
    .from('cashflow_daily_summary')
    .select('date, forecast_sum, actual_sum, gap_sum')
    .gte('date', startDateStr)
    .lte('date', endDateStr)
    .order('date', { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (error) {
    console.error('[Daily Summary Table] Query failed:', error);
    throw new Error('Failed to load daily summary');
  }

  // Compute status in frontend
  const rows = (data || []).map((row) => {
    const forecast = Number(row.forecast_sum);
    const actual = Number(row.actual_sum);
    const gap = Number(row.gap_sum);

    let status: 'actual_over' | 'pending' | 'actual_only' | 'forecast_only';

    if (actual > forecast) {
      status = 'actual_over'; // green
    } else if (forecast > actual && actual > 0) {
      status = 'pending'; // yellow
    } else if (actual > 0 && forecast === 0) {
      status = 'actual_only'; // blue
    } else {
      status = 'forecast_only'; // gray
    }

    return {
      date: row.date,
      forecast_sum: forecast,
      actual_sum: actual,
      gap,
      status,
    };
  });

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  if (IS_DEV) {
    console.log(`[Daily Summary Table] Loaded ${rows.length} rows in ${Date.now() - startTime}ms`);
  }

  return {
    rows,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages,
    },
  };
}

/**
 * Rebuild cashflow daily summary (ADMIN/DEV)
 */
export async function rebuildCashflowSummary(
  req: RebuildSummaryRequest
): Promise<RebuildSummaryResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  // Convert to Bangkok date strings (YYYY-MM-DD) to match database timezone
  const startDateStr = typeof req.startDate === 'string'
    ? req.startDate
    : formatBangkok(new Date(req.startDate), 'yyyy-MM-dd');
  const endDateStr = typeof req.endDate === 'string'
    ? req.endDate
    : formatBangkok(new Date(req.endDate), 'yyyy-MM-dd');

  const { data, error } = await supabase.rpc('rebuild_cashflow_daily_summary', {
    p_user_id: user.id,
    p_start_date: startDateStr,
    p_end_date: endDateStr,
  });

  if (error) {
    console.error('[Rebuild Summary] Failed:', error);
    throw new Error('Failed to rebuild summary');
  }

  return {
    success: true,
    rows_affected: data || 0,
    message: `Rebuilt ${data || 0} daily summary rows`,
  };
}
