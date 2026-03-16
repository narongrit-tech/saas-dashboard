'use client'

import Link from 'next/link'
import { Loader2, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CogsRun, CogsSummaryJson } from '@/app/(dashboard)/inventory/cogs-run-actions'

interface ActiveRunBannerProps {
  run: CogsRun
  onRefresh: () => void
  isRefreshing: boolean
}

function formatBangkokTime(isoStr: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(isoStr))
  } catch {
    return isoStr
  }
}

export function ActiveRunBanner({ run, onRefresh, isRefreshing }: ActiveRunBannerProps) {
  const summary = run.summary_json as CogsSummaryJson | null
  const method = summary?.method ?? null
  const showUpdatedAt = run.updated_at && run.updated_at !== run.created_at

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5">
          <Loader2 className="h-5 w-5 text-amber-600 animate-spin mt-0.5 shrink-0" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-amber-900 dark:text-amber-100 text-sm">
                COGS Allocation กำลังทำงาน
              </span>
              <Badge className="bg-amber-200 text-amber-800 border-amber-300 dark:bg-amber-800 dark:text-amber-100 text-xs">
                Running
              </Badge>
            </div>

            {/* Run metadata */}
            <div className="text-sm text-amber-800 dark:text-amber-200 mt-1 space-y-0.5">
              {run.date_from && run.date_to && (
                <p>
                  <span className="text-amber-600 dark:text-amber-400">ช่วงวันที่: </span>
                  {run.date_from} → {run.date_to}
                </p>
              )}
              {method && (
                <p>
                  <span className="text-amber-600 dark:text-amber-400">วิธี: </span>
                  {method}
                </p>
              )}
              <p>
                <span className="text-amber-600 dark:text-amber-400">เริ่มเมื่อ: </span>
                {formatBangkokTime(run.created_at)}
              </p>
              {showUpdatedAt && (
                <p>
                  <span className="text-amber-600 dark:text-amber-400">อัปเดตล่าสุด: </span>
                  {formatBangkokTime(run.updated_at)}
                </p>
              )}
            </div>

            {/* Partial counts if available */}
            {summary && (summary.total ?? 0) > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                ผลล่าสุดที่ทราบ: {summary.successful ?? 0} สำเร็จ
                {' · '}{summary.skipped ?? 0} ข้าม
                {' · '}{summary.failed ?? 0} ล้มเหลว
                {' · '}{summary.total ?? '?'} รวม
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>

          <Link href={`/inventory/cogs-runs/${run.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="ml-1.5">ดูรายละเอียด</span>
            </Button>
          </Link>
        </div>
      </div>

      <p className="text-xs text-amber-600 dark:text-amber-400 pl-7">
        หน้านี้จะรีเฟรชอัตโนมัติทุก 12 วินาทีขณะที่มีงานทำงานอยู่
      </p>
    </div>
  )
}
