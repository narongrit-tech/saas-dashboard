'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker, type DateRangeResult } from '@/components/shared/DateRangePicker';
import { ImportOnholdDialog } from '@/components/cashflow/ImportOnholdDialog';
import { ImportIncomeDialog } from '@/components/cashflow/ImportIncomeDialog';
import {
  TrendingUp,
  DollarSign,
  AlertCircle,
  Upload,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { toZonedTime } from 'date-fns-tz';
import {
  getCashflowSummary,
  getDailyCashflowSummary,
  getCashflowTransactions,
  rebuildCashflowSummary,
} from './cashflow-api-actions';
import type {
  CashflowSummary,
  DailySummaryResponse,
  TransactionType,
  TransactionsResponse,
  TransactionRow,
} from '@/types/cashflow-api';
import { toBangkokDateString } from '@/lib/bangkok-date-range';

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  // Parse date string as local date (YYYY-MM-DD from database)
  // CRITICAL: Don't use new Date() as it treats YYYY-MM-DD as UTC midnight
  // which can shift the date when converted to Bangkok timezone
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const bangkokDate = toZonedTime(new Date(dateStr), 'Asia/Bangkok');
  return bangkokDate.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get default date range (today in Bangkok timezone)
 */
function getDefaultRange(): DateRangeResult {
  // Get current date/time in Bangkok timezone
  const now = toZonedTime(new Date(), 'Asia/Bangkok');

  // Start of today (Bangkok)
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  return {
    startDate: startOfDay,
    endDate: now,
    preset: 'today',
  };
}

export default function CashflowPageV3() {
  // Date range
  const [dateRange, setDateRange] = useState<DateRangeResult>(getDefaultRange());

  // Summary cards (fast)
  const [summary, setSummary] = useState<CashflowSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Daily summary table (PRIMARY CONTENT)
  const [dailySummary, setDailySummary] = useState<DailySummaryResponse | null>(null);
  const [dailySummaryLoading, setDailySummaryLoading] = useState(false);
  const [dailySummaryError, setDailySummaryError] = useState<string | null>(null);
  const [dailyPage, setDailyPage] = useState(1);

  // Transaction tabs (SECONDARY - lazy load)
  const [activeTab, setActiveTab] = useState<TransactionType | null>(null);
  const [transactions, setTransactions] = useState<TransactionsResponse | null>(null);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [transactionsPage, setTransactionsPage] = useState(1);

  // Dialogs
  const [importOnholdDialogOpen, setImportOnholdDialogOpen] = useState(false);
  const [importIncomeDialogOpen, setImportIncomeDialogOpen] = useState(false);

  // Debounce timer
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ============================================
  // FETCH SUMMARY CARDS
  // ============================================
  const fetchSummary = useCallback(async () => {
    if (!dateRange) return;

    try {
      setSummaryLoading(true);
      setSummaryError(null);

      const result = await getCashflowSummary(dateRange.startDate, dateRange.endDate);
      setSummary(result);

      if (result._timing) {
        console.log(`[Summary Cards] ${result._timing.total_ms}ms`);
      }
    } catch (err) {
      console.error('Error fetching summary:', err);
      setSummaryError('ไม่สามารถโหลดสรุปข้อมูลได้');
    } finally {
      setSummaryLoading(false);
    }
  }, [dateRange]);

  // ============================================
  // FETCH DAILY SUMMARY TABLE (PRIMARY)
  // ============================================
  const fetchDailySummary = useCallback(async () => {
    if (!dateRange) return;

    try {
      setDailySummaryLoading(true);
      setDailySummaryError(null);

      const result = await getDailyCashflowSummary(
        dateRange.startDate,
        dateRange.endDate,
        dailyPage,
        14 // 14 rows per page
      );

      setDailySummary(result);
    } catch (err) {
      console.error('Error fetching daily summary:', err);
      setDailySummaryError('ไม่สามารถโหลดตารางรายวันได้');
    } finally {
      setDailySummaryLoading(false);
    }
  }, [dateRange, dailyPage]);

  // ============================================
  // FETCH TRANSACTIONS (SECONDARY - lazy)
  // ============================================
  const fetchTransactions = useCallback(async () => {
    if (!dateRange || !activeTab) return;

    try {
      setTransactionsLoading(true);
      setTransactionsError(null);

      const result = await getCashflowTransactions({
        type: activeTab,
        startDate: toBangkokDateString(dateRange.startDate),
        endDate: toBangkokDateString(dateRange.endDate),
        page: transactionsPage,
        pageSize: 50,
        sortBy: 'date',
        sortOrder: 'desc',
      });

      setTransactions(result);
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setTransactionsError('ไม่สามารถโหลดรายการได้');
    } finally {
      setTransactionsLoading(false);
    }
  }, [dateRange, activeTab, transactionsPage]);

  // ============================================
  // EFFECTS
  // ============================================

  // Fetch summary + daily table when date changes (debounced 300ms)
  useEffect(() => {
    if (!dateRange) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSummary();
      fetchDailySummary();
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [fetchSummary, fetchDailySummary]);

  // Fetch transactions ONLY when tab clicked
  useEffect(() => {
    if (activeTab) {
      fetchTransactions();
    }
  }, [fetchTransactions]);

  // ============================================
  // HANDLERS
  // ============================================

  const handleImportSuccess = async () => {
    setImportOnholdDialogOpen(false);
    setImportIncomeDialogOpen(false);

    if (dateRange) {
      try {
        await rebuildCashflowSummary({
          startDate: toBangkokDateString(dateRange.startDate),
          endDate: toBangkokDateString(dateRange.endDate),
        });
        console.log('[Cashflow] Summary rebuilt');
      } catch (err) {
        console.error('[Cashflow] Failed to rebuild:', err);
      }

      fetchSummary();
      fetchDailySummary();
      if (activeTab) {
        fetchTransactions();
      }
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as TransactionType);
    setTransactionsPage(1);
  };

  const handleDailyPageChange = (newPage: number) => {
    setDailyPage(newPage);
  };

  const handleTransactionsPageChange = (newPage: number) => {
    setTransactionsPage(newPage);
  };

  const gap = summary ? summary.gap_total : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Marketplace Wallet Cashflow</h1>
          <p className="text-muted-foreground">
            เงินเข้า–ออกจากแพลตฟอร์มขาย (TikTok Shop, Shopee, Lazada)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOnholdDialogOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Forecast
          </Button>
          <Button onClick={() => setImportIncomeDialogOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Actual
          </Button>
        </div>
      </div>

      {/* Single Date Range Picker */}
      <DateRangePicker value={dateRange} onChange={setDateRange} allowFutureDates={true} />

      {/* Marketplace Filter (Placeholder for future multi-marketplace support) */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Marketplace:</label>
        <Select disabled defaultValue="tiktok">
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select marketplace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tiktok">TikTok Shop</SelectItem>
            {/* TODO: support multi-marketplace wallets (TikTok, Shopee, Lazada) */}
          </SelectContent>
        </Select>
      </div>

      {/* Definition Info Box */}
      <Alert className="border-blue-200 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-gray-700">
          <strong>Marketplace Wallets</strong> คือเงินที่แพลตฟอร์มขายถือไว้ชั่วคราว
          เช่น TikTok Shop ก่อนโอนเข้าบัญชีบริษัท
          หน้านี้ยังไม่ใช่ Cashflow ทั้งบริษัท
          และยังไม่รวมค่าใช้จ่ายหรือเงินสดในบัญชีบริษัท
        </AlertDescription>
      </Alert>

      {/* Summary Cards */}
      {summaryError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{summaryError}</AlertDescription>
        </Alert>
      )}

      {summaryLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Forecast Total</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">฿{formatCurrency(summary?.forecast_total || 0)}</div>
              <p className="text-xs text-muted-foreground">{summary?.forecast_count || 0} รายการ</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Actual Total</CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">฿{formatCurrency(summary?.actual_total || 0)}</div>
              <p className="text-xs text-muted-foreground">{summary?.actual_count || 0} รายการ</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Gap</CardTitle>
              {gap >= 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${gap >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ฿{formatCurrency(Math.abs(gap))}
              </div>
              <p className="text-xs text-muted-foreground">
                {gap >= 0 ? 'Actual > Forecast' : 'Actual < Forecast'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Exceptions</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.exceptions_count || 0}</div>
              <p className="text-xs text-muted-foreground">
                Overdue: {summary?.overdue_count || 0}, Unmatched: {summary?.forecast_only_count || 0}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* PRIMARY SECTION: Daily Cash In Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Cash In Summary (Forecast vs Actual)</CardTitle>
          <p className="text-sm text-muted-foreground">
            แสดงตามวันเงินเข้าจริง (เวลาประเทศไทย – Asia/Bangkok)
          </p>
        </CardHeader>
        <CardContent>
          {dailySummaryError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{dailySummaryError}</AlertDescription>
            </Alert>
          )}

          {dailySummaryLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : dailySummary && dailySummary.rows.length > 0 ? (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Forecast
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actual</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gap</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {dailySummary.rows.map((row) => {
                      const statusConfig = {
                        actual_over: { label: 'Actual > Forecast', color: 'text-green-600 bg-green-50' },
                        pending: { label: 'Pending', color: 'text-yellow-600 bg-yellow-50' },
                        actual_only: { label: 'Actual only', color: 'text-blue-600 bg-blue-50' },
                        forecast_only: { label: 'Forecast only', color: 'text-gray-600 bg-gray-50' },
                      };

                      const status = statusConfig[row.status];

                      return (
                        <tr key={row.date} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium">{formatDate(row.date)}</td>
                          <td className="px-4 py-3 text-sm text-right">
                            ฿{formatCurrency(row.forecast_sum)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-semibold">
                            ฿{formatCurrency(row.actual_sum)}
                          </td>
                          <td
                            className={`px-4 py-3 text-sm text-right font-semibold ${
                              row.gap >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {row.gap >= 0 ? '+' : ''}฿{formatCurrency(row.gap)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${status.color}`}
                            >
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {(dailyPage - 1) * 14 + 1}-
                  {Math.min(dailyPage * 14, dailySummary.pagination.totalCount)} of{' '}
                  {dailySummary.pagination.totalCount} days
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDailyPageChange(dailyPage - 1)}
                    disabled={dailyPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {dailyPage} of {dailySummary.pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDailyPageChange(dailyPage + 1)}
                    disabled={dailyPage === dailySummary.pagination.totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">No data for selected date range</div>
          )}
        </CardContent>
      </Card>

      {/* SECONDARY SECTION: Raw Transaction Lists */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction Details (Drill-down)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Click a tab to view raw transaction rows (lazy loaded)
          </p>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab || ''} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="forecast">Forecast ({summary?.forecast_count || 0})</TabsTrigger>
              <TabsTrigger value="actual">Actual ({summary?.actual_count || 0})</TabsTrigger>
              <TabsTrigger value="exceptions">Exceptions ({summary?.exceptions_count || 0})</TabsTrigger>
            </TabsList>

            {activeTab && (
              <TabsContent value={activeTab} className="mt-4">
                {transactionsError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{transactionsError}</AlertDescription>
                  </Alert>
                )}

                {transactionsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : transactions && transactions.rows.length > 0 ? (
                  <>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              Transaction ID
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              Date
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                              Amount
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              Type
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              Platform
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {transactions.rows.map((row: TransactionRow) => (
                            <tr key={row.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-mono">{row.txn_id}</td>
                              <td className="px-4 py-3 text-sm">{formatDateTime(row.date)}</td>
                              <td className="px-4 py-3 text-sm text-right font-semibold">
                                ฿{formatCurrency(row.amount)}
                              </td>
                              <td className="px-4 py-3 text-sm">{row.type || '-'}</td>
                              <td className="px-4 py-3 text-sm uppercase">{row.marketplace}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between mt-4">
                      <div className="text-sm text-muted-foreground">
                        Showing {(transactionsPage - 1) * 50 + 1}-
                        {Math.min(transactionsPage * 50, transactions.pagination.totalCount)} of{' '}
                        {transactions.pagination.totalCount} transactions
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTransactionsPageChange(transactionsPage - 1)}
                          disabled={transactionsPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <span className="text-sm">
                          Page {transactionsPage} of {transactions.pagination.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTransactionsPageChange(transactionsPage + 1)}
                          disabled={transactionsPage === transactions.pagination.totalPages}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No transactions</div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>

      {/* Import Dialogs */}
      <ImportOnholdDialog
        open={importOnholdDialogOpen}
        onOpenChange={setImportOnholdDialogOpen}
        onSuccess={handleImportSuccess}
      />
      <ImportIncomeDialog
        open={importIncomeDialogOpen}
        onOpenChange={setImportIncomeDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
