import Link from 'next/link'
import {
  Upload,
  Database,
  GitBranch,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Layers,
  BarChart3,
  FlaskConical,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getPipelineStatus } from './actions'
import { MasterRefreshButton } from './refresh-buttons'

export const dynamic = 'force-dynamic'

function StageCard({
  href,
  icon: Icon,
  label,
  count,
  subtitle,
  status,
}: {
  href: string
  icon: React.ElementType
  label: string
  count: number | null
  subtitle: string
  status: 'empty' | 'has-data' | 'warning' | 'partial'
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-foreground/30 transition-colors cursor-pointer h-full">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
            </div>
            {status === 'empty' && <Badge variant="outline" className="text-xs text-muted-foreground">Empty</Badge>}
            {status === 'has-data' && <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">Active</Badge>}
            {status === 'partial' && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">Limited</Badge>}
            {status === 'warning' && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Check</Badge>}
          </div>
          <div className="mt-2">
            <p className="text-2xl font-semibold tabular-nums">{count === null ? '—' : count.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function TikTokAffiliateOverviewPage() {
  const { data: status, error } = await getPipelineStatus()

  const blockers: string[] = []
  const nextActions: { label: string; href: string }[] = []

  if (status) {
    if (status.batches === 0) {
      blockers.push('No import batches — upload a TikTok affiliate Excel file first')
      nextActions.push({ label: 'Upload data', href: '/content-ops/tiktok-affiliate/upload' })
    } else if (status.factRows === 0) {
      blockers.push('Staging rows exist but facts table is empty — normalization may have failed')
      nextActions.push({ label: 'View batches', href: '/content-ops/tiktok-affiliate/batches' })
    } else if (status.costs === 0) {
      blockers.push('No cost data — profit = commission only. Insert costs to get real ROI.')
      nextActions.push({ label: 'Add costs', href: '/content-ops/tiktok-affiliate/costs' })
    }

    if (status.factRows > 0 && status.profitSummaryRows === 0) {
      blockers.push('Facts exist but profit summary is empty — run profit refresh')
      nextActions.push({ label: 'Run refresh', href: '/content-ops/tiktok-affiliate/profit' })
    }

    if (status.unallocatedCosts > 0) {
      blockers.push(`${status.unallocatedCosts} unallocated cost rows — cost_date may not match any order data`)
      nextActions.push({ label: 'View verification', href: '/content-ops/tiktok-affiliate/verification' })
    }
    if (status.attributionState === 'timed_out' || status.attributionState === 'failed') {
      blockers.push(status.attributionMessage ?? 'Attribution query failed and counts are unavailable.')
      nextActions.push({ label: 'Inspect attribution', href: '/content-ops/tiktok-affiliate/attribution' })
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">TikTok Affiliate Content Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operator console — import, attribution, cost allocation, and profit reporting
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Blockers */}
      {blockers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current blockers</p>
          <div className="space-y-1.5">
            {blockers.map((b) => (
              <div key={b} className="flex items-start gap-2 text-sm border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 rounded-md px-3 py-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap items-start gap-2">
        <Button asChild size="sm" variant="default">
          <Link href="/content-ops/tiktok-affiliate/upload">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Upload file
          </Link>
        </Button>
        {nextActions.filter(a => a.href !== '/content-ops/tiktok-affiliate/upload').map((a) => (
          <Button key={a.href} asChild size="sm" variant="outline">
            <Link href={a.href}>
              {a.label}
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        ))}
        <MasterRefreshButton />
        <Button asChild size="sm" variant="outline">
          <Link href="/content-ops/tiktok-affiliate/verification">
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
            Verify
          </Link>
        </Button>
      </div>

      {/* Pipeline stages */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Pipeline stages</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StageCard
            href="/content-ops/tiktok-affiliate/batches"
            icon={Upload}
            label="Batches"
            count={status?.batches ?? 0}
            subtitle="import sessions"
            status={!status || status.batches === 0 ? 'empty' : 'has-data'}
          />
          <StageCard
            href="/content-ops/tiktok-affiliate/facts"
            icon={Database}
            label="Facts"
            count={status?.factRows ?? 0}
            subtitle="normalized rows"
            status={!status || status.factRows === 0 ? 'empty' : 'has-data'}
          />
          <StageCard
            href="/content-ops/tiktok-affiliate/attribution"
            icon={GitBranch}
            label="Attribution"
            count={status?.attributionRows ?? null}
            subtitle={status?.attributionMessage ?? 'winner rows'}
            status={
              !status
                ? 'empty'
                : status.attributionState === 'partial'
                ? 'partial'
                : status.attributionState === 'timed_out' || status.attributionState === 'failed'
                  ? 'warning'
                  : status.attributionState === 'no_data' || status.attributionRows === 0
                    ? 'empty'
                    : 'has-data'
            }
          />
          <StageCard
            href="/content-ops/tiktok-affiliate/profit"
            icon={BarChart3}
            label="Profit"
            count={status?.profitSummaryRows ?? 0}
            subtitle="summary rows"
            status={!status || status.profitSummaryRows === 0 ? 'empty' : 'has-data'}
          />
        </div>
      </div>

      {/* Cost layer */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Cost layer</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StageCard
            href="/content-ops/tiktok-affiliate/costs"
            icon={DollarSign}
            label="Costs"
            count={status?.costs ?? 0}
            subtitle="cost input rows"
            status={!status || status.costs === 0 ? 'empty' : 'has-data'}
          />
          <StageCard
            href="/content-ops/tiktok-affiliate/costs"
            icon={Layers}
            label="Allocations"
            count={status?.costAllocations ?? 0}
            subtitle="derived allocation slices"
            status={!status || status.costAllocations === 0 ? 'empty' : 'has-data'}
          />
          <StageCard
            href="/content-ops/tiktok-affiliate/verification"
            icon={status?.unallocatedCosts ? AlertCircle : CheckCircle2}
            label="Unallocated"
            count={status?.unallocatedCosts ?? 0}
            subtitle="costs with no basis"
            status={!status ? 'empty' : status.unallocatedCosts > 0 ? 'warning' : 'has-data'}
          />
        </div>
      </div>

      {/* Navigation */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">All pages</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { href: '/content-ops/tiktok-affiliate/upload', label: 'Upload', desc: 'Import .xlsx file' },
            { href: '/content-ops/tiktok-affiliate/batches', label: 'Batches', desc: 'Import history and quality metrics' },
            { href: '/content-ops/tiktok-affiliate/facts', label: 'Facts', desc: 'Normalized order-line facts' },
            { href: '/content-ops/tiktok-affiliate/attribution', label: 'Attribution', desc: 'Last-touch winner rows' },
            { href: '/content-ops/tiktok-affiliate/costs', label: 'Cost Input', desc: 'Insert and manage costs' },
            { href: '/content-ops/tiktok-affiliate/profit', label: 'Profit', desc: 'Commission minus cost summary + refresh' },
            { href: '/content-ops/tiktok-affiliate/verification', label: 'Verification', desc: 'Run pipeline integrity checks' },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="flex items-center justify-between px-3 py-2.5 rounded-md border hover:border-foreground/30 hover:bg-muted/30 transition-colors group">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
