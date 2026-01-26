'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SingleDateRangePicker, type DateRangeResult } from '@/components/shared/SingleDateRangePicker';
import { ImportAdsDialog } from '@/components/ads/ImportAdsDialog';
import { TrendingUp, DollarSign, ShoppingCart, AlertCircle, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { getAdsSummary, getAdsPerformance } from './actions';

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface AdsSummary {
  total_spend: number;
  total_revenue: number;
  total_orders: number;
  blended_roi: number;
}

interface AdsPerformance {
  ad_date: string;
  campaign_type: string | null;
  campaign_name: string | null;
  spend: number;
  orders: number;
  revenue: number;
  roi: number | null;
}

export default function AdsPage() {
  const [dateRange, setDateRange] = useState<DateRangeResult | null>(null);
  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [performance, setPerformance] = useState<AdsPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  useEffect(() => {
    if (dateRange) {
      fetchData();
    }
  }, [dateRange]);

  const fetchData = async () => {
    if (!dateRange) return;

    console.log('[ADS_PAGE] Fetching data for date range:', {
      startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
      endDate: format(dateRange.endDate, 'yyyy-MM-dd'),
    });

    try {
      setLoading(true);
      setError(null);

      const [summaryResult, perfResult] = await Promise.all([
        getAdsSummary(dateRange.startDate, dateRange.endDate),
        getAdsPerformance(dateRange.startDate, dateRange.endDate),
      ]);

      console.log('[ADS_PAGE] Summary result:', summaryResult);
      console.log('[ADS_PAGE] Performance result:', {
        success: perfResult.success,
        rowCount: perfResult.data?.length || 0,
      });

      if (!summaryResult.success) {
        setError(summaryResult.error || 'ไม่สามารถโหลดข้อมูลได้');
        return;
      }

      if (!perfResult.success) {
        setError(perfResult.error || 'ไม่สามารถโหลดข้อมูลได้');
        return;
      }

      const summaryData = summaryResult.data || {
        total_spend: 0,
        total_revenue: 0,
        total_orders: 0,
        blended_roi: 0,
      };

      console.log('[ADS_PAGE] Setting state:', {
        summary: summaryData,
        performanceRowCount: perfResult.data?.length || 0,
      });

      setSummary(summaryData);
      setPerformance(perfResult.data || []);
    } catch (err) {
      console.error('[ADS_PAGE] Error fetching ads data:', err);
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const handleImportSuccess = () => {
    setImportDialogOpen(false);
    if (dateRange) {
      fetchData();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Ads Performance</h1>
          <p className="text-muted-foreground">ติดตามประสิทธิภาพโฆษณา TikTok รายวัน</p>
        </div>
        <Button onClick={() => setImportDialogOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import Ads Data (.xlsx)
        </Button>
      </div>

      {/* Date Range Filter */}
      <SingleDateRangePicker
        presets={[
          {
            label: 'วันนี้',
            getValue: () => {
              const today = new Date();
              return { startDate: today, endDate: today };
            },
          },
          {
            label: '7 วันล่าสุด',
            getValue: () => {
              const now = new Date();
              const start = new Date(now);
              start.setDate(start.getDate() - 6);
              return { startDate: start, endDate: now };
            },
          },
          {
            label: '30 วันล่าสุด',
            getValue: () => {
              const now = new Date();
              const start = new Date(now);
              start.setDate(start.getDate() - 29);
              return { startDate: start, endDate: now };
            },
          },
        ]}
        onChange={setDateRange}
      />

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
        <div className="grid gap-4 md:grid-cols-4">
          {/* Total Spend */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
              <div className="rounded-lg bg-red-50 p-2 text-red-600">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                ฿{formatCurrency(summary.total_spend)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">ค่าโฆษณาทั้งหมด</p>
            </CardContent>
          </Card>

          {/* Total Revenue */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <div className="rounded-lg bg-green-50 p-2 text-green-600">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ฿{formatCurrency(summary.total_revenue)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">ยอดขายจากโฆษณา</p>
            </CardContent>
          </Card>

          {/* Total Orders */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <ShoppingCart className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{summary.total_orders}</div>
              <p className="text-xs text-muted-foreground mt-1">ออเดอร์ทั้งหมด</p>
            </CardContent>
          </Card>

          {/* Blended ROI */}
          <Card
            className={
              summary.blended_roi >= 1 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
            }
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Blended ROI</CardTitle>
              <div
                className={`rounded-lg p-2 ${
                  summary.blended_roi >= 1
                    ? 'bg-green-100 text-green-600'
                    : 'bg-red-100 text-red-600'
                }`}
              >
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  summary.blended_roi >= 1 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {summary.blended_roi.toFixed(2)}x
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.blended_roi >= 1 ? '✓ กำไร' : '✗ ขาดทุน'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Performance Table */}
      {!loading && performance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ads Performance by Date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="py-3 px-2 font-medium">Date</th>
                    <th className="py-3 px-2 font-medium">Campaign Type</th>
                    <th className="py-3 px-2 font-medium">Campaign Name</th>
                    <th className="py-3 px-2 font-medium text-right">Spend</th>
                    <th className="py-3 px-2 font-medium text-right">Orders</th>
                    <th className="py-3 px-2 font-medium text-right">Revenue</th>
                    <th className="py-3 px-2 font-medium text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((row, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="py-3 px-2">{formatDate(row.ad_date)}</td>
                      <td className="py-3 px-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            row.campaign_type === 'live'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {row.campaign_type || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-xs max-w-xs truncate">{row.campaign_name || '-'}</td>
                      <td className="py-3 px-2 text-right font-mono text-red-600">
                        ฿{formatCurrency(row.spend)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono">{row.orders}</td>
                      <td className="py-3 px-2 text-right font-mono text-green-600">
                        ฿{formatCurrency(row.revenue)}
                      </td>
                      <td
                        className={`py-3 px-2 text-right font-mono font-semibold ${
                          (row.roi || 0) >= 1 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {row.roi ? `${row.roi.toFixed(2)}x` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && performance.length === 0 && dateRange && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              ไม่พบข้อมูลโฆษณาในช่วงเวลาที่เลือก
            </p>
          </CardContent>
        </Card>
      )}

      {/* Import Dialog */}
      <ImportAdsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
