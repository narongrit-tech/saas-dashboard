'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getProfit, runProfitRefresh, type ProfitRow } from '../actions'

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n: number | null): string {
  if (n === null) return '—'
  return `${fmt(n * 100, 1)}%`
}

function RoiIcon({ roi }: { roi: number | null }) {
  if (roi === null) return <Minus className="h-3.5 w-3.5 text-muted-foreground inline" />
  if (roi >= 0) return <TrendingUp className="h-3.5 w-3.5 text-emerald-600 inline" />
  return <TrendingDown className="h-3.5 w-3.5 text-red-500 inline" />
}

type RefreshResult = {
  attribution_row_count: number
  cost_allocation_row_count: number
  summary_row_count: number
  unallocated_cost_row_count: number
}

export default function ProfitPage() {
  const [rows, setRows] = useState<ProfitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [isPending, startTransition] = useTransition()
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await getProfit()
    setRows(data)
    setListError(error)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function handleRefresh() {
    setRefreshError(null)
    setRefreshResult(null)
    startTransition(async () => {
      const result = await runProfitRefresh()
      if (!result.success) {
        setRefreshError(result.error)
        return
      }
      setRefreshResult(result.result)
      await load()
    })
  }

  // Aggregate totals
  const totals = rows.reduce(
    (acc, r) => ({
      gmv_realized: acc.gmv_realized + r.gmv_realized,
      commission_realized: acc.commission_realized + r.commission_realized,
      total_cost: acc.total_cost + r.total_cost,
      profit: acc.profit + r.profit,
      total_orders: acc.total_orders + r.total_orders,
    }),
    { gmv_realized: 0, commission_realized: 0, total_cost: 0, profit: 0, total_orders: 0 }
  )

  // True when summary rows exist but no costs have been entered — profit = commission only
  const noCostData = rows.length > 0 && totals.total_cost === 0

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/tiktok-affiliate">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Overview
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Profit Summary</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            content_profit_attribution_summary — {rows.length} row{rows.length !== 1 ? 's' : ''}. Commission minus allocated costs.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleRefresh}
          disabled={isPending}
          variant="default"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isPending ? 'animate-spin' : ''}`} />
          {isPending ? 'Refreshing…' : 'Run refresh'}
        </Button>
      </div>

      {/* Refresh result */}
      {refreshResult && (
        <Card className="border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20">
          <CardContent className="py-3 px-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2">Refresh complete</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'Attribution rows', value: refreshResult.attribution_row_count },
                { label: 'Cost allocations', value: refreshResult.cost_allocation_row_count },
                { label: 'Summary rows', value: refreshResult.summary_row_count },
                { label: 'Unallocated costs', value: refreshResult.unallocated_cost_row_count },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums text-sm">{value.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {refreshResult.unallocated_cost_row_count > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                {refreshResult.unallocated_cost_row_count} cost row{refreshResult.unallocated_cost_row_count !== 1 ? 's' : ''} unallocated — cost_date may not match any order data.{' '}
                <Link href="/content-ops/tiktok-affiliate/verification" className="underline">Verify</Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {refreshError && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {refreshError}
        </div>
      )}

      {listError && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {listError}
        </div>
      )}

      {/* No-cost-data banner — shown when summary exists but all costs are zero */}
      {noCostData && (
        <div className="flex items-start gap-2 text-sm border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 rounded-md px-3 py-2.5">
          <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-amber-900 dark:text-amber-200">No cost data — profit equals commission only</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              All rows show total_cost = 0. Add costs and run a refresh to compute real profit.{' '}
              <Link href="/content-ops/tiktok-affiliate/costs" className="underline hover:text-amber-900">
                Add costs →
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* KPI strip */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'GMV realized', value: fmt(totals.gmv_realized), sub: `${totals.total_orders.toLocaleString()} orders` },
            { label: 'Commission', value: fmt(totals.commission_realized), sub: 'realized only' },
            { label: 'Total cost', value: fmt(totals.total_cost), sub: 'ads + creator + misc' },
            {
              label: 'Net profit',
              value: fmt(totals.profit),
              sub: totals.total_cost > 0
                ? `ROI ${fmtPct(totals.commission_realized > 0 ? totals.profit / totals.total_cost : null)}`
                : 'no cost data',
              highlight: totals.profit >= 0 ? 'text-emerald-600' : 'text-red-500',
            },
          ].map(({ label, value, sub, highlight }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
                <p className={`text-xl font-semibold tabular-nums mt-1 ${highlight ?? ''}`}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && !listError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No profit data</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              To get meaningful profit: (1){' '}
              <Link href="/content-ops/tiktok-affiliate/costs" className="underline hover:text-foreground">
                add costs
              </Link>
              , (2) run refresh. Without cost data, profit will equal commission only.
            </p>
            <Button size="sm" className="mt-2" onClick={handleRefresh} disabled={isPending}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isPending ? 'animate-spin' : ''}`} />
              {isPending ? 'Refreshing…' : 'Run refresh now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">GMV realized</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Ads cost</TableHead>
                    <TableHead className="text-right">Creator cost</TableHead>
                    <TableHead className="text-right">Other cost</TableHead>
                    <TableHead className="text-right">Total cost</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">ROI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={`${row.content_id}-${row.product_id}-${row.currency}-${i}`}>
                      <TableCell>
                        <Link
                          href={`/content-ops/tiktok-affiliate/attribution?content_id=${row.content_id}`}
                          className="text-sm font-mono hover:underline text-primary"
                        >
                          {row.content_id}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{row.product_id}</TableCell>
                      <TableCell className="text-xs">{row.currency}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        <div className="text-sm">{row.total_orders}</div>
                        {(row.open_orders > 0 || row.lost_orders > 0) && (
                          <div className="text-xs text-muted-foreground">
                            {row.open_orders > 0 && <span className="text-blue-600">{row.open_orders} open</span>}
                            {row.open_orders > 0 && row.lost_orders > 0 && ' · '}
                            {row.lost_orders > 0 && <span className="text-red-500">{row.lost_orders} lost</span>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.gmv_realized)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.commission_realized)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fmt(row.ads_cost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fmt(row.creator_cost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fmt(row.other_cost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.total_cost)}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm font-medium ${row.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {fmt(row.profit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        <span className="flex items-center justify-end gap-1">
                          <RoiIcon roi={row.roi} />
                          {fmtPct(row.roi)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
        <span>Profit = commission_realized − total_cost.</span>
        <span>ROI = profit / total_cost (null when no costs).</span>
        <Link href="/content-ops/tiktok-affiliate/costs" className="underline hover:text-foreground">Manage costs →</Link>
        <Link href="/content-ops/tiktok-affiliate/verification" className="underline hover:text-foreground">Run verification →</Link>
      </div>
    </div>
  )
}
