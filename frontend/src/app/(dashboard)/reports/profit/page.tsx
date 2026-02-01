'use client'

/**
 * Profit Reports Page (D1 Suite)
 * Phase: Profit Reports
 *
 * Features:
 * - Global filter (date range, platform)
 * - Section overrides
 * - Lazy loading (D1-A, D1-C)
 * - D1-D: Platform Net Profit
 * - D1-B: Product Profit
 * - D1-A: Platform-Attributed Product Profit (lazy)
 * - D1-C: Source Split (lazy)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { SingleDateRangePicker, DateRangeResult } from '@/components/shared/SingleDateRangePicker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { FileUp, RefreshCw } from 'lucide-react'
import { AffiliateImportDialog } from '@/components/shared/AffiliateImportDialog'
import { ProfitFilters, PlatformNetProfitRow } from '@/types/profit-reports'
import {
  getPlatformNetProfit,
  getProductProfit,
  getSourceSplit
} from './profit-actions'

export default function ProfitReportsPage() {
  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  // Format currency with Thai locale
  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '0.00'
    }
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  // Format percentage
  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined || isNaN(value)) {
      return '0.00'
    }
    return value.toFixed(2)
  }

  // Group platform profit rows by platform and aggregate
  const groupByPlatform = (rows: PlatformNetProfitRow[]) => {
    const grouped = rows.reduce((acc, row) => {
      const platformKey = row.platform
      if (!acc[platformKey]) {
        acc[platformKey] = {
          platform: platformKey,
          gmv: 0,
          platform_fees: 0,
          commission: 0,
          shipping_cost: 0,
          program_fees: 0,
          ads_spend: 0,
          cogs: 0,
          net_profit: 0,
        }
      }
      acc[platformKey].gmv += Number(row.gmv || 0)
      acc[platformKey].platform_fees += Number(row.platform_fees || 0)
      acc[platformKey].commission += Number(row.commission || 0)
      acc[platformKey].shipping_cost += Number(row.shipping_cost || 0)
      acc[platformKey].program_fees += Number(row.program_fees || 0)
      acc[platformKey].ads_spend += Number(row.ads_spend || 0)
      acc[platformKey].cogs += Number(row.cogs || 0)
      acc[platformKey].net_profit += Number(row.net_profit || 0)
      return acc
    }, {} as Record<string, {
      platform: string
      gmv: number
      platform_fees: number
      commission: number
      shipping_cost: number
      program_fees: number
      ads_spend: number
      cogs: number
      net_profit: number
    }>)

    return Object.values(grouped)
  }

  // Get platform display name
  const getPlatformDisplayName = (platform: string) => {
    const platformNames: Record<string, string> = {
      'tiktok_shop': 'TikTok Shop',
      'shopee': 'Shopee',
      'lazada': 'Lazada',
    }
    return platformNames[platform] || platform
  }

  // ============================================
  // STATE: GLOBAL FILTERS
  // ============================================

  const [dateRange, setDateRange] = useState<DateRangeResult | null>(null)
  const [platform, setPlatform] = useState<string>('all')

  // ============================================
  // STATE: SECTION DATA
  // ============================================

  const [d1dData, setD1dData] = useState<any>(null)
  const [d1bData, setD1bData] = useState<any>(null)
  const [d1aData, setD1aData] = useState<any>(null)
  const [d1cData, setD1cData] = useState<any>(null)

  // ============================================
  // STATE: LAZY LOADING
  // ============================================

  const [d1aLoaded, setD1aLoaded] = useState(false)
  const [d1cLoaded, setD1cLoaded] = useState(false)

  // ============================================
  // STATE: LOADING
  // ============================================

  const [d1dLoading, setD1dLoading] = useState(false)
  const [d1bLoading, setD1bLoading] = useState(false)
  const [d1aLoading, setD1aLoading] = useState(false)
  const [d1cLoading, setD1cLoading] = useState(false)

  // ============================================
  // STATE: DIALOGS
  // ============================================

  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // ============================================
  // DEBOUNCE TIMER
  // ============================================

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // ============================================
  // FETCH FUNCTIONS (TODO: Implement API actions)
  // ============================================

  const fetchD1D = useCallback(async () => {
    if (!dateRange) return

    setD1dLoading(true)
    try {
      const result = await getPlatformNetProfit(
        dateRange.startDate,
        dateRange.endDate,
        platform !== 'all' ? platform : undefined
      )
      setD1dData(result)
    } catch (error) {
      console.error('Error fetching D1-D:', error)
    } finally {
      setD1dLoading(false)
    }
  }, [dateRange, platform])

  const fetchD1B = useCallback(async () => {
    if (!dateRange) return

    setD1bLoading(true)
    try {
      const result = await getProductProfit(
        dateRange.startDate,
        dateRange.endDate,
        platform !== 'all' ? platform : undefined
      )
      setD1bData(result)
    } catch (error) {
      console.error('Error fetching D1-B:', error)
    } finally {
      setD1bLoading(false)
    }
  }, [dateRange, platform])

  const fetchD1A = useCallback(async () => {
    if (!dateRange) return

    setD1aLoading(true)
    try {
      // TODO: Call getPlatformAttributedProfit API action
      console.log('Fetching D1-A...', { dateRange, platform })
      // const result = await getPlatformAttributedProfit(dateRange.startDate, dateRange.endDate, platform)
      // setD1aData(result)
    } catch (error) {
      console.error('Error fetching D1-A:', error)
    } finally {
      setD1aLoading(false)
    }
  }, [dateRange, platform])

  const fetchD1C = useCallback(async () => {
    if (!dateRange) return

    setD1cLoading(true)
    try {
      const result = await getSourceSplit(
        dateRange.startDate,
        dateRange.endDate,
        platform !== 'all' ? platform : undefined
      )
      setD1cData(result)
    } catch (error) {
      console.error('Error fetching D1-C:', error)
    } finally {
      setD1cLoading(false)
    }
  }, [dateRange, platform])

  // ============================================
  // EFFECTS: FETCH D1-D AND D1-B (IMMEDIATE)
  // ============================================

  useEffect(() => {
    if (!dateRange) return

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchD1D()
      fetchD1B()
    }, 300)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [fetchD1D, fetchD1B])

  // ============================================
  // HANDLERS: LAZY LOAD
  // ============================================

  const handleLoadD1A = () => {
    setD1aLoaded(true)
    fetchD1A()
  }

  const handleLoadD1C = () => {
    setD1cLoaded(true)
    fetchD1C()
  }

  // ============================================
  // HANDLERS: IMPORT SUCCESS
  // ============================================

  const handleImportSuccess = () => {
    // Refresh all sections
    fetchD1D()
    fetchD1B()
    if (d1aLoaded) fetchD1A()
    if (d1cLoaded) fetchD1C()
  }

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="space-y-6 p-6">
      {/* PAGE HEADER */}
      <div>
        <h1 className="text-3xl font-bold">Profit Reports</h1>
        <p className="text-muted-foreground">
          Comprehensive profit analysis across platforms, products, and channels
        </p>
      </div>

      {/* GLOBAL FILTER BAR */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Global filters applied to all sections</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            {/* Date Range Picker */}
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Date Range</label>
              <SingleDateRangePicker
                defaultRange={dateRange || undefined}
                onChange={setDateRange}
              />
            </div>

            {/* Platform Filter */}
            <div className="w-full md:w-48">
              <label className="text-sm font-medium mb-2 block">Platform</label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="tiktok_shop">TikTok Shop</SelectItem>
                  <SelectItem value="shopee">Shopee</SelectItem>
                  <SelectItem value="lazada">Lazada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="flex items-end gap-2">
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <FileUp className="w-4 h-4 mr-2" />
                Import Affiliate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* D1-D: PLATFORM NET PROFIT */}
      <Card>
        <CardHeader>
          <CardTitle>D1-D: Platform Net Profit</CardTitle>
          <CardDescription>
            GMV - Platform Fees - Commission - Shipping - Program Fees - Ads Spend - COGS
          </CardDescription>
        </CardHeader>
        <CardContent>
          {d1dLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Loading platform net profit...</span>
            </div>
          ) : d1dData?.success && d1dData.data ? (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      Total GMV
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      ฿{formatCurrency(d1dData.data.totalGmv)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      Total Ads Spend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      ฿{formatCurrency(d1dData.data.totalAdsSpend)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      Total COGS
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      ฿{formatCurrency(d1dData.data.totalCogs)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      Total Net Profit
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      ฿{formatCurrency(d1dData.data.totalNetProfit)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Margin: {formatPercent(d1dData.data.avgMargin)}%
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Platform Breakdown Table */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">GMV</TableHead>
                      <TableHead className="text-right">Platform Fees</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Shipping</TableHead>
                      <TableHead className="text-right">Program Fees</TableHead>
                      <TableHead className="text-right">Ads Spend</TableHead>
                      <TableHead className="text-right">COGS</TableHead>
                      <TableHead className="text-right">Net Profit</TableHead>
                      <TableHead className="text-right">Net Margin %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d1dData.data.rows.length > 0 ? (
                      groupByPlatform(d1dData.data.rows).map((row) => {
                        const netMarginPct = row.gmv > 0 ? (row.net_profit / row.gmv) * 100 : 0
                        return (
                          <TableRow key={row.platform}>
                            <TableCell className="font-medium">
                              {getPlatformDisplayName(row.platform)}
                            </TableCell>
                            <TableCell className="text-right">
                              ฿{formatCurrency(row.gmv)}
                            </TableCell>
                            <TableCell className="text-right text-red-600">
                              ฿{formatCurrency(row.platform_fees)}
                            </TableCell>
                            <TableCell className="text-right text-red-600">
                              ฿{formatCurrency(row.commission)}
                            </TableCell>
                            <TableCell className="text-right text-red-600">
                              ฿{formatCurrency(row.shipping_cost)}
                            </TableCell>
                            <TableCell className="text-right text-red-600">
                              ฿{formatCurrency(row.program_fees)}
                            </TableCell>
                            <TableCell className="text-right text-orange-600">
                              ฿{formatCurrency(row.ads_spend)}
                            </TableCell>
                            <TableCell className="text-right text-red-600">
                              ฿{formatCurrency(row.cogs)}
                            </TableCell>
                            <TableCell className={`text-right font-semibold ${row.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              ฿{formatCurrency(row.net_profit)}
                            </TableCell>
                            <TableCell className={`text-right ${netMarginPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatPercent(netMarginPct)}%
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          No data available
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  {d1dData.data.rows.length > 0 && (
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-bold">Total</TableCell>
                        <TableCell className="text-right font-bold">
                          ฿{formatCurrency(d1dData.data.totalGmv)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          ฿{formatCurrency(
                            groupByPlatform(d1dData.data.rows).reduce((sum, r) => sum + r.platform_fees, 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          ฿{formatCurrency(
                            groupByPlatform(d1dData.data.rows).reduce((sum, r) => sum + r.commission, 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          ฿{formatCurrency(
                            groupByPlatform(d1dData.data.rows).reduce((sum, r) => sum + r.shipping_cost, 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          ฿{formatCurrency(
                            groupByPlatform(d1dData.data.rows).reduce((sum, r) => sum + r.program_fees, 0)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-orange-600">
                          ฿{formatCurrency(d1dData.data.totalAdsSpend)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          ฿{formatCurrency(d1dData.data.totalCogs)}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${d1dData.data.totalNetProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ฿{formatCurrency(d1dData.data.totalNetProfit)}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${d1dData.data.avgMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatPercent(d1dData.data.avgMargin)}%
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>

              {/* Timing Info (Dev) */}
              {d1dData._timing && (
                <div className="text-xs text-muted-foreground text-right">
                  Query time: {d1dData._timing.db_ms}ms | Total: {d1dData._timing.total_ms}ms
                </div>
              )}
            </div>
          ) : d1dData?.error ? (
            <div className="text-center text-red-600 py-8">{d1dData.error}</div>
          ) : dateRange ? (
            <div className="text-center text-muted-foreground py-8">No data available</div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Please select a date range to view data
            </div>
          )}
        </CardContent>
      </Card>

      {/* D1-B: PRODUCT PROFIT */}
      <Card>
        <CardHeader>
          <CardTitle>D1-B: Total Product Profit</CardTitle>
          <CardDescription>
            Product Revenue - Allocated Ads Cost - COGS
          </CardDescription>
        </CardHeader>
        <CardContent>
          {d1bLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Loading product profit...</span>
            </div>
          ) : d1bData ? (
            <div>Data loaded (TODO: Render table)</div>
          ) : dateRange ? (
            <div className="text-center text-muted-foreground py-8">No data available</div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Please select a date range to view data
            </div>
          )}
        </CardContent>
      </Card>

      {/* D1-A: PLATFORM-ATTRIBUTED PRODUCT PROFIT (LAZY) */}
      <Card>
        <CardHeader>
          <CardTitle>D1-A: Platform-Attributed Product Profit</CardTitle>
          <CardDescription>
            Platform-attributed GMV - Ads Spend - COGS (approx)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!d1aLoaded ? (
            <div className="text-center py-8">
              <Button onClick={handleLoadD1A}>Load Platform-Attributed Data</Button>
            </div>
          ) : d1aLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Loading platform-attributed data...</span>
            </div>
          ) : d1aData ? (
            <div>Data loaded (TODO: Render table)</div>
          ) : (
            <div className="text-center text-muted-foreground py-8">No data available</div>
          )}
        </CardContent>
      </Card>

      {/* D1-C: SOURCE SPLIT (LAZY) */}
      <Card>
        <CardHeader>
          <CardTitle>D1-C: Source Split</CardTitle>
          <CardDescription>
            Revenue breakdown by source (Internal Affiliate, External Affiliate, Paid Ads, Organic)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!d1cLoaded ? (
            <div className="text-center py-8">
              <Button onClick={handleLoadD1C}>Load Source Split Data</Button>
            </div>
          ) : d1cLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Loading source split data...</span>
            </div>
          ) : d1cData ? (
            <div>Data loaded (TODO: Render table)</div>
          ) : (
            <div className="text-center text-muted-foreground py-8">No data available</div>
          )}
        </CardContent>
      </Card>

      {/* AFFILIATE IMPORT DIALOG */}
      <AffiliateImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </div>
  )
}
