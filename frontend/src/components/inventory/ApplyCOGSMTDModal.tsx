'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  ChevronDown,
  AlertTriangle,
  PlayCircle,
  RotateCcw,
  RefreshCw,
} from 'lucide-react'
import { applyCOGSMTD, adminResetStaleCogsRange } from '@/app/(dashboard)/inventory/actions'
import {
  evaluateCogsRunState,
  type RunStateEval,
} from '@/app/(dashboard)/inventory/cogs-run-actions'
import { getTodayBangkokString, getFirstDayOfMonthBangkokString } from '@/lib/bangkok-date-range'
import { useToast } from '@/hooks/use-toast'

interface ApplyCOGSMTDModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  onViewRunDetails?: (runId: string, summary: any) => void
  initialStartDate?: string
  initialEndDate?: string
  isAdmin?: boolean
}

export function ApplyCOGSMTDModal({
  open,
  onOpenChange,
  onSuccess,
  onViewRunDetails,
  initialStartDate,
  initialEndDate,
  isAdmin = false,
}: ApplyCOGSMTDModalProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [chunkProgress, setChunkProgress] = useState<string | null>(null)
  const { toast } = useToast()

  // Date range
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Run state evaluation
  const [evalState, setEvalState] = useState<RunStateEval | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const evalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset confirmation
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetSummary, setResetSummary] = useState<any>(null)

  // ── Initialise on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      const newStart = initialStartDate || getFirstDayOfMonthBangkokString()
      const newEnd   = initialEndDate   || getTodayBangkokString()
      setStartDate(newStart)
      setEndDate(newEnd)
      setResult(null)
      setError(null)
      setResetConfirm(false)
      setResetSummary(null)
      setEvalState(null)
    }
  }, [open, initialStartDate, initialEndDate])

  // ── Re-evaluate whenever dates change ──────────────────────────────────────
  useEffect(() => {
    if (!startDate || !endDate || startDate > endDate) {
      setEvalState(null)
      setResetConfirm(false)
      return
    }
    if (evalTimerRef.current) clearTimeout(evalTimerRef.current)
    evalTimerRef.current = setTimeout(async () => {
      setEvaluating(true)
      try {
        const state = await evaluateCogsRunState(startDate, endDate)
        setEvalState(state)
        setResetConfirm(false)
      } finally {
        setEvaluating(false)
      }
    }, 400)
    return () => { if (evalTimerRef.current) clearTimeout(evalTimerRef.current) }
  }, [startDate, endDate])

  // ── Date helpers ────────────────────────────────────────────────────────────
  function setThisMonth() {
    setStartDate(getFirstDayOfMonthBangkokString())
    setEndDate(getTodayBangkokString())
  }

  function setLastMonth() {
    const today = new Date()
    const year  = today.getFullYear()
    const month = today.getMonth()
    const firstDayLastMonth = new Date(year, month - 1, 1)
    const lmYear  = firstDayLastMonth.getFullYear()
    const lmMonth = String(firstDayLastMonth.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(year, month, 0)
    const ldYear  = lastDay.getFullYear()
    const ldMonth = String(lastDay.getMonth() + 1).padStart(2, '0')
    const ldDay   = String(lastDay.getDate()).padStart(2, '0')
    setStartDate(`${lmYear}-${lmMonth}-01`)
    setEndDate(`${ldYear}-${ldMonth}-${ldDay}`)
  }

  // ── Core run loop (used by both fresh and continue) ──────────────────────────
  async function runAllocationLoop(firstCallMode: 'fresh' | 'continue') {
    const MAX_AUTO_RETRIES = 20
    let autoRetryCount  = 0
    let currentMode: 'fresh' | 'continue' = firstCallMode
    let finalResponse: any = null

    while (true) {
      let progressMsg: string
      if (autoRetryCount > 0) {
        progressMsg = `กำลังประมวลผลต่อ (รอบที่ ${autoRetryCount + 1}) — อาจใช้เวลาสักครู่…`
      } else if (firstCallMode === 'continue' && evalState?.status === 'can_resume') {
        const activePass = evalState.pass1Completed ? 2 : 1
        const activeOffset = evalState.pass1Completed ? evalState.pass2Offset : evalState.pass1Offset
        progressMsg = `กำลังต่อจาก Pass ${activePass} offset ${activeOffset} — อาจใช้เวลาสักครู่…`
      } else if (firstCallMode === 'fresh' && evalState?.status === 'can_resume') {
        const activePass = evalState.pass1Completed ? 2 : 1
        const activeOffset = evalState.pass1Completed ? evalState.pass2Offset : evalState.pass1Offset
        progressMsg = `เริ่มใหม่จาก offset 0 — ข้าม run เก่า (Pass ${activePass} offset ${activeOffset}) — อาจใช้เวลาสักครู่…`
      } else if (firstCallMode === 'fresh' && evalState?.status === 'stale_resume') {
        progressMsg = `เริ่มใหม่จาก offset 0 — ข้าม stale offset — อาจใช้เวลาสักครู่…`
      } else {
        progressMsg = 'กำลังประมวลผล orders ทั้งหมด — อาจใช้เวลาสักครู่…'
      }
      setChunkProgress(progressMsg)

      const response = await applyCOGSMTD({ method: 'FIFO', startDate, endDate, mode: currentMode })

      if (response.success) { finalResponse = response; break }

      if ((response as any).needsResume && autoRetryCount < MAX_AUTO_RETRIES) {
        autoRetryCount++
        currentMode = 'continue'  // After first chunk, always continue the same run chain
        continue
      }

      finalResponse = response
      break
    }

    return finalResponse
  }

  async function refreshEvalState() {
    if (!startDate || !endDate) return
    setEvaluating(true)
    try {
      const state = await evaluateCogsRunState(startDate, endDate)
      setEvalState(state)
      setResetConfirm(false)
    } finally {
      setEvaluating(false)
    }
  }

  // ── "Start fresh" handler ───────────────────────────────────────────────────
  // Automatically runs partial-bundle cleanup before the fresh allocation run.
  // This ensures stale partial rows (from a prior sequential run or failed RPC) are
  // cleared and old failed-run records are marked as reset — so the 'continue' chain
  // in runAllocationLoop never accidentally picks up the old Jan 2026 run offset.
  async function handleFresh() {
    if (!startDate || !endDate) { setError('กรุณาเลือกวันที่'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    setChunkProgress('กำลัง reset partial bundles ก่อน Start Fresh…')

    try {
      // Pre-cleanup: cleans partial bundles + marks old failed runs as reset
      // Non-blocking: if it fails we proceed anyway (applyCOGSMTD also cleans internally)
      const cleanResult = await adminResetStaleCogsRange(startDate, endDate)
      if (!cleanResult.success) {
        console.warn('[handleFresh] pre-cleanup warning (non-fatal):', cleanResult.error)
      } else {
        const s = cleanResult.summary
        console.log(`[handleFresh] pre-cleanup done — partial_found=${s?.partial_orders_found} deleted=${s?.allocation_rows_deleted} layers_restored=${s?.layers_restored} runs_marked=${s?.runs_marked_reset}`)
      }

      const finalResponse = await runAllocationLoop('fresh')
      setChunkProgress(null)
      if (!finalResponse.success) {
        setError(finalResponse.error || 'เกิดข้อผิดพลาด')
        await refreshEvalState()
      } else {
        setResult(finalResponse.data)
        if (onSuccess) onSuccess()
      }
    } catch (err) {
      setChunkProgress(null)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
      await refreshEvalState()
    } finally {
      setLoading(false)
    }
  }

  // ── "Continue" handler ──────────────────────────────────────────────────────
  async function handleContinue() {
    if (!startDate || !endDate) { setError('กรุณาเลือกวันที่'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    setChunkProgress(null)

    try {
      const finalResponse = await runAllocationLoop('continue')
      setChunkProgress(null)
      if (!finalResponse.success) {
        setError(finalResponse.error || 'เกิดข้อผิดพลาด')
        await refreshEvalState()
      } else {
        setResult(finalResponse.data)
        if (onSuccess) onSuccess()
      }
    } catch (err) {
      setChunkProgress(null)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
      await refreshEvalState()
    } finally {
      setLoading(false)
    }
  }

  // ── "Reset stale state and rerun" handler ───────────────────────────────────
  async function handleResetAndRerun() {
    if (!startDate || !endDate) { setError('กรุณาเลือกวันที่'); return }
    if (!resetConfirm) { setResetConfirm(true); return }

    setResetting(true)
    setError(null)
    setResetSummary(null)

    try {
      const resetResult = await adminResetStaleCogsRange(startDate, endDate)
      if (!resetResult.success) {
        setError(`Reset ล้มเหลว: ${resetResult.error}`)
        setResetting(false)
        return
      }
      setResetSummary(resetResult.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset ล้มเหลว')
      setResetting(false)
      return
    }

    setResetting(false)
    setResetConfirm(false)

    // Now run fresh after cleanup
    await handleFresh()
  }

  function handleClose() {
    setResult(null)
    setError(null)
    setResetConfirm(false)
    setResetSummary(null)
    onOpenChange(false)
  }

  const isBlocked = evalState?.status === 'blocked'
  const canResume = evalState?.status === 'can_resume'
  const hasPartial = evalState?.status === 'has_partial_bundles'
  const isStale    = evalState?.status === 'stale_resume'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply COGS (Date Range)</DialogTitle>
          <DialogDescription>
            ตัด COGS สำหรับ orders ที่ shipped ในช่วงวันที่ที่เลือก
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Date Range Selector ─────────────────────────────────────────── */}
          {!result && (
            <div className="space-y-4 p-4 border rounded-md bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4" />
                <span className="text-sm font-semibold">เลือกช่วงวันที่</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">วันที่เริ่มต้น</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={loading || resetting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">วันที่สิ้นสุด</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={loading || resetting}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={setThisMonth} disabled={loading || resetting}>
                  เดือนนี้
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={setLastMonth} disabled={loading || resetting}>
                  เดือนที่แล้ว
                </Button>
              </div>
              {startDate && endDate && (
                <p className="text-xs text-muted-foreground">
                  ช่วงวันที่: <strong>{startDate}</strong> ถึง <strong>{endDate}</strong>
                </p>
              )}
            </div>
          )}

          {/* ── Evaluating state ────────────────────────────────────────────── */}
          {!result && evaluating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>กำลังตรวจสอบสถานะ run…</span>
            </div>
          )}

          {/* ── Blocked ─────────────────────────────────────────────────────── */}
          {!result && !loading && isBlocked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>มี Run กำลังทำงานอยู่</AlertTitle>
              <AlertDescription>{evalState!.message}</AlertDescription>
            </Alert>
          )}

          {/* ── Stale resume warning ─────────────────────────────────────────── */}
          {!result && !loading && isStale && (
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-200">Run State ไม่ Valid</AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm">
                {evalState!.message}
                <br />
                <span className="font-medium">ต้องใช้ &quot;Start Fresh&quot; — ไม่สามารถ Continue ได้</span>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Can resume ──────────────────────────────────────────────────── */}
          {!result && !loading && canResume && (
            <div className="rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-start gap-2">
              <PlayCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-blue-800 dark:text-blue-200">มี Run ค้างอยู่ — Continue ได้</p>
                <p className="text-blue-700 dark:text-blue-300 text-xs mt-0.5">
                  {evalState!.message}
                </p>
              </div>
            </div>
          )}

          {/* ── Partial bundles warning ──────────────────────────────────────── */}
          {!result && !loading && hasPartial && (
            <Alert className="border-red-300 bg-red-50 dark:bg-red-950/20">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-800 dark:text-red-200">
                พบ Bundle orders ที่ allocate ไม่ครบ
              </AlertTitle>
              <AlertDescription className="text-red-700 dark:text-red-300 text-sm space-y-1">
                <p>{evalState!.message}</p>
                <p className="font-medium">
                  ต้องใช้ &quot;Reset stale state และ Rerun&quot; เพื่อแก้ไขก่อน
                  {!isAdmin && ' (เฉพาะ Admin)'}
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Reset confirmation ───────────────────────────────────────────── */}
          {!result && !loading && resetConfirm && (
            <Alert className="border-red-400 bg-red-50 dark:bg-red-950/20">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-800 dark:text-red-200">ยืนยันการ Reset</AlertTitle>
              <AlertDescription className="text-red-700 dark:text-red-300 text-sm">
                ระบบจะ:
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  <li>ลบ allocation rows ที่ไม่ครบสำหรับ Bundle orders ในช่วงวันที่นี้</li>
                  <li>คืน qty_remaining ให้ receipt layers ที่เกี่ยวข้อง</li>
                  <li>Mark failed run records ว่า reset แล้ว</li>
                  <li>เริ่ม Fresh run ใหม่ทันที</li>
                </ul>
                <p className="mt-2 font-semibold">กด &quot;ยืนยัน Reset และ Rerun&quot; เพื่อดำเนินการ</p>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Reset summary ────────────────────────────────────────────────── */}
          {resetSummary && (
            <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 p-3 text-sm">
              <p className="font-semibold text-green-800 dark:text-green-200 mb-1">Reset เสร็จสิ้น — กำลังเริ่ม Run ใหม่…</p>
              <div className="text-green-700 dark:text-green-300 text-xs space-y-0.5">
                <p>Bundle orders checked: {resetSummary.bundle_orders_checked}</p>
                <p>Partial orders found: {resetSummary.partial_orders_found}</p>
                <p>Allocation rows deleted: {resetSummary.allocation_rows_deleted}</p>
                <p>Layers restored: {resetSummary.layers_restored}</p>
              </div>
            </div>
          )}

          {/* ── Default info (clean state) ───────────────────────────────────── */}
          {!result && !error && !evaluating && evalState?.status === 'clean' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>คำอธิบาย</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>ระบบตัด COGS สำหรับ orders ที่ shipped ในช่วงวันที่นี้</li>
                  <li>Bundle orders จะ allocate แบบ Atomic — ทุก component สำเร็จหรือไม่มีเลย</li>
                  <li>Skip orders ที่ allocated แล้ว (idempotent)</li>
                  <li><strong>ปลอดภัย:</strong> กดซ้ำได้ ไม่ duplicate</li>
                  <li><strong>รองรับ orders จำนวนมาก:</strong> ประมวลผลเป็น batch</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Error ───────────────────────────────────────────────────────── */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
              <AlertDescription>
                <div className="space-y-1">
                  <p>{error}</p>
                  {error.includes('INSUFFICIENT_STOCK') && (
                    <p className="text-xs font-medium mt-1">
                      สาเหตุ: Stock ไม่เพียงพอสำหรับ SKU ที่ระบุ — ตรวจสอบ receipt layers ใน Inventory
                    </p>
                  )}
                  {error.toLowerCase().includes('timeout') && (
                    <p className="text-xs font-medium mt-1">
                      Timeout — กด <strong>Continue Run</strong> เพื่อดำเนินการต่อจาก offset ที่ค้างอยู่
                    </p>
                  )}
                  {error.includes('stale') && (
                    <p className="text-xs font-medium mt-1">
                      สาเหตุ: Run state ไม่ valid — ลอง Start Fresh
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Progress ─────────────────────────────────────────────────────── */}
          {(loading || resetting) && chunkProgress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{chunkProgress}</span>
            </div>
          )}

          {/* ── Result ───────────────────────────────────────────────────────── */}
          {result && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>เสร็จสิ้น</AlertTitle>
                <AlertDescription>{result.message || 'ประมวลผลเสร็จสิ้น'}</AlertDescription>
              </Alert>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold">{result.total}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Eligible</p>
                  <p className="text-2xl font-bold text-blue-600">{result.eligible}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Successful</p>
                  <p className="text-2xl font-bold text-green-600">{result.successful}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Skipped</p>
                  <p className="text-xl font-semibold text-yellow-600">{result.skipped}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-xl font-semibold text-red-600">{result.failed}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Partial</p>
                  <p className="text-xl font-semibold text-orange-600">{result.partial ?? 0}</p>
                </div>
              </div>

              {result.run_id && (
                <div className="border rounded-md p-4 bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Run ID</p>
                      <p className="text-xs font-mono text-blue-600">{result.run_id}</p>
                    </div>
                    {onViewRunDetails && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewRunDetails(result.run_id, {
                          start_date: startDate,
                          end_date: endDate,
                          method: 'FIFO',
                          total: result.total,
                          successful: result.successful,
                          skipped: result.skipped,
                          failed: result.failed,
                        })}
                      >
                        View Run Details
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {result.skip_reasons && result.skip_reasons.length > 0 && (
                <Collapsible className="space-y-2 border rounded-md p-4">
                  <CollapsibleTrigger className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      <p className="text-sm font-semibold">
                        Skip Reasons ({result.skip_reasons.length} categories)
                      </p>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    {result.skip_reasons.map((reason: any, idx: number) => (
                      <div key={idx} className="border-l-4 border-yellow-500 pl-3 py-2 bg-yellow-50/50">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold text-sm">{reason.label}</p>
                          <Badge variant="secondary">{reason.count} orders</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Code: <span className="font-mono">{reason.code}</span>
                        </p>
                        {reason.code === 'ALLOCATION_FAILED' && (
                          <p className="text-xs text-orange-700 font-medium">
                            ตรวจสอบ: Stock ไม่พอ / ไม่มี receipt layer / Bundle ไม่มี recipe
                          </p>
                        )}
                        {reason.code === 'INSUFFICIENT_STOCK' && (
                          <p className="text-xs text-red-700 font-medium">
                            Stock ไม่เพียงพอ — เพิ่ม receipt layer สำหรับ SKU ที่ระบุ
                          </p>
                        )}
                        {reason.samples && reason.samples.length > 0 && (
                          <div className="space-y-1 mt-1">
                            <p className="text-xs font-medium">ตัวอย่าง:</p>
                            {reason.samples.map((sample: any, sIdx: number) => (
                              <div key={sIdx} className="text-xs flex items-center gap-2 bg-white rounded px-2 py-1">
                                <span className="font-mono text-blue-600">{sample.order_id}</span>
                                {sample.sku && <span className="text-muted-foreground">SKU: {sample.sku}</span>}
                                {sample.detail && <span className="text-orange-600">{sample.detail}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>

        {/* ── Footer / Action Buttons ─────────────────────────────────────────── */}
        <DialogFooter>
          {!result && (
            <div className="flex w-full gap-2 flex-wrap justify-end items-center">
              {/* Progress message on the left */}
              {(loading || resetting) && !chunkProgress && (
                <p className="text-xs text-muted-foreground flex-1">
                  ปิดหน้าต่างได้ ระบบจะแจ้งเตือนที่กระดิ่งเมื่อเสร็จ
                </p>
              )}

              <Button variant="outline" onClick={handleClose} disabled={resetting}>
                ยกเลิก
              </Button>

              {/* ── Button: Reset stale and rerun (admin only) ── */}
              {!loading && isAdmin && (hasPartial || isStale) && (
                <Button
                  variant="destructive"
                  onClick={handleResetAndRerun}
                  disabled={resetting || evaluating || !startDate || !endDate}
                  className="gap-1"
                >
                  {resetting
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> กำลัง Reset…</>
                    : resetConfirm
                    ? <><RotateCcw className="h-4 w-4" /> ยืนยัน Reset และ Rerun</>
                    : <><RotateCcw className="h-4 w-4" /> Reset stale state และ Rerun</>
                  }
                </Button>
              )}

              {/* ── Button: Continue previous run ── */}
              {!loading && canResume && (
                <Button
                  variant="outline"
                  onClick={handleContinue}
                  disabled={loading || evaluating || isBlocked || !startDate || !endDate}
                  className="gap-1 border-blue-400 text-blue-700 hover:bg-blue-50"
                >
                  <PlayCircle className="h-4 w-4" />
                  Continue Run
                </Button>
              )}

              {/* ── Button: Start fresh ── */}
              <Button
                onClick={handleFresh}
                disabled={loading || resetting || evaluating || isBlocked || !startDate || !endDate}
                className="gap-1"
              >
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> กำลังประมวลผล…</>
                  : <><RefreshCw className="h-4 w-4" /> Start Fresh</>
                }
              </Button>
            </div>
          )}

          {result && (
            <Button onClick={handleClose} className="w-full">ปิด</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
