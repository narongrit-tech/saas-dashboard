import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Megaphone, AlertCircle } from 'lucide-react'
import { format, subDays, parseISO, isValid } from 'date-fns'
import { getPerformanceDashboard, getExpensePickerTotal } from './actions'
import type { GmvBasis, CogsBasis } from './actions'
import { getBangkokNow } from '@/lib/bangkok-time'
import { PerformanceTrendChart } from '@/components/dashboard/PerformanceTrendChart'
import { AdsBreakdownSection } from '@/components/dashboard/AdsBreakdownSection'
import { DateRangePickerClient } from '@/components/dashboard/DateRangePickerClient'
import { BasisToggleClient } from '@/components/dashboard/BasisToggleClient'
import { OperatingNetCards } from '@/components/dashboard/OperatingNetCards'
import { CogsCard } from '@/components/dashboard/CogsCard'
import { parsePickerState } from '@/lib/expense-picker'

export const dynamic = 'force-dynamic'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function isValidDateParam(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = parseISO(s)
  if (!isValid(d)) return false
  if (d.getFullYear() < 2020) return false
  const today = getBangkokNow()
  today.setHours(23, 59, 59, 999)
  return d <= today
}

export default async function PerformanceDashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  // Resolve date range — fall back to last 7 days (Bangkok) if params missing/invalid
  const today = getBangkokNow()
  const defaultFrom = format(subDays(today, 6), 'yyyy-MM-dd')
  const defaultTo = format(today, 'yyyy-MM-dd')

  const fromRaw = Array.isArray(searchParams.from) ? searchParams.from[0] : searchParams.from
  const toRaw   = Array.isArray(searchParams.to)   ? searchParams.to[0]   : searchParams.to
  const from = isValidDateParam(fromRaw) ? fromRaw : defaultFrom
  const to   = isValidDateParam(toRaw)   ? toRaw   : defaultTo

  // Resolve basis params — strict whitelist, default to canonical values
  const gmvBasisRaw  = Array.isArray(searchParams.gmvBasis)  ? searchParams.gmvBasis[0]  : searchParams.gmvBasis
  const cogsBasisRaw = Array.isArray(searchParams.cogsBasis) ? searchParams.cogsBasis[0] : searchParams.cogsBasis
  const gmvBasis:  GmvBasis  = gmvBasisRaw  === 'paid'    ? 'paid'    : 'created'
  const cogsBasis: CogsBasis = cogsBasisRaw === 'created' ? 'created' : 'shipped'

  // Parse picker states from URL params
  const opState  = parsePickerState(searchParams, 'op',  'ALL')
  const taxState = parsePickerState(searchParams, 'tax', 'Tax')

  // Fetch all data in parallel
  const [result, opResult, taxResult] = await Promise.all([
    getPerformanceDashboard(from, to, gmvBasis, cogsBasis),
    getExpensePickerTotal(from, to, opState),
    getExpensePickerTotal(from, to, taxState),
  ])

  if (!result.success || !result.data) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <p className="text-lg font-semibold">เกิดข้อผิดพลาด</p>
          </div>
          <p className="text-sm text-muted-foreground">{result.error || 'ไม่สามารถโหลดข้อมูลได้'}</p>
        </div>
      </div>
    )
  }

  const { summary, trend } = result.data

  // Picker-computed totals (server-side, URL-persisted)
  const displayOp  = opResult.data?.total  ?? summary.operating
  const displayTax = taxResult.data?.total ?? summary.tax
  const displayNet = Math.round((summary.gmv - summary.adSpend - summary.cogs - displayOp - displayTax) * 100) / 100
  const isProfit   = displayNet >= 0

  // Build flat search params map to pass to client component (for URL manipulation)
  const allSearchParamsFlat: Record<string, string> = {}
  Object.entries(searchParams).forEach(([k, v]) => {
    if (v !== undefined) allSearchParamsFlat[k] = Array.isArray(v) ? v[0] : v
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Performance Dashboard</h1>
          <p className="text-muted-foreground">
            {summary.startDate} – {summary.endDate} · Asia/Bangkok
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DateRangePickerClient from={from} to={to} />
          <BasisToggleClient gmvBasis={gmvBasis} cogsBasis={cogsBasis} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* GMV */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GMV {gmvBasis === 'paid' ? '(Paid Date)' : '(Order Date)'}</CardTitle>
            <div className="rounded-lg bg-green-50 p-2 text-green-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ฿{formatCurrency(summary.gmv)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {gmvBasis === 'created' ? 'ยอดขายตามวันสร้างออเดอร์' : 'ยอดขายตามวันชำระเงิน'}
            </p>
          </CardContent>
        </Card>

        {/* Ad Spend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ad Spend (ช่วงที่เลือก)</CardTitle>
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
              <Megaphone className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              ฿{formatCurrency(summary.adSpend)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">ค่าโฆษณา (Performance)</p>
          </CardContent>
        </Card>

        {/* COGS — clickable, opens drilldown modal */}
        <CogsCard
          amount={summary.cogs}
          cogsBasis={cogsBasis}
          from={from}
          to={to}
        />

        {/* Operating + Tax + Net Profit — client component (both cards open picker modals) */}
        <OperatingNetCards
          initialOp={displayOp}
          initialTax={displayTax}
          initialOpState={opState}
          initialTaxState={taxState}
          gmv={summary.gmv}
          adSpend={summary.adSpend}
          cogs={summary.cogs}
          from={from}
          to={to}
          allSearchParams={allSearchParamsFlat}
        />

        {/* ROAS */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ROAS (ช่วงที่เลือก)</CardTitle>
            <div className="rounded-lg bg-yellow-50 p-2 text-yellow-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {summary.roas.toFixed(2)}x
            </div>
            <p className="text-xs text-muted-foreground mt-1">GMV / Ad Spend</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            Trend: GMV{gmvBasis === 'paid' ? ' (Paid)' : ''} vs Ad Spend vs Net Profit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PerformanceTrendChart data={trend} />
        </CardContent>
      </Card>

      {/* Ads Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Ads Breakdown (Performance)</CardTitle>
        </CardHeader>
        <CardContent>
          <AdsBreakdownSection from={from} to={to} />
        </CardContent>
      </Card>

      {/* P&L Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>
            P&L Breakdown
            {(gmvBasis !== 'created' || cogsBasis !== 'shipped') && (
              <span className="ml-2 text-sm font-normal text-amber-600">· Mixed basis</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">GMV ({gmvBasis === 'paid' ? 'Paid Date' : 'Order Date'})</span>
              <span className="font-mono text-green-600">
                ฿{formatCurrency(summary.gmv)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: Ad Spend</span>
              <span className="font-mono text-red-600">
                (฿{formatCurrency(summary.adSpend)})
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: COGS ({cogsBasis === 'created' ? 'Order Date' : 'Shipped'})</span>
              <span className="font-mono text-red-600">
                (฿{formatCurrency(summary.cogs)})
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: Operating Expenses</span>
              <span className="font-mono text-red-600">(฿{formatCurrency(displayOp)})</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">Less: Tax</span>
              <span className="font-mono text-red-600">(฿{formatCurrency(displayTax)})</span>
            </div>
            <div className="flex justify-between border-t-2 pt-3">
              <span className="text-lg font-bold">Net Profit</span>
              <span className={`text-lg font-bold font-mono ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                {isProfit ? '' : '-'}฿{formatCurrency(Math.abs(displayNet))}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
