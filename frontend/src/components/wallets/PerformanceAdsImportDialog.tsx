'use client'

/**
 * Performance Ads Import Dialog (v3 — analyze → preview → import)
 *
 * Flow:
 *   select   → user adds files, sets dates/types
 *   analyzing → per-file analysis (parse + DB lookup) runs sequentially
 *   preview  → AdsImportBatchPreview table: user confirms/overrides actions
 *   importing → processes each job: SKIP (noop), REPLACE (rollback+import), APPEND (import)
 *   summary  → results shown; bell notification if dialog closed during processing
 *
 * Key constraints:
 *   - No localStorage/sessionStorage
 *   - File hash computed in addFiles (early) so it's available for analysis
 *   - parsedPreview cached in FileJob to avoid re-parsing in import step
 *   - REVIEW rows block import until user resolves them
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import {
  MAX_IMPORT_FILE_SIZE_BYTES,
  MAX_IMPORT_FILE_SIZE_LABEL,
  REJECTED_MIME_RE,
} from '@/lib/import-constraints'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Upload,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Calendar as CalendarIcon,
  Info,
  Search,
} from 'lucide-react'
import { format } from 'date-fns'
import { getBangkokNow } from '@/lib/bangkok-time'
import {
  createAdsImportPreview,
  confirmAdsImport,
  createAdsImportNotification,
} from '@/app/(dashboard)/wallets/performance-ads-import-actions'
import {
  analyzeAdsImportFile,
  rollbackBatches,
} from '@/app/(dashboard)/wallets/ads-import-analyze-actions'
import type { ExistingBatchInfo } from '@/app/(dashboard)/wallets/ads-import-analyze-actions'
import { parseTikTokAdsFile } from '@/lib/parsers/tiktok-ads-parser'
import type { TikTokAdsPreview } from '@/lib/parsers/tiktok-ads-parser'
import {
  AdsImportBatchPreview,
} from '@/components/wallets/AdsImportBatchPreview'
import type { AnalyzedJob } from '@/components/wallets/AdsImportBatchPreview'

// ── Types ──────────────────────────────────────────────────────────────────────

type DialogStep = 'select' | 'analyzing' | 'preview' | 'importing' | 'summary'

interface FileJob {
  id: string
  file: File
  fileBuffer: Uint8Array | null
  fileHash: string | null          // computed in addFiles (early)
  detectedDate: string | null      // auto-detect from filename YYYY-MM-DD
  manualDate: Date | null          // user override
  campaignType: 'product' | 'live'
  // Analyze step results
  analyzed: boolean
  analyzing: boolean
  suggestion?: 'APPEND' | 'REPLACE' | 'SKIP' | 'REVIEW'
  suggestedReason?: string
  scopeKey?: string
  existingBatches?: ExistingBatchInfo[]
  confirmedAction?: 'APPEND' | 'REPLACE' | 'SKIP' | null
  dateStart?: string
  dateEnd?: string
  parsedPreview?: TikTokAdsPreview  // cached after analysis parse
  analyzeError?: string
  // Import step
  status: 'pending' | 'parsing' | 'staging' | 'confirming' | 'done' | 'skipped' | 'error'
  batchId: string | null
  totalSpend?: number
  totalGMV?: number
  totalOrders?: number
  error?: string
}

interface SummaryData {
  total: number
  done: number
  skipped: number
  failed: number
  totalSpend: number
  totalGMV: number
  totalOrders: number
}

type ImportResult = {
  fileName: string
  status: 'done' | 'skipped' | 'error'
  spend?: number
  gmv?: number
  orders?: number
  batchId?: string
  error?: string
}

interface PerformanceAdsImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  adsWalletId: string
  onImportSuccess: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function detectDateFromFilename(filename: string): string | null {
  const patterns: Array<{ re: RegExp; fn: (m: RegExpMatchArray) => string }> = [
    { re: /(\d{4})-(\d{2})-(\d{2})/, fn: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { re: /(\d{4})(\d{2})(\d{2})/, fn: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { re: /(\d{2})-(\d{2})-(\d{4})/, fn: (m) => `${m[3]}-${m[2]}-${m[1]}` },
  ]
  for (const { re, fn } of patterns) {
    const m = filename.match(re)
    if (m) {
      const dateStr = fn(m)
      const d = new Date(dateStr)
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return dateStr
    }
  }
  return null
}

function detectCampaignType(filename: string): 'product' | 'live' {
  const lower = filename.toLowerCase()
  if (lower.includes('live') || lower.includes('livestream')) return 'live'
  return 'product'
}

let _jobCounter = 0
function genId(): string {
  return `job-${++_jobCounter}-${Math.random().toString(36).slice(2, 6)}`
}

function getEffectiveDate(job: FileJob): string | null {
  if (job.manualDate) return format(job.manualDate, 'yyyy-MM-dd')
  return job.detectedDate
}

async function computeHash(buffer: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PerformanceAdsImportDialog({
  open,
  onOpenChange,
  adsWalletId,
  onImportSuccess,
}: PerformanceAdsImportDialogProps) {
  const { toast } = useToast()
  const [step, setStep] = useState<DialogStep>('select')
  const [fileJobs, setFileJobs] = useState<FileJob[]>([])
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Track open state in a ref so async callbacks can read it after resolution
  const isOpenRef = useRef(open)
  useEffect(() => {
    isOpenRef.current = open
  }, [open])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateJob = useCallback((id: string, patch: Partial<FileJob>) => {
    setFileJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  // ── addFiles: read buffer + compute hash early ────────────────────────────────
  const addFiles = useCallback(
    async (files: File[]) => {
      const newJobs: FileJob[] = []
      for (const file of files) {
        if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
          toast({
            variant: 'destructive',
            title: 'ไฟล์ใหญ่เกินไป',
            description: `"${file.name}" เกิน ${MAX_IMPORT_FILE_SIZE_LABEL}`,
          })
          continue
        }
        if (file.type && REJECTED_MIME_RE.test(file.type)) {
          toast({
            variant: 'destructive',
            title: 'ประเภทไฟล์ไม่รองรับ',
            description: `"${file.name}" ต้องเป็น .xlsx`,
          })
          continue
        }
        let fileBuffer: Uint8Array | null = null
        let fileHash: string | null = null
        try {
          fileBuffer = new Uint8Array(await file.arrayBuffer())
          fileHash = await computeHash(fileBuffer)
        } catch {
          toast({ variant: 'destructive', title: 'อ่านไฟล์ไม่ได้', description: file.name })
          continue
        }
        newJobs.push({
          id: genId(),
          file,
          fileBuffer,
          fileHash,
          detectedDate: detectDateFromFilename(file.name),
          manualDate: null,
          campaignType: detectCampaignType(file.name),
          analyzed: false,
          analyzing: false,
          status: 'pending',
          batchId: null,
        })
      }
      if (newJobs.length > 0) {
        setFileJobs((prev) => [...prev, ...newJobs])
      }
    },
    [toast]
  )

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) addFiles(files)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.xlsx'))
    if (files.length > 0) addFiles(files)
  }

  const allHaveDates =
    fileJobs.length > 0 && fileJobs.every((j) => getEffectiveDate(j) !== null)

  // ── handleAnalyze: parse + DB lookup per file → go to preview ────────────────
  const handleAnalyze = async () => {
    if (!allHaveDates) return
    setStep('analyzing')

    // Work on snapshot to avoid stale closure issues
    const snapshot = [...fileJobs]

    for (const job of snapshot) {
      const effectiveDateStr = getEffectiveDate(job)
      if (!effectiveDateStr || !job.fileBuffer || !job.fileHash) {
        updateJob(job.id, {
          analyzing: false,
          analyzed: true,
          analyzeError: 'ไม่มีวันที่หรือไฟล์',
          suggestion: 'APPEND',
          confirmedAction: 'APPEND',
          status: 'pending',
        })
        continue
      }

      // Mark as analyzing so UI can show spinner
      updateJob(job.id, { analyzing: true })

      // 1. Parse file client-side
      const parseResult = await parseTikTokAdsFile(
        job.fileBuffer,
        job.file.name,
        effectiveDateStr
      )

      if (!parseResult.success || !parseResult.preview) {
        updateJob(job.id, {
          analyzing: false,
          analyzed: true,
          analyzeError: parseResult.error ?? 'parse ล้มเหลว',
          suggestion: 'APPEND',
          confirmedAction: 'APPEND',
          status: 'pending',
        })
        continue
      }

      const preview = parseResult.preview
      const dates = preview.dailyBreakdown
        .map((r) => r.date)
        .filter((d): d is string => typeof d === 'string' && d.length > 0)
        .sort()
      const dateStart = dates[0] ?? effectiveDateStr
      const dateEnd = dates[dates.length - 1] ?? effectiveDateStr

      // 2. Call server action for DB analysis
      let analyzeResult
      try {
        analyzeResult = await analyzeAdsImportFile({
          fileHash: job.fileHash,
          campaignType: job.campaignType,
          dateStart,
          dateEnd,
        })
      } catch (err) {
        analyzeResult = {
          suggestion: 'APPEND' as const,
          reason: err instanceof Error ? err.message : 'วิเคราะห์ไม่ได้',
          scopeKey: '',
          existingBatches: [],
        }
      }

      updateJob(job.id, {
        parsedPreview: preview,
        dateStart,
        dateEnd,
        analyzed: true,
        analyzing: false,
        suggestion: analyzeResult.suggestion,
        suggestedReason: analyzeResult.reason,
        scopeKey: analyzeResult.scopeKey,
        existingBatches: analyzeResult.existingBatches,
        // null = unresolved for REVIEW; otherwise use suggestion directly
        confirmedAction:
          analyzeResult.suggestion === 'REVIEW' ? null : analyzeResult.suggestion,
        status: 'pending',
      })
    }

    setStep('preview')
  }

  // ── handleActionChange: called by AdsImportBatchPreview ──────────────────────
  const handleActionChange = useCallback(
    (jobId: string, action: 'APPEND' | 'REPLACE' | 'SKIP') => {
      updateJob(jobId, { confirmedAction: action })
    },
    [updateJob]
  )

  // Derived: are all preview rows resolved?
  const analyzedJobs: AnalyzedJob[] = fileJobs
    .filter((j) => j.analyzed)
    .map((j) => ({
      id: j.id,
      fileName: j.file.name,
      campaignType: j.campaignType,
      dateStart: j.dateStart ?? '',
      dateEnd: j.dateEnd ?? '',
      suggestion: j.suggestion ?? 'APPEND',
      reason: j.suggestedReason ?? '',
      existingBatches: j.existingBatches ?? [],
      confirmedAction: j.confirmedAction ?? null,
      status: j.analyzing
        ? 'analyzing'
        : j.analyzed
          ? 'ready'
          : 'pending',
      analyzeError: j.analyzeError,
    }))

  // Also include jobs still being analyzed (show spinner rows)
  const allJobsForPreview: AnalyzedJob[] = fileJobs.map((j) => ({
    id: j.id,
    fileName: j.file.name,
    campaignType: j.campaignType,
    dateStart: j.dateStart ?? '',
    dateEnd: j.dateEnd ?? '',
    suggestion: j.suggestion ?? 'APPEND',
    reason: j.suggestedReason ?? '',
    existingBatches: j.existingBatches ?? [],
    confirmedAction: j.confirmedAction ?? null,
    status: j.analyzing ? 'analyzing' : j.analyzed ? 'ready' : 'pending',
    analyzeError: j.analyzeError,
  }))

  const allResolved =
    analyzedJobs.length > 0 &&
    analyzedJobs.every((j) => j.confirmedAction !== null)

  // ── handleImportAll: uses confirmed actions + cached parsedPreview ────────────
  const handleImportAll = async () => {
    if (!allResolved) return
    setStep('importing')

    const results: ImportResult[] = []
    const jobs = [...fileJobs]

    for (const job of jobs) {
      // SKIP
      if (job.confirmedAction === 'SKIP') {
        updateJob(job.id, { status: 'skipped' })
        results.push({ fileName: job.file.name, status: 'skipped' })
        continue
      }

      const effectiveDateStr = getEffectiveDate(job)
      if (!effectiveDateStr || !job.fileBuffer) {
        const err = 'ไม่มีวันที่หรือไฟล์'
        updateJob(job.id, { status: 'error', error: err })
        results.push({ fileName: job.file.name, status: 'error', error: err })
        continue
      }

      // REPLACE: rollback old batches first
      if (job.confirmedAction === 'REPLACE' && (job.existingBatches?.length ?? 0) > 0) {
        const batchIds = (job.existingBatches ?? []).map((b) => b.id)
        updateJob(job.id, { status: 'staging' })
        const rollbackResult = await rollbackBatches(batchIds)
        if (!rollbackResult.success) {
          const failedIds = rollbackResult.results
            .filter((r) => !r.ok)
            .map((r) => r.batchId.slice(0, 8))
            .join(', ')
          const err = `Rollback ล้มเหลว (${failedIds})`
          updateJob(job.id, { status: 'error', error: err })
          results.push({ fileName: job.file.name, status: 'error', error: err })
          continue
        }
      }

      // Use cached parsedPreview from analyze step; re-parse only if missing
      let preview = job.parsedPreview
      if (!preview) {
        updateJob(job.id, { status: 'parsing' })
        const parseResult = await parseTikTokAdsFile(
          job.fileBuffer,
          job.file.name,
          effectiveDateStr
        )
        if (!parseResult.success || !parseResult.preview) {
          const err = parseResult.error ?? 'parse ล้มเหลว'
          updateJob(job.id, { status: 'error', error: err })
          results.push({ fileName: job.file.name, status: 'error', error: err })
          continue
        }
        preview = parseResult.preview
      }

      // Compute hash (already computed in addFiles; use it directly)
      const fileHash = job.fileHash
      if (!fileHash) {
        const err = 'hash ไม่พร้อม'
        updateJob(job.id, { status: 'error', error: err })
        results.push({ fileName: job.file.name, status: 'error', error: err })
        continue
      }

      // createAdsImportPreview (staging)
      updateJob(job.id, { status: 'staging' })
      const previewResult = await createAdsImportPreview({
        fileName: job.file.name,
        campaignType: job.campaignType,
        reportDate: effectiveDateStr,
        fileHash,
        currency: preview.currency,
        rows: preview.dailyBreakdown,
        totalSpend: preview.totalSpend,
        totalGMV: preview.totalGMV,
        totalOrders: preview.totalOrders,
        avgROAS: preview.avgROAS,
        rowCount: preview.rowCount,
        daysCount: preview.daysCount,
        reportDateRange: preview.reportDateRange,
      })

      if (!previewResult.success) {
        const err = previewResult.error ?? 'staging ล้มเหลว'
        updateJob(job.id, { status: 'error', error: err })
        results.push({ fileName: job.file.name, status: 'error', error: err })
        continue
      }

      // confirmAdsImport
      updateJob(job.id, { status: 'confirming' })
      const confirmResult = await confirmAdsImport(previewResult.batchId!, adsWalletId)
      if (!confirmResult.success) {
        const err = confirmResult.error ?? 'confirm ล้มเหลว'
        updateJob(job.id, { status: 'error', error: err })
        results.push({ fileName: job.file.name, status: 'error', error: err })
        continue
      }

      updateJob(job.id, {
        status: 'done',
        batchId: previewResult.batchId,
        totalSpend: preview.totalSpend,
        totalGMV: preview.totalGMV,
        totalOrders: preview.totalOrders,
      })
      results.push({
        fileName: job.file.name,
        status: 'done',
        spend: preview.totalSpend,
        gmv: preview.totalGMV,
        orders: preview.totalOrders,
        batchId: previewResult.batchId,
      })
    }

    onImportSuccess()

    const doneResults = results.filter((r) => r.status === 'done')
    const summary: SummaryData = {
      total: results.length,
      done: doneResults.length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'error').length,
      totalSpend: doneResults.reduce((s, r) => s + (r.spend ?? 0), 0),
      totalGMV: doneResults.reduce((s, r) => s + (r.gmv ?? 0), 0),
      totalOrders: doneResults.reduce((s, r) => s + (r.orders ?? 0), 0),
    }

    if (isOpenRef.current) {
      setSummaryData(summary)
      setStep('summary')
    } else {
      await createAdsImportNotification(results.map((r) => ({
        ...r,
        status: r.status === 'skipped' ? 'done' : r.status,
      })))
    }
  }

  const handleClose = () => {
    if (step !== 'importing') {
      setFileJobs([])
      setSummaryData(null)
      setStep('select')
    }
    onOpenChange(false)
  }

  const isProcessing = step === 'importing'

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Import Performance Ads
          </DialogTitle>
          <DialogDescription>
            {step === 'select' && 'อัพโหลดหลายไฟล์พร้อมกัน — ระบบ auto-detect วันที่และประเภทจากชื่อไฟล์'}
            {step === 'analyzing' && 'กำลังวิเคราะห์ไฟล์และตรวจสอบข้อมูลที่มีอยู่...'}
            {step === 'preview' && 'ตรวจสอบและยืนยันการกระทำสำหรับแต่ละไฟล์ก่อน import'}
            {step === 'importing' && 'กำลัง import — สามารถปิดหน้าต่างได้ ระบบจะแจ้งเตือนเมื่อเสร็จ'}
            {step === 'summary' && 'Import เสร็จสิ้น'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">

          {/* ── SUMMARY ───────────────────────────────────────────────────── */}
          {step === 'summary' && summaryData && (
            <div
              className={`rounded-lg border p-4 space-y-2 ${
                summaryData.failed === 0
                  ? 'bg-green-50 border-green-200'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div
                className={`flex items-center gap-2 font-semibold ${
                  summaryData.failed === 0 ? 'text-green-800' : 'text-amber-800'
                }`}
              >
                <CheckCircle className="h-5 w-5" />
                Import เสร็จสิ้น
              </div>
              <p
                className={`text-sm ${
                  summaryData.failed === 0 ? 'text-green-700' : 'text-amber-700'
                }`}
              >
                {summaryData.done}/{summaryData.total} ไฟล์ | Spend:{' '}
                {summaryData.totalSpend.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                THB | GMV:{' '}
                {summaryData.totalGMV.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                THB | Orders: {summaryData.totalOrders}
              </p>
              {summaryData.skipped > 0 && (
                <p className="text-sm text-slate-600">{summaryData.skipped} ไฟล์ข้ามไป (SKIP)</p>
              )}
              {summaryData.failed > 0 && (
                <p className="text-sm text-red-600">{summaryData.failed} ไฟล์ล้มเหลว</p>
              )}
            </div>
          )}

          {/* ── PREVIEW ───────────────────────────────────────────────────── */}
          {step === 'preview' && (
            <AdsImportBatchPreview
              jobs={allJobsForPreview}
              onActionChange={handleActionChange}
            />
          )}

          {/* ── ANALYZING (step transition: show table with spinners) ───────── */}
          {step === 'analyzing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                วิเคราะห์ไฟล์และตรวจสอบฐานข้อมูล...
              </div>
              <AdsImportBatchPreview
                jobs={allJobsForPreview}
                onActionChange={handleActionChange}
              />
            </div>
          )}

          {/* ── SELECT + IMPORTING ────────────────────────────────────────── */}
          {(step === 'select' || step === 'importing') && (
            <>
              {/* Dropzone (hidden during import) */}
              {step === 'select' && (
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  onDrop={handleDrop}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">
                    ลากวางไฟล์หรือคลิกเพื่อเลือก
                  </p>
                  <p className="text-xs text-gray-500 mt-1">รองรับหลายไฟล์พร้อมกัน (.xlsx)</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    multiple
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                </div>
              )}

              {/* File Table */}
              {fileJobs.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs">
                          ไฟล์
                        </th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-32">
                          วันที่
                        </th>
                        {isProcessing ? (
                          <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs">
                            สถานะ
                          </th>
                        ) : (
                          <>
                            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs w-32">
                              ประเภท
                            </th>
                            <th className="px-2 py-2 w-8" />
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {fileJobs.map((job) => {
                        const effectiveDate = getEffectiveDate(job)
                        return (
                          <tr key={job.id} className="bg-white">
                            <td className="px-3 py-2">
                              <span
                                className="truncate max-w-[200px] block text-xs"
                                title={job.file.name}
                              >
                                {job.file.name}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {effectiveDate ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs">
                                    {format(
                                      new Date(effectiveDate + 'T00:00:00'),
                                      'dd/MM/yy'
                                    )}
                                  </span>
                                  {job.detectedDate && !job.manualDate && (
                                    <span
                                      className="text-[10px] text-blue-500"
                                      title="Auto-detected"
                                    >
                                      auto
                                    </span>
                                  )}
                                </div>
                              ) : isProcessing ? (
                                <span className="text-xs text-slate-400">—</span>
                              ) : (
                                <DatePickerCell
                                  job={job}
                                  onDateChange={(d) =>
                                    updateJob(job.id, { manualDate: d })
                                  }
                                />
                              )}
                            </td>
                            {isProcessing ? (
                              <td className="px-3 py-2">
                                <ImportStatusBadge
                                  status={job.status}
                                  spend={job.totalSpend}
                                  error={job.error}
                                />
                              </td>
                            ) : (
                              <>
                                <td className="px-3 py-2">
                                  <Select
                                    value={job.campaignType}
                                    onValueChange={(v) =>
                                      updateJob(job.id, {
                                        campaignType: v as 'product' | 'live',
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-xs w-28">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="product">Product</SelectItem>
                                      <SelectItem value="live">Live</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <button
                                    onClick={() =>
                                      setFileJobs((prev) =>
                                        prev.filter((j) => j.id !== job.id)
                                      )
                                    }
                                    className="text-slate-400 hover:text-red-500 transition-colors"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Warning: missing dates */}
              {fileJobs.length > 0 && !allHaveDates && step === 'select' && (
                <Alert className="border-yellow-300 bg-yellow-50 py-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-800 text-xs">
                    ไฟล์บางรายการไม่มีวันที่ — กรุณาระบุวันที่ก่อน Import
                  </AlertDescription>
                </Alert>
              )}

              {/* Processing notice */}
              {isProcessing && (
                <Alert className="border-blue-200 bg-blue-50 py-2">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800 text-xs">
                    ปิดหน้าต่างได้ ระบบจะแจ้งเตือนที่กระดิ่งเมื่อเสร็จ
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-500">
              {step === 'select' && fileJobs.length > 0
                ? `${fileJobs.length} ไฟล์เลือกไว้`
                : step === 'preview'
                  ? `${fileJobs.length} ไฟล์ — ตรวจสอบแล้ว`
                  : null}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                ปิด
              </Button>

              {/* SELECT → Analyze button */}
              {step === 'select' && fileJobs.length > 0 && (
                <Button
                  onClick={handleAnalyze}
                  disabled={!allHaveDates}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Search className="h-4 w-4 mr-1" />
                  วิเคราะห์ {fileJobs.length} ไฟล์
                </Button>
              )}

              {/* PREVIEW → Import button */}
              {step === 'preview' && (
                <Button
                  onClick={handleImportAll}
                  disabled={!allResolved}
                  className="bg-blue-600 hover:bg-blue-700"
                  title={!allResolved ? 'กรุณาเลือกการกระทำสำหรับทุกไฟล์ก่อน' : undefined}
                >
                  Import{' '}
                  {fileJobs.filter((j) => j.confirmedAction !== 'SKIP').length} ไฟล์
                  {fileJobs.filter((j) => j.confirmedAction === 'SKIP').length > 0 &&
                    ` (ข้าม ${fileJobs.filter((j) => j.confirmedAction === 'SKIP').length})`}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ImportStatusBadge({
  status,
  spend,
  error,
}: {
  status: FileJob['status']
  spend?: number
  error?: string
}) {
  if (status === 'done') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <CheckCircle className="h-3 w-3 shrink-0" />
        Done
        {spend !== undefined
          ? ` (${Math.round(spend).toLocaleString('th-TH')} THB)`
          : ''}
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="flex items-center gap-1 text-xs text-slate-400">
        <CheckCircle className="h-3 w-3 shrink-0" />
        ข้ามไป
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span
        className="flex items-center gap-1 text-xs text-red-600"
        title={error}
      >
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span className="truncate max-w-[160px]">{error ?? 'ล้มเหลว'}</span>
      </span>
    )
  }
  if (status === 'pending') {
    return <span className="text-xs text-slate-400">รอ</span>
  }
  const label =
    status === 'parsing'
      ? 'parse...'
      : status === 'staging'
        ? 'stage...'
        : 'import...'
  return (
    <span className="flex items-center gap-1 text-xs text-blue-600">
      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      {label}
    </span>
  )
}

function DatePickerCell({
  job,
  onDateChange,
}: {
  job: FileJob
  onDateChange: (date: Date) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs border-yellow-400 text-yellow-700 hover:bg-yellow-50"
        >
          <CalendarIcon className="h-3 w-3 mr-1" />
          ระบุ
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={job.manualDate || undefined}
          onSelect={(d) => {
            if (d) onDateChange(d)
          }}
          disabled={(date) => date > getBangkokNow()}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}
