'use client'

/**
 * AdsImportBatchPreview
 *
 * Displays per-file analysis results and lets the user confirm/override
 * the suggested action before the import proceeds.
 *
 * Suggestion badges:
 *   APPEND  = green  (safe to add, no overlap)
 *   REPLACE = orange (will rollback old batch(es) then re-import)
 *   SKIP    = gray   (identical file already imported)
 *   REVIEW  = yellow (partial overlap — user MUST choose before proceeding)
 *
 * REVIEW rows block the "Proceed" button until the user selects APPEND or REPLACE.
 */

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { ExistingBatchInfo } from '@/app/(dashboard)/wallets/ads-import-analyze-actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalyzedJob {
  id: string
  fileName: string
  campaignType: 'product' | 'live'
  dateStart: string
  dateEnd: string
  suggestion: 'APPEND' | 'REPLACE' | 'SKIP' | 'REVIEW'
  reason: string
  existingBatches: ExistingBatchInfo[]
  /** null = not yet confirmed (forced for REVIEW state) */
  confirmedAction: 'APPEND' | 'REPLACE' | 'SKIP' | null
  status: 'pending' | 'analyzing' | 'ready' | 'error'
  analyzeError?: string
}

interface AdsImportBatchPreviewProps {
  jobs: AnalyzedJob[]
  onActionChange: (jobId: string, action: 'APPEND' | 'REPLACE' | 'SKIP') => void
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function SuggestionBadge({ s }: { s: AnalyzedJob['suggestion'] }) {
  const cfg = {
    APPEND:  { cls: 'bg-green-100 text-green-800 border-green-300',  label: 'APPEND' },
    REPLACE: { cls: 'bg-orange-100 text-orange-800 border-orange-300', label: 'REPLACE' },
    SKIP:    { cls: 'bg-slate-100 text-slate-600 border-slate-300',  label: 'SKIP' },
    REVIEW:  { cls: 'bg-yellow-100 text-yellow-800 border-yellow-300', label: 'REVIEW' },
  }[s]
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function CampaignBadge({ type }: { type: 'product' | 'live' }) {
  return type === 'live' ? (
    <span className="inline-flex items-center rounded bg-pink-100 text-pink-700 border border-pink-300 px-1.5 py-0.5 text-[11px] font-medium">
      Live
    </span>
  ) : (
    <span className="inline-flex items-center rounded bg-blue-100 text-blue-700 border border-blue-300 px-1.5 py-0.5 text-[11px] font-medium">
      Product
    </span>
  )
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ jobs }: { jobs: AnalyzedJob[] }) {
  const ready = jobs.filter((j) => j.status === 'ready')
  const counts = {
    APPEND:  ready.filter((j) => j.confirmedAction === 'APPEND').length,
    REPLACE: ready.filter((j) => j.confirmedAction === 'REPLACE').length,
    SKIP:    ready.filter((j) => j.confirmedAction === 'SKIP').length,
    REVIEW:  ready.filter((j) => j.confirmedAction === null).length,
  }
  const parts = [
    counts.APPEND  > 0 ? `${counts.APPEND} append`  : null,
    counts.REPLACE > 0 ? `${counts.REPLACE} replace` : null,
    counts.SKIP    > 0 ? `${counts.SKIP} skip`       : null,
    counts.REVIEW  > 0 ? `${counts.REVIEW} ต้องเลือก` : null,
  ].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 border rounded text-xs text-slate-600">
      <span className="font-medium">สรุป:</span>
      {counts.APPEND  > 0 && <span className="text-green-700  font-semibold">{counts.APPEND}  append</span>}
      {counts.REPLACE > 0 && <span className="text-orange-700 font-semibold">{counts.REPLACE} replace</span>}
      {counts.SKIP    > 0 && <span className="text-slate-500  font-semibold">{counts.SKIP}    skip</span>}
      {counts.REVIEW  > 0 && <span className="text-yellow-700 font-semibold">{counts.REVIEW}  ต้องเลือก</span>}
    </div>
  )
}

// ─── Action dropdown cell ─────────────────────────────────────────────────────

function ActionSelect({
  job,
  onChange,
}: {
  job: AnalyzedJob
  onChange: (action: 'APPEND' | 'REPLACE' | 'SKIP') => void
}) {
  // SKIP suggestion: locked — cannot change, already skipped
  if (job.suggestion === 'SKIP') {
    return <span className="text-xs text-slate-400 italic">ข้ามอัตโนมัติ</span>
  }

  // APPEND with no existing batches: locked
  if (job.suggestion === 'APPEND' && job.existingBatches.length === 0) {
    return <span className="text-xs text-green-600 italic">เพิ่มข้อมูล</span>
  }

  const value = job.confirmedAction ?? ''

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as 'APPEND' | 'REPLACE' | 'SKIP')}
    >
      <SelectTrigger
        className={`h-7 text-xs w-28 ${
          job.confirmedAction === null
            ? 'border-yellow-400 focus:ring-yellow-400'
            : ''
        }`}
      >
        <SelectValue placeholder="เลือก..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="APPEND">APPEND</SelectItem>
        <SelectItem value="REPLACE">REPLACE</SelectItem>
        <SelectItem value="SKIP">SKIP</SelectItem>
      </SelectContent>
    </Select>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdsImportBatchPreview({
  jobs,
  onActionChange,
}: AdsImportBatchPreviewProps) {
  const hasOverlapWarning = jobs.some(
    (j) => j.suggestion === 'APPEND' && j.existingBatches.length > 0 && j.confirmedAction === 'APPEND'
  )
  const replaceJobs = jobs.filter((j) => j.confirmedAction === 'REPLACE')

  return (
    <div className="space-y-3">
      <SummaryBar jobs={jobs} />

      {/* Overlap warning: user overrode REPLACE suggestion to APPEND */}
      {hasOverlapWarning && (
        <Alert className="border-amber-300 bg-amber-50 py-2">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-xs">
            ไฟล์บางรายการมีช่วงวันที่ซ้อนทับกับข้อมูลที่มีอยู่ — การเลือก APPEND อาจทำให้ยอดรวมซ้ำซ้อน
          </AlertDescription>
        </Alert>
      )}

      {/* REPLACE confirmation details */}
      {replaceJobs.length > 0 && (
        <Alert className="border-orange-300 bg-orange-50 py-2">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-800 text-xs space-y-1">
            <p className="font-semibold">Batch ที่จะถูก rollback ก่อน import ใหม่:</p>
            {replaceJobs.map((j) =>
              j.existingBatches.map((b) => (
                <p key={b.id} className="pl-2">
                  {j.fileName} — batch{' '}
                  <span className="font-mono text-[10px]">{b.id.slice(0, 8)}...</span>
                  {b.dateMin && b.dateMax ? ` (${b.dateMin} – ${b.dateMax})` : ''}
                  {b.totalSpend != null
                    ? ` | Spend: ${b.totalSpend.toLocaleString('th-TH', { minimumFractionDigits: 2 })} THB`
                    : ''}
                </p>
              ))
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* File table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs">ไฟล์</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-16">ประเภท</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-32">ช่วงวันที่</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-20">ข้อมูลเดิม</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-20">แนะนำ</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-32">การกระทำ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {jobs.map((job) => (
              <tr
                key={job.id}
                className={`bg-white ${job.confirmedAction === null ? 'bg-yellow-50' : ''}`}
              >
                {/* File name */}
                <td className="px-3 py-2">
                  {job.status === 'analyzing' ? (
                    <span className="flex items-center gap-1 text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="truncate max-w-[160px] block" title={job.fileName}>
                        {job.fileName}
                      </span>
                    </span>
                  ) : job.status === 'error' ? (
                    <span className="flex items-center gap-1 text-red-600" title={job.analyzeError}>
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[160px] block">{job.fileName}</span>
                    </span>
                  ) : (
                    <div>
                      <span className="truncate max-w-[160px] block" title={job.fileName}>
                        {job.fileName}
                      </span>
                      {job.analyzeError && (
                        <span className="text-red-500 text-[10px]">{job.analyzeError}</span>
                      )}
                    </div>
                  )}
                </td>

                {/* Campaign type */}
                <td className="px-3 py-2">
                  <CampaignBadge type={job.campaignType} />
                </td>

                {/* Date range */}
                <td className="px-3 py-2 text-slate-600">
                  {job.dateStart && job.dateEnd ? (
                    <span>
                      {job.dateStart}
                      {job.dateStart !== job.dateEnd ? (
                        <>
                          <br />
                          <span className="text-slate-400">– {job.dateEnd}</span>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>

                {/* Existing data count */}
                <td className="px-3 py-2">
                  {job.existingBatches.length === 0 ? (
                    <span className="text-slate-400">ไม่มี</span>
                  ) : (
                    <span className="text-orange-600 font-medium">
                      {job.existingBatches.length} batch
                    </span>
                  )}
                </td>

                {/* Suggested action badge */}
                <td className="px-3 py-2">
                  {job.status === 'analyzing' ? (
                    <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                  ) : job.status === 'ready' || job.status === 'error' ? (
                    <div className="space-y-1">
                      <SuggestionBadge s={job.suggestion} />
                      <p className="text-[10px] text-slate-500 max-w-[120px] leading-tight">
                        {job.reason}
                      </p>
                    </div>
                  ) : null}
                </td>

                {/* Final action dropdown */}
                <td className="px-3 py-2">
                  {job.status === 'ready' ? (
                    <ActionSelect job={job} onChange={(a) => onActionChange(job.id, a)} />
                  ) : job.status === 'analyzing' ? (
                    <span className="text-slate-400 text-[11px]">วิเคราะห์...</span>
                  ) : (
                    <span className="text-red-500 text-[11px]">ข้อผิดพลาด</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Blocker notice for unresolved REVIEW rows */}
      {jobs.some((j) => j.status === 'ready' && j.confirmedAction === null) && (
        <Alert className="border-yellow-300 bg-yellow-50 py-2">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800 text-xs">
            กรุณาเลือกการกระทำสำหรับทุกไฟล์ที่แสดง REVIEW ก่อนดำเนินการ import
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
