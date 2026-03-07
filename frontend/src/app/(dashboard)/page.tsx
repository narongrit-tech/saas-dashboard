import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Megaphone, AlertCircle, Wallet } from 'lucide-react'
import { format, subDays, parseISO, isValid } from 'date-fns'
import { getPerformanceDashboard, getExpensePickerTotal, getMarketplaceCashIn, getBankInflowRevenueTotal } from './actions'
import type { GmvBasis, CogsBasis, RevenueBasis, BankInflowRevenueTotals } from './actions'
import { getBangkokNow } from '@/lib/bangkok-time'
import { PerformanceTrendChart } from '@/components/dashboard/PerformanceTrendChart'
import { AdsBreakdownSection } from '@/components/dashboard/AdsBreakdownSection'
import { DateRangePickerClient } from '@/components/dashboard/DateRangePickerClient'
import { BasisToggleClient } from '@/components/dashboard/BasisToggleClient'
import { OperatingNetCards } from '@/components/dashboard/OperatingNetCards'
import { CogsCard } from '@/components/dashboard/CogsCard'
import { BankRevenueCard } from '@/components/dashboard/BankRevenueCard'
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

function sp(searchParams: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = searchParams[key]
  return Array.isArray(v) ? v[0] : v
}

export default async function PerformanceDashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  // ── Date range ──────────────────────────────────────────────────────────────
  const today = getBangkokNow()
  const defaultFrom = format(subDays(today, 6), 'yyyy-MM-dd')
  const defaultTo   = format(today, 'yyyy-MM-dd')

  const from = isValidDateParam(sp(searchParams, 'from')) ? sp(searchParams, 'from')! : defaultFrom
  const to   = isValidDateParam(sp(searchParams, 'to'))   ? sp(searchParams, 'to')!   : defaultTo

  // ── Basis params — strict whitelist ─────────────────────────────────────────
  const gmvBasis:     GmvBasis     = sp(searchParams, 'gmvBasis')  === 'paid'    ? 'paid'    : 'created'
  const cogsBasis:    CogsBasis    = sp(searchParams, 'cogsBasis') === 'created' ? 'created' : 'shipped'
  const _rawRevBasis = sp(searchParams, 'revBasis')
  const revenueBasis: RevenueBasis = _rawRevBasis === 'cashin' ? 'cashin' : _rawRevBasis === 'bank' ? 'bank' : 'gmv'

  // ── Expense picker states from URL ───────────────────────────────────────────
  const opState      = parsePickerState(searchParams, 'op',      'ALL')
  const taxState     = parsePickerState(searchParams, 'tax',     'Tax')
  const cogsExpState = parsePickerState(searchParams, 'cogsExp', 'COGS')
  if (cogsExpState.category !== 'COGS') cogsExpState.category = 'COGS'

  // ── Fetch all data in parallel ───────────────────────────────────────────────
  const [result, opResult, taxResult, cogsExpResult, cashInResult, bankInflowResult] = await Promise.all([
    getPerformanceDashboard(from, to, gmvBasis, cogsBasis),
    getExpensePickerTotal(from, to, opState),
    getExpensePickerTotal(from, to, taxState),
    getExpensePickerTotal(from, to, cogsExpState),
    revenueBasis === 'cashin'
      ? getMarketplaceCashIn(from, to)
      : Promise.resolve({ success: true as const, data: { total: 0, tiktok: 0, shopee: 0 } }),
    revenueBasis === 'bank'
      ? getBankInflowRevenueTotal(from, to)
      : Promise.resolve({ success: true as const, data: { total: 0, tiktok: 0, shopee: 0, other: 0 } as BankInflowRevenueTotals }),
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

  // ── Computed display values ──────────────────────────────────────────────────
  const displayOp      = opResult.data?.total      ?? summary.operating
  const displayTax     = taxResult.data?.total     ?? summary.tax
  const displayCogsExp = cogsExpResult.data?.total ?? 0
  const displayCogs    = summary.cogs + displayCogsExp

  const cashInData    = cashInResult.success ? cashInResult.data : undefined
  const displayCashIn = cashInData?.total ?? 0
  const bankInflowData    = bankInflowResult.success ? bankInflowResult.data : undefined
  const displayBankInflow = bankInflowData?.total ?? 0
  // displayRevenue: the "top line" used for Net Profit, ROAS, P&L breakdown
  const displayRevenue = revenueBasis === 'cashin' ? displayCashIn : revenueBasis === 'bank' ? displayBankInflow : summary.gmv

  const displayNet = Math.round((displayRevenue - summary.adSpend - displayCogs - displayOp - displayTax) * 100) / 100
  const isProfit   = displayNet >= 0
  const displayRoas = summary.adSpend > 0 ? Math.round((displayRevenue / summary.adSpend) * 100) / 100 : 0

  // ── Flat URL params for client components ────────────────────────────────────
  const allSearchParamsFlat: Record<string, string> = {}
  Object.entries(searchParams).forEach(([k, v]) => {
    if (v !== undefined) allSearchParamsFlat[k] = Array.isArray(v) ? v[0] : v
  })

  // ── Labels ───────────────────────────────────────────────────────────────────
  const revenueCardTitle = revenueBasis === 'cashin'
    ? 'Cash In (เงินเข้าจริง)'
    : revenueBasis === 'bank'
    ? 'Bank Inflows (Selected)'
    : `GMV ${gmvBasis === 'paid' ? '(Paid Date)' : '(Order Date)'}`

  const revenueCardSub = revenueBasis === 'cashin'
    ? `TikTok ฿${formatCurrency(cashInData?.tiktok ?? 0)} + Shopee ฿${formatCurrency(cashInData?.shopee ?? 0)}`
    : revenueBasis === 'bank'
    ? 'คลิกที่การ์ดเพื่อเลือกรายการ'
    : gmvBasis === 'created' ? 'ยอดขายตามวันสร้างออเดอร์' : 'ยอดขายตามวันชำระเงิน'

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
          <BasisToggleClient gmvBasis={gmvBasis} cogsBasis={cogsBasis} revenueBasis={revenueBasis} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">

        {/* Revenue Card — Bank basis renders interactive client card; others static */}
        {revenueBasis === 'bank' ? (
          <BankRevenueCard
            initialTotal={displayBankInflow}
            initialBreakdown={bankInflowData ?? { total: 0, tiktok: 0, shopee: 0, other: 0 }}
            from={from}
            to={to}
          />
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{revenueCardTitle}</CardTitle>
              <div className={`rounded-lg p-2 ${revenueBasis === 'cashin' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                {revenueBasis === 'cashin' ? <Wallet className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${revenueBasis === 'cashin' ? 'text-blue-600' : 'text-green-600'}`}>
                ฿{formatCurrency(displayRevenue)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{revenueCardSub}</p>
              {revenueBasis === 'cashin' && (
                <>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    GMV: ฿{formatCurrency(summary.gmv)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    เงินรับจริงจาก Settlement หลังหักค่าธรรมเนียม (TikTok+Shopee)
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

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
          allocatedCogs={summary.cogs}
          cogsExpenses={displayCogsExp}
          cogsExpState={cogsExpState}
          cogsBasis={cogsBasis}
          from={from}
          to={to}
          allSearchParams={allSearchParamsFlat}
        />

        {/* Operating + Tax + Net Profit — client component */}
        <OperatingNetCards
          initialOp={displayOp}
          initialTax={displayTax}
          initialOpState={opState}
          initialTaxState={taxState}
          gmv={displayRevenue}
          adSpend={summary.adSpend}
          cogs={displayCogs}
          from={from}
          to={to}
          revenueBasis={revenueBasis}
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
              {displayRoas.toFixed(2)}x
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {revenueBasis === 'cashin' ? 'Cash In / Ad Spend' : revenueBasis === 'bank' ? 'Bank Inflows / Ad Spend' : 'GMV / Ad Spend'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            Trend: GMV{gmvBasis === 'paid' ? ' (Paid)' : ''} vs Ad Spend vs Net Profit
            {revenueBasis === 'cashin' && (
              <span className="ml-2 text-sm font-normal text-blue-600">· Revenue = Cash In</span>
            )}
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
            {revenueBasis === 'cashin' ? 'Cash P&L Breakdown' : revenueBasis === 'bank' ? 'Bank P&L Breakdown' : 'P&L Breakdown'}
            {revenueBasis === 'gmv' && (gmvBasis !== 'created' || cogsBasis !== 'shipped') && (
              <span className="ml-2 text-sm font-normal text-amber-600">· Mixed basis</span>
            )}
            {revenueBasis === 'cashin' && (
              <span className="ml-2 text-sm font-normal text-blue-600">· Revenue = Settlement Date</span>
            )}
            {revenueBasis === 'bank' && (
              <span className="ml-2 text-sm font-normal text-emerald-600">· Revenue = Bank Inflows (Selected)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Revenue row */}
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium">
                {revenueBasis === 'cashin'
                  ? 'Cash In (Settlement Date)'
                  : revenueBasis === 'bank'
                  ? 'Bank Inflows (Selected)'
                  : `GMV (${gmvBasis === 'paid' ? 'Paid Date' : 'Order Date'})`}
              </span>
              <span className={`font-mono ${revenueBasis === 'cashin' ? 'text-blue-600' : revenueBasis === 'bank' ? 'text-emerald-600' : 'text-green-600'}`}>
                ฿{formatCurrency(displayRevenue)}
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
                (฿{formatCurrency(displayCogs)})
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
              <span className="text-lg font-bold">
                {revenueBasis === 'cashin' || revenueBasis === 'bank' ? 'Net Cash' : 'Net Profit'}
              </span>
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
