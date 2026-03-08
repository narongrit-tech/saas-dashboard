import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrendingUp, Megaphone, AlertCircle, Wallet } from 'lucide-react'
import { format, subDays, parseISO, isValid } from 'date-fns'
import { getPerformanceDashboard, getExpensePickerTotal, getMarketplaceCashIn, getBankInflowRevenueTotal } from './actions'
import type { CogsBasis, RevenueBasis, BankInflowRevenueTotals } from './actions'
import { getBangkokNow } from '@/lib/bangkok-time'
import { PerformanceTrendChart } from '@/components/dashboard/PerformanceTrendChart'
import { AdsBreakdownSection } from '@/components/dashboard/AdsBreakdownSection'
import { DateRangePickerClient } from '@/components/dashboard/DateRangePickerClient'
import { BasisToggleClient } from '@/components/dashboard/BasisToggleClient'
import { OperatingNetCards } from '@/components/dashboard/OperatingNetCards'
import { CogsCard } from '@/components/dashboard/CogsCard'
import { BankRevenueCard } from '@/components/dashboard/BankRevenueCard'
import { MarketingPerformanceCards } from '@/components/dashboard/MarketingPerformanceCards'
import { ProfitBridge } from '@/components/dashboard/ProfitBridge'
import { CollapsibleSection } from '@/components/dashboard/CollapsibleSection'
import { parsePickerState } from '@/lib/expense-picker'

export const dynamic = 'force-dynamic'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

/** Section header with left-border accent */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-4 rounded-full bg-primary/60" />
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
    </div>
  )
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
  const cogsBasis:    CogsBasis    = sp(searchParams, 'cogsBasis') === 'created' ? 'created' : 'shipped'
  const _rawRevBasis = sp(searchParams, 'revBasis')
  const revenueBasis: RevenueBasis = _rawRevBasis === 'cashin' ? 'cashin' : _rawRevBasis === 'bank' ? 'bank' : 'gmv'

  // ── Expense picker states from URL ───────────────────────────────────────────
  const opState      = parsePickerState(searchParams, 'op',      'ALL')
  const taxState     = parsePickerState(searchParams, 'tax',     'Tax')
  const cogsExpState = parsePickerState(searchParams, 'cogsExp', 'COGS')
  if (cogsExpState.category !== 'COGS') cogsExpState.category = 'COGS'

  // ── Fetch all data in parallel ───────────────────────────────────────────────
  // opState/taxState are passed into getPerformanceDashboard so the trend chart
  // uses the exact same filtered expenses as the summary cards.
  const [result, cogsExpResult, cashInResult, bankInflowResult] = await Promise.all([
    getPerformanceDashboard(from, to, cogsBasis, opState, taxState),
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
  // summary.operating and summary.tax are already picker-filtered (opState/taxState
  // passed into getPerformanceDashboard), so they match the trend chart exactly.
  const displayOp      = summary.operating
  const displayTax     = summary.tax
  const displayCogsExp = cogsExpResult.data?.total ?? 0
  const displayCogs    = summary.cogs + displayCogsExp

  const cashInData        = cashInResult.success ? cashInResult.data : undefined
  const displayCashIn     = cashInData?.total ?? 0
  const bankInflowData    = bankInflowResult.success ? bankInflowResult.data : undefined
  const displayBankInflow = bankInflowData?.total ?? 0
  const displayRevenue    = revenueBasis === 'cashin' ? displayCashIn : revenueBasis === 'bank' ? displayBankInflow : summary.gmv

  // ── Flat URL params for client components ────────────────────────────────────
  const allSearchParamsFlat: Record<string, string> = {}
  Object.entries(searchParams).forEach(([k, v]) => {
    if (v !== undefined) allSearchParamsFlat[k] = Array.isArray(v) ? v[0] : v
  })

  // ── Revenue card labels ───────────────────────────────────────────────────────
  const revenueCardTitle = revenueBasis === 'cashin'
    ? 'Cash In (เงินเข้าจริง)'
    : revenueBasis === 'bank'
    ? 'Bank Inflows (Selected)'
    : 'GMV (Orders Created)'

  const revenueCardSub = revenueBasis === 'cashin'
    ? `TikTok ฿${formatCurrency(cashInData?.tiktok ?? 0)} + Shopee ฿${formatCurrency(cashInData?.shopee ?? 0)}`
    : revenueBasis === 'bank'
    ? 'คลิกที่การ์ดเพื่อเลือกรายการ'
    : 'Source: sales_orders (created_time)'

  return (
    <div className="space-y-6 pb-10">

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION A — HEADER + CONTROLS
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-5">
        {/* Desktop: horizontal split — left=title+date, right=toggles */}
        <div className="lg:flex lg:items-center lg:gap-8">

          {/* Left: Title + Meta + Date Picker */}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Performance Dashboard</h1>
            <p className="text-muted-foreground text-xs mt-0.5">
              {summary.startDate} – {summary.endDate}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              Asia/Bangkok
            </p>
            <div className="mt-3">
              <DateRangePickerClient from={from} to={to} />
            </div>
          </div>

          {/* Right: Basis toggles — inline on desktop, below-divider on mobile */}
          <div className="mt-3 pt-3 border-t lg:mt-0 lg:pt-0 lg:border-t-0 lg:border-l lg:pl-8 lg:flex-shrink-0">
            <BasisToggleClient cogsBasis={cogsBasis} revenueBasis={revenueBasis} />
          </div>

        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION B — BUSINESS PERFORMANCE (Executive Summary)
      ══════════════════════════════════════════════════════════════════════ */}
      <div>
        <SectionLabel>Business Performance</SectionLabel>
        {/* Desktop: 3-col × 2 rows — primary (Revenue/Ads/COGS) + secondary (Op/Tax/Net) */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 items-start">

          {/* Revenue */}
          {revenueBasis === 'bank' ? (
            <BankRevenueCard
              initialTotal={displayBankInflow}
              initialBreakdown={bankInflowData ?? { total: 0, tiktok: 0, shopee: 0, other: 0 }}
              from={from}
              to={to}
            />
          ) : (
            <Card className="border-green-100 dark:border-green-900/30">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Revenue</CardTitle>
                <div className={`rounded-md p-1.5 ${revenueBasis === 'cashin' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-green-50 dark:bg-green-900/20 text-green-600'}`}>
                  {revenueBasis === 'cashin' ? <Wallet className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                </div>
              </CardHeader>
              <CardContent className="pb-4 px-4 pt-1">
                <div className={`text-2xl font-bold tracking-tight ${revenueBasis === 'cashin' ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}`}>
                  ฿{formatCurrency(displayRevenue)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{revenueCardSub}</p>
                {revenueBasis === 'cashin' && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">GMV: ฿{formatCurrency(summary.gmv)}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Ad Spend */}
          <Card className="border-purple-100 dark:border-purple-900/30">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ad Spend</CardTitle>
              <div className="rounded-md bg-purple-50 dark:bg-purple-900/20 p-1.5 text-purple-600 dark:text-purple-400">
                <Megaphone className="h-3.5 w-3.5" />
              </div>
            </CardHeader>
            <CardContent className="pb-4 px-4 pt-1">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 tracking-tight">
                ฿{formatCurrency(summary.adSpend)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">Product + Live + Awareness</p>
            </CardContent>
          </Card>

          {/* COGS — interactive drilldown */}
          <CogsCard
            allocatedCogs={summary.cogs}
            cogsExpenses={displayCogsExp}
            cogsExpState={cogsExpState}
            cogsBasis={cogsBasis}
            from={from}
            to={to}
            allSearchParams={allSearchParamsFlat}
          />

          {/* Operating + Tax + Net Profit (3 cards rendered by client component) */}
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

        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION D — TREND CHART  (elevated: above marketing for faster insight)
      ══════════════════════════════════════════════════════════════════════ */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2 pt-5 px-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Daily Trend</CardTitle>
              <CardDescription className="mt-0.5">แนวโน้มรายวัน — เลือก View เพื่อเปลี่ยนมุมมอง</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <PerformanceTrendChart data={trend} />
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION C — MARKETING PERFORMANCE
      ══════════════════════════════════════════════════════════════════════ */}
      <CollapsibleSection title="Marketing Performance">
        <MarketingPerformanceCards
          blendedRoas={summary.roas}
          attributedRoas={summary.attributedRoas}
          awarenessSpend={summary.awarenessSpend}
          productSpend={summary.productSpend}
          liveSpend={summary.liveSpend}
          totalAdSpend={summary.adSpend}
        />
      </CollapsibleSection>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION E + F — ADS BREAKDOWN (charts-first, table collapsible)
      ══════════════════════════════════════════════════════════════════════ */}
      <CollapsibleSection title="Ads Breakdown">
        <Card className="shadow-sm">
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="text-base">Ads Breakdown</CardTitle>
            <CardDescription className="mt-0.5">
              ประสิทธิภาพโฆษณาตามประเภท · ช่วงที่เลือก
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <AdsBreakdownSection from={from} to={to} />
          </CardContent>
        </Card>
      </CollapsibleSection>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION G — PROFIT BRIDGE / DIAGNOSTIC
      ══════════════════════════════════════════════════════════════════════ */}
      <CollapsibleSection title="Profit Bridge — Diagnostics">
        <div className="grid gap-4 lg:grid-cols-2">

          {/* Left: P&L reconciliation */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-5 px-5">
              <CardTitle className="text-base">P&L Reconciliation</CardTitle>
              <CardDescription className="mt-0.5">Revenue → Net Profit step-by-step</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ProfitBridge
                revenue={displayRevenue}
                productSpend={summary.productSpend}
                liveSpend={summary.liveSpend}
                awarenessSpend={summary.awarenessSpend}
                cogs={displayCogs}
                operating={displayOp}
                tax={displayTax}
                revenueBasis={revenueBasis}
              />
            </CardContent>
          </Card>

          {/* Right: Ad spend breakdown for quick audit */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-5 px-5">
              <CardTitle className="text-base">Ad Spend Breakdown</CardTitle>
              <CardDescription className="mt-0.5">แยกตามประเภทโฆษณา</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="space-y-2">
                {/* Product */}
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-500" />
                    <span className="text-sm">Product Ads</span>
                    <span className="text-xs text-muted-foreground">(ad_daily_performance)</span>
                  </div>
                  <span className="font-mono text-sm font-medium">฿{formatCurrency(summary.productSpend)}</span>
                </div>
                {/* Live */}
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-pink-500" />
                    <span className="text-sm">Live Ads</span>
                    <span className="text-xs text-muted-foreground">(ad_daily_performance)</span>
                  </div>
                  <span className="font-mono text-sm font-medium">฿{formatCurrency(summary.liveSpend)}</span>
                </div>
                {/* Awareness */}
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-sm">Awareness Ads</span>
                    <span className="text-xs text-muted-foreground">(wallet_ledger)</span>
                  </div>
                  <span className="font-mono text-sm font-medium">฿{formatCurrency(summary.awarenessSpend)}</span>
                </div>
                {/* Total */}
                <div className="flex items-center justify-between py-2 bg-muted/30 rounded-lg px-3 -mx-1 mt-1">
                  <span className="text-sm font-semibold">Total (Blended)</span>
                  <span className="font-mono text-sm font-bold text-purple-600 dark:text-purple-400">
                    ฿{formatCurrency(summary.adSpend)}
                  </span>
                </div>
                {/* ROAS quick view */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Blended ROAS</p>
                    <p className="text-base font-bold text-yellow-600 dark:text-yellow-400">
                      {summary.roas > 0 ? `${summary.roas.toFixed(2)}x` : '–'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Attributed ROAS</p>
                    <p className="text-base font-bold text-violet-600 dark:text-violet-400">
                      {summary.attributedRoas > 0 ? `${summary.attributedRoas.toFixed(2)}x` : '–'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </CollapsibleSection>

    </div>
  )
}
