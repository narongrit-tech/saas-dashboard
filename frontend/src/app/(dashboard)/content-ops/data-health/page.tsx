import Link from 'next/link'
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getDataHealth } from '../actions'

export const dynamic = 'force-dynamic'

function PipelineIcon({ status }: { status: 'ok' | 'warning' | 'error' }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />
  return <AlertCircle className="h-4 w-4 text-destructive" />
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'border-red-300 bg-red-50 dark:bg-red-950/20',
  medium: 'border-amber-300 bg-amber-50 dark:bg-amber-950/20',
  low: 'border-border bg-muted/30',
}

const SEVERITY_TEXT: Record<string, string> = {
  high: 'text-red-700 dark:text-red-400',
  medium: 'text-amber-700 dark:text-amber-400',
  low: 'text-muted-foreground',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'text-red-700 border-red-300',
  medium: 'text-amber-700 border-amber-300',
  low: 'text-muted-foreground border-muted-foreground/30',
}

export default async function DataHealthPage() {
  const { data, error } = await getDataHealth()

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error ?? 'Failed to load health data'}
      </div>
    )
  }

  const { pipeline, knownGaps, coverageMetrics, nextActions } = data

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Data Health</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          System readiness — what&apos;s working, what&apos;s missing, and what decisions you should not yet make
        </p>
      </div>

      {/* Pipeline status grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Pipeline Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pipeline.map((item) => (
              <div
                key={item.label}
                className={`flex items-start gap-2.5 rounded-md border p-3 ${
                  item.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10'
                    : item.status === 'warning'
                    ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/10'
                    : 'border-red-200 bg-red-50/50 dark:bg-red-950/10'
                }`}
              >
                <PipelineIcon status={item.status} />
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Known gaps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Known Gaps</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            These limitations are known. Do not make decisions in these areas without understanding the impact.
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {knownGaps.map((gap) => (
            <div
              key={gap.title}
              className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${SEVERITY_STYLE[gap.severity]}`}
            >
              <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${SEVERITY_TEXT[gap.severity]}`} />
              <div>
                <p className={`text-sm font-medium ${SEVERITY_TEXT[gap.severity]}`}>{gap.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{gap.description}</p>
              </div>
              <span className={`ml-auto text-xs border rounded px-1.5 py-0.5 shrink-0 ${SEVERITY_TEXT[gap.severity]} border-current opacity-70`}>
                {gap.severity}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Coverage metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Coverage Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {coverageMetrics.map((metric) => (
              <div key={metric.label}>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <p className={`text-2xl font-semibold tabular-nums ${metric.value >= 80 ? 'text-emerald-600' : metric.value >= 50 ? 'text-amber-600' : 'text-destructive'}`}>
                    {metric.value}
                  </p>
                  <span className="text-sm text-muted-foreground">{metric.suffix}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-muted rounded-full mt-2">
                  <div
                    className={`h-1.5 rounded-full ${metric.value >= 80 ? 'bg-emerald-500' : metric.value >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(metric.value, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Technical next actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Technical Next Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {nextActions.map((action) => (
            <div
              key={action.title}
              className="flex items-start gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{action.title}</p>
                {action.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                )}
              </div>
              <span className={`text-xs border rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_BADGE[action.priority]}`}>
                {action.priority}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Quick links to operational pages */}
      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-3">Operational tools</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-affiliate/upload">
              Upload data
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-affiliate/costs">
              Enter costs
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-affiliate/verification">
              Run verification
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/content-ops/tiktok-affiliate/batches">
              Import history
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
