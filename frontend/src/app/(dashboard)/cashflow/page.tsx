'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DateRangeFilter } from '@/components/shared/DateRangeFilter';
import { ImportOnholdDialog } from '@/components/cashflow/ImportOnholdDialog';
import { TrendingUp, DollarSign, AlertCircle, Upload } from 'lucide-react';
import { type DateRangeResult } from '@/lib/date-range';
import {
  getUnsettledSummary,
  getUnsettledTransactions,
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
  const date = new Date(dateStr);
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface UnsettledSummary {
  pending_amount: number;
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

interface ForecastDay {
  date: string;
  expected_amount: number;
  transaction_count: number;
}

export default function CashflowPage() {
  const [dateRange, setDateRange] = useState<DateRangeResult | null>(null);
  const [summary, setSummary] = useState<UnsettledSummary | null>(null);
  const [transactions, setTransactions] = useState<UnsettledTransaction[]>([]);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  useEffect(() => {
    if (dateRange) {
      fetchData();
    }
  }, [dateRange]);

  useEffect(() => {
    fetchNext7DaysForecast();
  }, []);

  const fetchData = async () => {
    if (!dateRange) return;

    try {
      setLoading(true);
      setError(null);

      const [summaryResult, txnsResult] = await Promise.all([
        getUnsettledSummary(dateRange.startDate, dateRange.endDate),
        getUnsettledTransactions(dateRange.startDate, dateRange.endDate),
      ]);

      if (!summaryResult.success) {
        setError(summaryResult.error || 'ไม่สามารถโหลดข้อมูลได้');
        return;
      }

      if (!txnsResult.success) {
        setError(txnsResult.error || 'ไม่สามารถโหลดข้อมูลได้');
        return;
      }

      setSummary(summaryResult.data || { pending_amount: 0, transaction_count: 0 });
      setTransactions(txnsResult.data || []);
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

  const handleImportSuccess = () => {
    setImportDialogOpen(false);
    if (dateRange) {
      fetchData();
    }
    fetchNext7DaysForecast();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Cashflow Forecast</h1>
          <p className="text-muted-foreground">
            ติดตาม Unsettled Transactions และคาดการณ์กระแสเงินสด
          </p>
        </div>
        <Button onClick={() => setImportDialogOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import Onhold (.xlsx)
        </Button>
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
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
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

      {/* Summary Cards */}
      {!loading && summary && dateRange && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Pending to Settle */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Pending to Settle (ช่วงที่เลือก)
              </CardTitle>
              <div className="rounded-lg bg-yellow-50 p-2 text-yellow-600">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                ฿{formatCurrency(summary.pending_amount)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.transaction_count} รายการรอ settle
              </p>
            </CardContent>
          </Card>

          {/* Expected Inflow */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expected Inflow</CardTitle>
              <div className="rounded-lg bg-green-50 p-2 text-green-600">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ฿{formatCurrency(summary.pending_amount)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                คาดว่าจะได้รับในช่วงเวลาที่เลือก
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Unsettled Transactions Table */}
      {!loading && transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Unsettled Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="py-3 px-2 font-medium">Transaction ID</th>
                    <th className="py-3 px-2 font-medium">Related Order</th>
                    <th className="py-3 px-2 font-medium">Estimated Settle Time</th>
                    <th className="py-3 px-2 font-medium text-right">Amount</th>
                    <th className="py-3 px-2 font-medium">Reason</th>
                    <th className="py-3 px-2 font-medium">Last Seen</th>
                    <th className="py-3 px-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr key={txn.id} className="border-b">
                      <td className="py-3 px-2 font-mono text-xs">{txn.txn_id}</td>
                      <td className="py-3 px-2 font-mono text-xs">
                        {txn.related_order_id || '-'}
                      </td>
                      <td className="py-3 px-2">{formatDateTime(txn.estimated_settle_time)}</td>
                      <td className="py-3 px-2 text-right font-mono text-green-600">
                        {txn.currency} {formatCurrency(txn.estimated_settlement_amount || 0)}
                      </td>
                      <td className="py-3 px-2 text-xs">{txn.unsettled_reason || '-'}</td>
                      <td className="py-3 px-2 text-xs">{formatDateTime(txn.last_seen_at)}</td>
                      <td className="py-3 px-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            txn.status === 'unsettled'
                              ? 'bg-yellow-100 text-yellow-700'
                              : txn.status === 'settled'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {txn.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && transactions.length === 0 && dateRange && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              ไม่พบรายการ Unsettled Transactions ในช่วงเวลาที่เลือก
            </p>
          </CardContent>
        </Card>
      )}

      {/* Import Dialog */}
      <ImportOnholdDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
