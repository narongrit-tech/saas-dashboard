'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangeFilter } from '@/components/shared/DateRangeFilter';
import { ImportOnholdDialog } from '@/components/cashflow/ImportOnholdDialog';
import { ImportIncomeDialog } from '@/components/cashflow/ImportIncomeDialog';
import { TrendingUp, DollarSign, AlertCircle, Upload, CheckCircle2, XCircle } from 'lucide-react';
import { type DateRangeResult } from '@/lib/date-range';
import { toZonedTime } from 'date-fns-tz';
import {
  getUnsettledSummary,
  getUnsettledTransactions,
  getSettledSummary,
  getSettledTransactions,
  getOverdueForecast,
  getSettledWithoutForecast,
  getNext7DaysForecast,
} from './actions';

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  // Use Bangkok timezone for date formatting
  const bangkokDate = toZonedTime(new Date(dateStr), 'Asia/Bangkok');
  return bangkokDate.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  // Use Bangkok timezone for date formatting
  const bangkokDate = toZonedTime(new Date(dateStr), 'Asia/Bangkok');
  return bangkokDate.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface UnsettledSummary {
  pending_amount: number;
  transaction_count: number;
}

interface SettledSummary {
  settled_amount: number;
  transaction_count: number;
}

interface UnsettledTransaction {
  id: string;
  txn_id: string;
  related_order_id: string | null;
  estimated_settle_time: string | null;
  estimated_settlement_amount: number | null;
  unsettled_reason: string | null;
  last_seen_at: string;
  status: string;
  currency: string;
}

interface SettledTransaction {
  id: string;
  txn_id: string;
  order_id: string | null;
  settled_time: string | null;
  settlement_amount: number;
  gross_revenue: number | null;
  type: string | null;
  currency: string;
}

interface ForecastDay {
  date: string;
  expected_amount: number;
  transaction_count: number;
}

export default function CashflowPage() {
  const [dateRange, setDateRange] = useState<DateRangeResult | null>(null);
  const [unsettledSummary, setUnsettledSummary] = useState<UnsettledSummary | null>(null);
  const [settledSummary, setSettledSummary] = useState<SettledSummary | null>(null);
  const [unsettledTransactions, setUnsettledTransactions] = useState<UnsettledTransaction[]>([]);
  const [settledTransactions, setSettledTransactions] = useState<SettledTransaction[]>([]);
  const [overdueTransactions, setOverdueTransactions] = useState<UnsettledTransaction[]>([]);
  const [settledWithoutForecast, setSettledWithoutForecast] = useState<SettledTransaction[]>([]);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOnholdDialogOpen, setImportOnholdDialogOpen] = useState(false);
  const [importIncomeDialogOpen, setImportIncomeDialogOpen] = useState(false);

  useEffect(() => {
    if (dateRange) {
      fetchData();
    }
  }, [dateRange]);

  useEffect(() => {
    fetchNext7DaysForecast();
    fetchOverdue();
  }, []);

  const fetchData = async () => {
    if (!dateRange) return;

    try {
      setLoading(true);
      setError(null);

      const [
        unsettledSummaryResult,
        settledSummaryResult,
        unsettledTxnsResult,
        settledTxnsResult,
        settledWithoutForecastResult,
      ] = await Promise.all([
        getUnsettledSummary(dateRange.startDate, dateRange.endDate),
        getSettledSummary(dateRange.startDate, dateRange.endDate),
        getUnsettledTransactions(dateRange.startDate, dateRange.endDate),
        getSettledTransactions(dateRange.startDate, dateRange.endDate),
        getSettledWithoutForecast(dateRange.startDate, dateRange.endDate),
      ]);

      if (!unsettledSummaryResult.success) {
        setError(unsettledSummaryResult.error || 'ไม่สามารถโหลดข้อมูล Forecast ได้');
        return;
      }

      if (!settledSummaryResult.success) {
        setError(settledSummaryResult.error || 'ไม่สามารถโหลดข้อมูล Settled ได้');
        return;
      }

      setUnsettledSummary(
        unsettledSummaryResult.data || { pending_amount: 0, transaction_count: 0 }
      );
      setSettledSummary(settledSummaryResult.data || { settled_amount: 0, transaction_count: 0 });
      setUnsettledTransactions(unsettledTxnsResult.data || []);
      setSettledTransactions(settledTxnsResult.data || []);
      setSettledWithoutForecast(settledWithoutForecastResult.data || []);
    } catch (err) {
      console.error('Error fetching cashflow data:', err);
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const fetchNext7DaysForecast = async () => {
    try {
      const result = await getNext7DaysForecast();
      if (result.success && result.data) {
        setForecast(result.data);
      }
    } catch (err) {
      console.error('Error fetching forecast:', err);
    }
  };

  const fetchOverdue = async () => {
    try {
      const result = await getOverdueForecast();
      if (result.success && result.data) {
        setOverdueTransactions(result.data);
      }
    } catch (err) {
      console.error('Error fetching overdue:', err);
    }
  };

  const handleImportSuccess = () => {
    setImportOnholdDialogOpen(false);
    setImportIncomeDialogOpen(false);
    if (dateRange) {
      fetchData();
    }
    fetchNext7DaysForecast();
    fetchOverdue();
  };

  const gap =
    unsettledSummary && settledSummary
      ? unsettledSummary.pending_amount - settledSummary.settled_amount
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Cashflow Forecast & Actual</h1>
          <p className="text-muted-foreground">
            ติดตามการคาดการณ์และเงินที่ได้รับจริง (Forecast vs Actual)
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

      {/* Date Range Filter */}
      <DateRangeFilter defaultPreset="last7days" onChange={setDateRange} />

      {/* Next 7 Days Forecast (Always visible) */}
      {forecast.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>คาดการณ์ 7 วันถัดไป</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {forecast.map((day) => (
                <div
                  key={day.date}
                  className="flex justify-between items-center py-2 border-b last:border-0"
                >
                  <div>
                    <div className="font-medium">{formatDate(day.date)}</div>
                    <div className="text-sm text-muted-foreground">
                      {day.transaction_count} รายการ
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-green-600">
                    ฿{formatCurrency(day.expected_amount)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-40 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary Cards: Forecast vs Actual */}
      {!loading && unsettledSummary && settledSummary && dateRange && (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Forecast (Pending to Settle) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Forecast (คาดการณ์)</CardTitle>
              <div className="rounded-lg bg-yellow-50 p-2 text-yellow-600">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                ฿{formatCurrency(unsettledSummary.pending_amount)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {unsettledSummary.transaction_count} รายการรอ settle
              </p>
            </CardContent>
          </Card>

          {/* Actual (Settled) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Actual (ที่ได้รับจริง)</CardTitle>
              <div className="rounded-lg bg-green-50 p-2 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ฿{formatCurrency(settledSummary.settled_amount)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {settledSummary.transaction_count} รายการที่ settled แล้ว
              </p>
            </CardContent>
          </Card>

          {/* Gap (Forecast - Actual) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Gap (ส่วนต่าง)</CardTitle>
              <div
                className={`rounded-lg p-2 ${
                  gap >= 0
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  gap >= 0 ? 'text-blue-600' : 'text-red-600'
                }`}
              >
                ฿{formatCurrency(Math.abs(gap))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {gap >= 0 ? 'คาดการณ์สูงกว่า' : 'ได้รับมากกว่าคาดการณ์'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs: Forecast, Actual, Exceptions */}
      {!loading && dateRange && (
        <Tabs defaultValue="forecast" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="forecast">
              Forecast ({unsettledTransactions.length})
            </TabsTrigger>
            <TabsTrigger value="actual">Actual ({settledTransactions.length})</TabsTrigger>
            <TabsTrigger value="exceptions">
              Exceptions ({overdueTransactions.length + settledWithoutForecast.length})
            </TabsTrigger>
          </TabsList>

          {/* Forecast Tab */}
          <TabsContent value="forecast">
            <Card>
              <CardHeader>
                <CardTitle>Unsettled Transactions (Forecast)</CardTitle>
              </CardHeader>
              <CardContent>
                {unsettledTransactions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    ไม่พบรายการ Forecast ในช่วงเวลาที่เลือก
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="py-3 px-2 font-medium">Transaction ID</th>
                          <th className="py-3 px-2 font-medium">Related Order</th>
                          <th className="py-3 px-2 font-medium">Estimated Settle Time</th>
                          <th className="py-3 px-2 font-medium text-right">Amount</th>
                          <th className="py-3 px-2 font-medium">Reason</th>
                          <th className="py-3 px-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unsettledTransactions.map((txn) => (
                          <tr key={txn.id} className="border-b">
                            <td className="py-3 px-2 font-mono text-xs">{txn.txn_id}</td>
                            <td className="py-3 px-2 font-mono text-xs">
                              {txn.related_order_id || '-'}
                            </td>
                            <td className="py-3 px-2">{formatDateTime(txn.estimated_settle_time)}</td>
                            <td className="py-3 px-2 text-right font-mono text-yellow-600">
                              {txn.currency} {formatCurrency(txn.estimated_settlement_amount || 0)}
                            </td>
                            <td className="py-3 px-2 text-xs">{txn.unsettled_reason || '-'}</td>
                            <td className="py-3 px-2">
                              <span className="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-700">
                                {txn.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Actual Tab */}
          <TabsContent value="actual">
            <Card>
              <CardHeader>
                <CardTitle>Settled Transactions (Actual)</CardTitle>
              </CardHeader>
              <CardContent>
                {settledTransactions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    ไม่พบรายการ Settled ในช่วงเวลาที่เลือก
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="py-3 px-2 font-medium">Transaction ID</th>
                          <th className="py-3 px-2 font-medium">Order ID</th>
                          <th className="py-3 px-2 font-medium">Settled Time</th>
                          <th className="py-3 px-2 font-medium text-right">Settlement Amount</th>
                          <th className="py-3 px-2 font-medium text-right">Gross Revenue</th>
                          <th className="py-3 px-2 font-medium">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settledTransactions.map((txn) => (
                          <tr key={txn.id} className="border-b">
                            <td className="py-3 px-2 font-mono text-xs">{txn.txn_id}</td>
                            <td className="py-3 px-2 font-mono text-xs">{txn.order_id || '-'}</td>
                            <td className="py-3 px-2">{formatDateTime(txn.settled_time)}</td>
                            <td className="py-3 px-2 text-right font-mono text-green-600">
                              {txn.currency} {formatCurrency(txn.settlement_amount)}
                            </td>
                            <td className="py-3 px-2 text-right font-mono">
                              {txn.gross_revenue ? formatCurrency(txn.gross_revenue) : '-'}
                            </td>
                            <td className="py-3 px-2 text-xs">{txn.type || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Exceptions Tab */}
          <TabsContent value="exceptions" className="space-y-4">
            {/* Overdue Forecast */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-600" />
                  Overdue Forecast ({overdueTransactions.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {overdueTransactions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    ไม่มีรายการที่เลยกำหนด settle แล้ว
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="py-3 px-2 font-medium">Transaction ID</th>
                          <th className="py-3 px-2 font-medium">Estimated Settle Time</th>
                          <th className="py-3 px-2 font-medium text-right">Amount</th>
                          <th className="py-3 px-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overdueTransactions.map((txn) => (
                          <tr key={txn.id} className="border-b">
                            <td className="py-3 px-2 font-mono text-xs">{txn.txn_id}</td>
                            <td className="py-3 px-2 text-red-600">
                              {formatDateTime(txn.estimated_settle_time)}
                            </td>
                            <td className="py-3 px-2 text-right font-mono">
                              {txn.currency} {formatCurrency(txn.estimated_settlement_amount || 0)}
                            </td>
                            <td className="py-3 px-2 text-xs">{txn.unsettled_reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Settled Without Forecast */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-600" />
                  Settled Without Forecast ({settledWithoutForecast.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {settledWithoutForecast.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    ทุกรายการที่ settled มีการคาดการณ์ไว้แล้ว
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="py-3 px-2 font-medium">Transaction ID</th>
                          <th className="py-3 px-2 font-medium">Settled Time</th>
                          <th className="py-3 px-2 font-medium text-right">Settlement Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settledWithoutForecast.map((txn) => (
                          <tr key={txn.id} className="border-b">
                            <td className="py-3 px-2 font-mono text-xs">{txn.txn_id}</td>
                            <td className="py-3 px-2">{formatDateTime(txn.settled_time)}</td>
                            <td className="py-3 px-2 text-right font-mono text-orange-600">
                              {txn.currency} {formatCurrency(txn.settlement_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

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
