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

  // For in-progress runs, use _so_far fields; fall back to final fields
  const displayTotal      = summary?.total_so_far      ?? summary?.total      ?? 0
  const displaySuccessful = summary?.successful_so_far ?? summary?.successful ?? 0
  const displaySkipped    = summary?.skipped_so_far    ?? summary?.skipped    ?? 0
  const displayFailed     = summary?.failed_so_far     ?? summary?.failed     ?? 0
  const offsetCompleted   = summary?.offset_completed  ?? 0

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

            {/* Progress stats */}
            {displayTotal > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  ประมวลผลแล้ว: <strong>{displayTotal}</strong> orders
                  {' · '}<span className="text-green-700 dark:text-green-400">{displaySuccessful} สำเร็จ</span>
                  {' · '}<span className="text-yellow-700 dark:text-yellow-400">{displaySkipped} ข้าม</span>
                  {displayFailed > 0 && (
                    <>{' · '}<span className="text-red-700 dark:text-red-400">{displayFailed} ล้มเหลว</span></>
                  )}
                </p>
                {offsetCompleted > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ตำแหน่งล่าสุด: offset {offsetCompleted}
                  </p>
                )}
              </div>
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
