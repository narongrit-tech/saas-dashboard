'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { ImportAdsDialog } from '@/components/ads/ImportAdsDialog';
import { TrendingUp, DollarSign, ShoppingCart, AlertCircle, Upload } from 'lucide-react';
import { toDateQuery } from '@/lib/date-range';
import { type DateRangeResult } from '@/components/shared/DateRangePicker';
import { getBangkokNow, startOfDayBangkok, formatBangkok } from '@/lib/bangkok-time';
import { getAdsSummary, getAdsPerformance, type CampaignTypeFilter } from '@/app/(dashboard)/ads/actions';

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

interface DailyRollupRow {
  ad_date: string;
  spend: number;
  orders: number;
  revenue: number;
  roas: number;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+07:00`).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function parseCampaignType(rawTab: string | null): CampaignTypeFilter {
  if (rawTab === 'product' || rawTab === 'live' || rawTab === 'all') {
    return rawTab;
  }
  return 'all';
}

function parseDateParam(rawDate: string | null): string | null {
  if (!rawDate) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
}

export function AdsPerformanceOverview() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [dateRange, setDateRange] = useState<DateRangeResult>(() => {
    const startFromUrl = parseDateParam(searchParams.get('start'));
    const endFromUrl = parseDateParam(searchParams.get('end'));

    if (startFromUrl && endFromUrl) {
      return {
        startDate: toDateQuery(startFromUrl, false),
        endDate: toDateQuery(endFromUrl, true),
      };
    }

    const endDate = getBangkokNow();
    const startDate = startOfDayBangkok(new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000));
    return { startDate, endDate };
  });

  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [performance, setPerformance] = useState<AdsPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const latestRequestId = useRef(0);

  const [campaignTypeState, setCampaignTypeState] = useState<CampaignTypeFilter>(
    parseCampaignType(searchParams.get('tab'))
  );

  useEffect(() => {
    const urlTab = parseCampaignType(searchParams.get('tab'));
    if (urlTab !== campaignTypeState) {
      setCampaignTypeState(urlTab);
    }

    const urlStart = parseDateParam(searchParams.get('start'));
    const urlEnd = parseDateParam(searchParams.get('end'));
    if (!urlStart || !urlEnd) return;

    const currentStart = formatBangkok(dateRange.startDate, 'yyyy-MM-dd');
    const currentEnd = formatBangkok(dateRange.endDate, 'yyyy-MM-dd');
    if (currentStart === urlStart && currentEnd === urlEnd) return;

    setDateRange((prev) => ({
      ...prev,
      startDate: toDateQuery(urlStart, false),
      endDate: toDateQuery(urlEnd, true),
    }));
  }, [searchParams, campaignTypeState, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    const startDateString = formatBangkok(dateRange.startDate, 'yyyy-MM-dd');
    const endDateString = formatBangkok(dateRange.endDate, 'yyyy-MM-dd');

    const currentStart = parseDateParam(searchParams.get('start'));
    const currentEnd = parseDateParam(searchParams.get('end'));
    const currentTab = parseCampaignType(searchParams.get('tab'));

    if (
      currentStart === startDateString &&
      currentEnd === endDateString &&
      currentTab === campaignTypeState
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set('start', startDateString);
    params.set('end', endDateString);
    if (campaignTypeState === 'all') {
      params.delete('tab');
    } else {
      params.set('tab', campaignTypeState);
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [campaignTypeState, dateRange, pathname, router, searchParams]);

  useEffect(() => {
    fetchData();
  }, [dateRange, campaignTypeState]);

  const fetchData = async () => {
    latestRequestId.current += 1;
    const currentRequestId = latestRequestId.current;

    try {
      setLoading(true);
      setError(null);

      const startDateString = formatBangkok(dateRange.startDate, 'yyyy-MM-dd');
      const endDateString = formatBangkok(dateRange.endDate, 'yyyy-MM-dd');
      const queryStartDate = toDateQuery(startDateString, false);
      const queryEndDate = toDateQuery(endDateString, true);

      const [summaryResult, perfResult] = await Promise.all([
        getAdsSummary(queryStartDate, queryEndDate, campaignTypeState),
        getAdsPerformance(queryStartDate, queryEndDate, campaignTypeState),
      ]);

      if (currentRequestId !== latestRequestId.current) return;

      if (!summaryResult.success) {
        setError(summaryResult.error || 'ไม่สามารถโหลดข้อมูลได้');
        return;
      }

      if (!perfResult.success) {
        setError(perfResult.error || 'ไม่สามารถโหลดข้อมูลได้');
        return;
      }

      setSummary(
        summaryResult.data || {
          total_spend: 0,
          total_revenue: 0,
          total_orders: 0,
          blended_roi: 0,
        }
      );
      setPerformance(perfResult.data || []);
    } catch (err) {
      if (currentRequestId !== latestRequestId.current) return;
      console.error('Error fetching ads data:', err);
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      if (currentRequestId === latestRequestId.current) {
        setLoading(false);
      }
    }
  };

  const handleImportSuccess = () => {
    fetchData();
  };

  const handleOpenImportDialog = () => {
    setModalInstanceKey((k) => k + 1);
    setImportDialogOpen(true);
  };

  const dailyRollup = useMemo<DailyRollupRow[]>(() => {
    const grouped = new Map<string, DailyRollupRow>();

    for (const row of performance) {
      const key = row.ad_date;
      const existing = grouped.get(key) || {
        ad_date: key,
        spend: 0,
        orders: 0,
        revenue: 0,
        roas: 0,
      };

      existing.spend += Number(row.spend) || 0;
      existing.orders += Number(row.orders) || 0;
      existing.revenue += Number(row.revenue) || 0;
      grouped.set(key, existing);
    }

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        roas: row.spend > 0 ? row.revenue / row.spend : 0,
      }))
      .sort((a, b) => b.ad_date.localeCompare(a.ad_date));
  }, [performance]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Ads Performance Overview</h1>
          <p className="text-muted-foreground">แยก Product GMV Max และ Live GMV Max ตามช่วงวันที่ที่เลือก</p>
        </div>
        <Button onClick={handleOpenImportDialog}>
          <Upload className="mr-2 h-4 w-4" />
          Import Ads Data (.xlsx)
        </Button>
      </div>

      <div className="space-y-4">
        <Tabs value={campaignTypeState} onValueChange={(value) => setCampaignTypeState(value as CampaignTypeFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="product">Product GMV Max</TabsTrigger>
            <TabsTrigger value="live">Live GMV Max</TabsTrigger>
          </TabsList>
        </Tabs>

        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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

      {!loading && summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Spend</CardTitle>
              <div className="rounded-lg bg-red-50 p-2 text-red-600">
                <DollarSign className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">฿{formatCurrency(summary.total_spend)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">GMV</CardTitle>
              <div className="rounded-lg bg-green-50 p-2 text-green-600">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">฿{formatCurrency(summary.total_revenue)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Orders</CardTitle>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <ShoppingCart className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{summary.total_orders.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card className={summary.blended_roi >= 1 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ROAS</CardTitle>
              <div className={`rounded-lg p-2 ${summary.blended_roi >= 1 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${summary.blended_roi >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                {summary.blended_roi.toFixed(2)}x
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && dailyRollup.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Rollup</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="py-3 px-2 font-medium">Date</th>
                    <th className="py-3 px-2 font-medium text-right">Spend</th>
                    <th className="py-3 px-2 font-medium text-right">Orders</th>
                    <th className="py-3 px-2 font-medium text-right">GMV</th>
                    <th className="py-3 px-2 font-medium text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRollup.map((row) => (
                    <tr key={row.ad_date} className="border-b">
                      <td className="py-3 px-2">{formatDate(row.ad_date)}</td>
                      <td className="py-3 px-2 text-right font-mono text-red-600">฿{formatCurrency(row.spend)}</td>
                      <td className="py-3 px-2 text-right font-mono">{row.orders.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right font-mono text-green-600">฿{formatCurrency(row.revenue)}</td>
                      <td className={`py-3 px-2 text-right font-mono font-semibold ${row.roas >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                        {row.roas.toFixed(2)}x
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && performance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Campaign Breakdown</CardTitle>
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
                    <th className="py-3 px-2 font-medium text-right">GMV</th>
                    <th className="py-3 px-2 font-medium text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((row, idx) => (
                    <tr key={`${row.ad_date}-${row.campaign_name || 'unknown'}-${idx}`} className="border-b">
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
                      <td className="py-3 px-2 text-xs">{row.campaign_name || '-'}</td>
                      <td className="py-3 px-2 text-right font-mono text-red-600">฿{formatCurrency(row.spend)}</td>
                      <td className="py-3 px-2 text-right font-mono">{row.orders.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right font-mono text-green-600">฿{formatCurrency(row.revenue)}</td>
                      <td className={`py-3 px-2 text-right font-mono font-semibold ${(row.roi || 0) >= 1 ? 'text-green-600' : 'text-red-600'}`}>
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

      {!loading && performance.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">ไม่พบข้อมูลโฆษณาในช่วงเวลาที่เลือก</p>
          </CardContent>
        </Card>
      )}

      <ImportAdsDialog
        key={modalInstanceKey}
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}

