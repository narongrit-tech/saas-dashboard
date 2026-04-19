'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, FlaskConical, CheckCircle2, XCircle, AlertCircle, Info, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { runVerification, type VerificationResult } from '../actions'

const CHECK_LINKS: Record<string, string> = {
  'Attribution grain uniqueness': '/content-ops/tiktok-affiliate/attribution',
  'Attribution key completeness': '/content-ops/tiktok-affiliate/attribution',
  'Profit formula': '/content-ops/tiktok-affiliate/profit',
  'ROI nullability': '/content-ops/tiktok-affiliate/profit',
  'Summary grain uniqueness': '/content-ops/tiktok-affiliate/profit',
  'Facts vs attribution coverage': '/content-ops/tiktok-affiliate/facts',
  'Cost conservation': '/content-ops/tiktok-affiliate/costs',
}

function StatusIcon({ passed, error }: { passed: boolean; error?: string }) {
  if (error) return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
  if (passed) return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
}

function CheckRow({ result }: { result: VerificationResult }) {
  const [expanded, setExpanded] = useState(!result.passed || !!result.error)
  const hasDetail = result.sampleRows.length > 0 || !!result.error
  const fixLink = !result.passed && !result.error ? CHECK_LINKS[result.check] : undefined

  return (
    <div className={`rounded-md border ${result.error ? 'border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10' : result.passed ? 'border-border' : 'border-red-300/60 bg-red-50/30 dark:bg-red-950/10'}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => hasDetail && setExpanded((p) => !p)}
        disabled={!hasDetail}
      >
        <StatusIcon passed={result.passed} error={result.error} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{result.check}</span>
            {result.check === 'Unallocated costs (informational)' && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                informational
              </span>
            )}
            {!result.passed && !result.error && result.rowCount > 0 && (
              <span className="text-xs text-red-600 font-medium">{result.rowCount} violation{result.rowCount !== 1 ? 's' : ''}</span>
            )}
            {result.check === 'Unallocated costs (informational)' && result.rowCount > 0 && (
              <span className="text-xs text-amber-600">{result.rowCount} row{result.rowCount !== 1 ? 's' : ''}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{result.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {fixLink && (
            <Link
              href={fixLink}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-primary underline hover:no-underline"
            >
              Investigate →
            </Link>
          )}
          {hasDetail && (
            expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && hasDetail && (
        <div className="px-4 pb-3 border-t mt-0">
          {result.error && (
            <p className="text-xs text-amber-700 dark:text-amber-400 py-2 font-mono">{result.error}</p>
          )}
          {result.sampleRows.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <p className="text-xs text-muted-foreground mb-1.5">
                Sample rows (up to 5):
              </p>
              <div className="rounded-md border bg-muted/30">
                <table className="text-xs w-full">
                  <thead>
                    <tr>
                      {Object.keys(result.sampleRows[0]).map((k) => (
                        <th key={k} className="text-left px-3 py-1.5 font-medium text-muted-foreground border-b">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sampleRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 font-mono text-xs">
                            {v === null ? <span className="text-muted-foreground italic">null</span> : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function VerificationPage() {
  const [results, setResults] = useState<VerificationResult[]>([])
  const [hasRun, setHasRun] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRun() {
    startTransition(async () => {
      const data = await runVerification()
      setResults(data)
      setHasRun(true)
    })
  }

  const passCount = results.filter((r) => r.passed).length
  const failCount = results.filter((r) => !r.passed && !r.error).length
  const errorCount = results.filter((r) => !!r.error).length
  const allPassed = hasRun && failCount === 0 && errorCount === 0

  return (
    <div className="space-y-5 max-w-4xl">
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
          <h1 className="text-xl font-semibold">Pipeline Verification</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            8 integrity checks — read-only. Safe to run at any time.
          </p>
        </div>
        <Button onClick={handleRun} disabled={isPending} size="sm">
          <FlaskConical className={`h-3.5 w-3.5 mr-1.5 ${isPending ? 'animate-pulse' : ''}`} />
          {isPending ? 'Running checks…' : hasRun ? 'Re-run checks' : 'Run checks'}
        </Button>
      </div>

      {hasRun && !isPending && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-md border ${allPassed ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-red-300 bg-red-50/50 dark:bg-red-950/20'}`}>
          {allPassed
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
          <div>
            <p className={`text-sm font-medium ${allPassed ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200'}`}>
              {allPassed ? 'All checks passed' : `${failCount} check${failCount !== 1 ? 's' : ''} failed`}
            </p>
            <p className="text-xs text-muted-foreground">
              {passCount} passed · {failCount} failed · {errorCount} error{errorCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {!hasRun && !isPending && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <FlaskConical className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No results yet</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Click "Run checks" to verify pipeline integrity. Checks cover attribution grain, profit formula, ROI nullability, cost conservation, and more.
            </p>
            <Button size="sm" className="mt-2" onClick={handleRun} disabled={isPending}>
              Run checks
            </Button>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((result) => (
            <CheckRow key={result.check} result={result} />
          ))}
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>All checks are pure SELECT queries. No writes, no temp objects.</p>
        <p>
          Checks that show violations link to the relevant page where you can investigate the data.
        </p>
      </div>
    </div>
  )
}
