import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { getCogsRun } from '@/app/(dashboard)/inventory/cogs-run-actions'

interface PageProps {
  params: { id: string }
}

// ─────────────────────────────────────────────
// Status badge helper
// ─────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') {
    return <Badge className="bg-green-100 text-green-800 border-green-300">สำเร็จ</Badge>
  }
  if (status === 'failed') {
    return <Badge className="bg-red-100 text-red-800 border-red-300">ล้มเหลว</Badge>
  }
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">กำลังประมวลผล</Badge>
}

// ─────────────────────────────────────────────
// Trigger source label helper
// ─────────────────────────────────────────────

function triggerLabel(source: string): string {
  if (source === 'MTD') return 'Month-to-Date (MTD)'
  if (source === 'DATE_RANGE') return 'ช่วงวันที่ที่เลือก'
  if (source === 'IMPORT_BATCH') return 'Import Batch'
  return source
}

// ─────────────────────────────────────────────
// Format date for display (Bangkok timezone)
// ─────────────────────────────────────────────

function formatThaiDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(isoString))
  } catch {
    return isoString
  }
}

// ─────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────

export default async function CogsRunDetailPage({ params }: PageProps) {
  const run = await getCogsRun(params.id)

  if (!run) {
    notFound()
  }

  const summary = run.summary_json as Record<string, any> | null
  const skipReasons: Array<{
    code: string
    label: string
    count: number
    samples: Array<{ order_id: string; sku?: string; detail?: string }>
  }> = Array.isArray(summary?.skip_reasons) ? summary!.skip_reasons : []

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/inventory" className="hover:text-foreground">
          Inventory
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">COGS Runs</span>
        <span>/</span>
        <span className="font-mono text-xs">{params.id.slice(0, 8)}…</span>
      </nav>

      {/* Back button */}
      <div>
        <Link href="/inventory">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            กลับ Inventory
          </Button>
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">COGS Run Detail</h1>
        <StatusBadge status={run.status} />
      </div>

      {/* Run Info */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="font-semibold text-base mb-3">ข้อมูลทั่วไป</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Run ID</span>
            <p className="font-mono text-xs mt-0.5">{run.id}</p>
          </div>
          <div>
            <span className="text-muted-foreground">สถานะ</span>
            <p className="mt-0.5">
              <StatusBadge status={run.status} />
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Trigger</span>
            <p className="mt-0.5">{triggerLabel(run.trigger_source)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">สร้างเมื่อ</span>
            <p className="mt-0.5">{formatThaiDate(run.created_at)}</p>
          </div>
          {run.date_from && (
            <div>
              <span className="text-muted-foreground">วันที่เริ่มต้น</span>
              <p className="mt-0.5">{run.date_from}</p>
            </div>
          )}
          {run.date_to && (
            <div>
              <span className="text-muted-foreground">วันที่สิ้นสุด</span>
              <p className="mt-0.5">{run.date_to}</p>
            </div>
          )}
          {run.import_batch_id && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Import Batch ID</span>
              <p className="font-mono text-xs mt-0.5">{run.import_batch_id}</p>
            </div>
          )}
          {run.updated_at && run.updated_at !== run.created_at && (
            <div>
              <span className="text-muted-foreground">อัปเดตเมื่อ</span>
              <p className="mt-0.5">{formatThaiDate(run.updated_at)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {run.status === 'failed' && run.error_message && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800 mb-1">ข้อผิดพลาด</p>
          <p className="text-sm text-red-700 whitespace-pre-wrap">{run.error_message}</p>
        </div>
      )}

      {/* Summary Stats (success only) */}
      {run.status === 'success' && summary && (
        <>
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold text-base mb-4">สรุปผล</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-md bg-muted/40">
                <p className="text-2xl font-bold">{summary.total ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Orders</p>
              </div>
              <div className="text-center p-3 rounded-md bg-blue-50 dark:bg-blue-950/20">
                <p className="text-2xl font-bold text-blue-700">{summary.eligible ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Eligible</p>
              </div>
              <div className="text-center p-3 rounded-md bg-green-50 dark:bg-green-950/20">
                <p className="text-2xl font-bold text-green-700">{summary.successful ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">สำเร็จ</p>
              </div>
              <div className="text-center p-3 rounded-md bg-yellow-50 dark:bg-yellow-950/20">
                <p className="text-2xl font-bold text-yellow-700">{summary.skipped ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">ข้าม</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="text-center p-3 rounded-md bg-orange-50 dark:bg-orange-950/20">
                <p className="text-xl font-bold text-orange-700">{summary.partial ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Partial (bundle)</p>
              </div>
              <div className="text-center p-3 rounded-md bg-red-50 dark:bg-red-950/20">
                <p className="text-xl font-bold text-red-700">{summary.failed ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">ล้มเหลว</p>
              </div>
            </div>
          </div>

          {/* Skip Reasons */}
          {skipReasons.length > 0 && (
            <Collapsible className="rounded-lg border bg-card">
              <CollapsibleTrigger className="w-full flex items-center justify-between p-5 hover:bg-muted/30 transition-colors">
                <span className="font-semibold text-base">
                  Skip Reasons ({skipReasons.length} ประเภท)
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-5 pb-5 space-y-3 pt-2">
                {skipReasons.map((reason, idx) => (
                  <div
                    key={idx}
                    className="border-l-4 border-yellow-400 pl-3 py-2 bg-yellow-50/50 dark:bg-yellow-950/10 rounded-r"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-sm">{reason.label}</p>
                      <Badge variant="secondary">{reason.count} orders</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Code: <span className="font-mono">{reason.code}</span>
                    </p>
                    {reason.samples && reason.samples.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">
                          ตัวอย่าง ({reason.samples.length} รายการแรก):
                        </p>
                        {reason.samples.map((sample, sIdx) => (
                          <div
                            key={sIdx}
                            className="text-xs flex items-center gap-2 bg-white dark:bg-muted rounded px-2 py-1"
                          >
                            <span className="font-mono text-blue-600">{sample.order_id}</span>
                            {sample.sku && (
                              <span className="text-muted-foreground">SKU: {sample.sku}</span>
                            )}
                            {sample.detail && (
                              <span className="text-orange-600">{sample.detail}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  )
}
