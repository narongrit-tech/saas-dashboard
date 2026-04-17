'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ArrowLeft, X, Loader2, Eye, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PreviewSummary {
  rowCount: number
  validRowCount: number
  preWriteRejectedRowCount: number
  isDuplicateFile: boolean
  existingBatchId: string | null
  missingCriticalFieldCounts: Record<string, number>
}

interface ImportResult {
  batchId: string
  fileName: string
  stagedRowCount: number
  preWriteRejectedRowCount: number
  winnerRowCount: number
  missingKeyRowCount: number
  invalidValueRowCount: number
  duplicateNonWinnerRowCount: number
}

interface QueueItem {
  id: string
  file: File
  status: 'queued' | 'previewing' | 'previewed' | 'importing' | 'done' | 'error'
  previewSummary: PreviewSummary | null
  result: ImportResult | null
  errorMessage: string | null
}

interface UploadErrorPayload {
  code: string
  message: string
  stage?: string
}

async function previewFile(file: File): Promise<PreviewSummary> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/content-ops/tiktok-affiliate/preview', {
    method: 'POST',
    body: formData,
  })
  const json = await res.json()

  if (!res.ok || json.ok === false) {
    const payload = json.error as UploadErrorPayload | undefined
    throw new Error(payload?.message ?? 'Preview failed')
  }

  const p = json.preview
  return {
    rowCount: p.rowCount ?? 0,
    validRowCount: p.validRowCount ?? 0,
    preWriteRejectedRowCount: p.preWriteRejectedRowCount ?? 0,
    isDuplicateFile: p.isDuplicateFile ?? false,
    existingBatchId: p.existingBatchId ?? null,
    missingCriticalFieldCounts: p.missingCriticalFieldCounts ?? {},
  }
}

async function uploadFile(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/content-ops/tiktok-affiliate/upload', {
    method: 'POST',
    body: formData,
  })
  const json = await res.json()

  if (!res.ok || json.ok === false) {
    const payload = json.error as UploadErrorPayload | undefined
    throw new Error(payload?.message ?? 'Upload failed')
  }

  const r = json.result
  return {
    batchId: r.batchId ?? r.batch_id ?? '',
    fileName: r.fileName ?? r.file_name ?? file.name,
    stagedRowCount: r.stagedRowCount ?? r.staged_row_count ?? 0,
    preWriteRejectedRowCount: r.preWriteRejectedRowCount ?? r.pre_write_rejected_row_count ?? 0,
    winnerRowCount: r.winnerRowCount ?? r.winner_row_count ?? 0,
    missingKeyRowCount: r.missingKeyRowCount ?? r.missing_key_row_count ?? 0,
    invalidValueRowCount: r.invalidValueRowCount ?? r.invalid_value_row_count ?? 0,
    duplicateNonWinnerRowCount: r.duplicateNonWinnerRowCount ?? r.duplicate_non_winner_row_count ?? 0,
  }
}

function fileKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const newItems: QueueItem[] = []
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.xlsx')) continue
      const id = fileKey(f)
      newItems.push({ id, file: f, status: 'queued', previewSummary: null, result: null, errorMessage: null })
    }
    setQueue((prev) => {
      const existingIds = new Set(prev.map((i) => i.id))
      return [...prev, ...newItems.filter((i) => !existingIds.has(i.id))]
    })
  }

  function removeFile(id: string) {
    setQueue((prev) => prev.filter((i) => i.id !== id))
  }

  function resetQueue() {
    setQueue([])
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  async function runPreview() {
    setRunning(true)
    for (const item of queue) {
      if (item.status !== 'queued') continue

      setQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'previewing' } : i))
      )

      try {
        const previewSummary = await previewFile(item.file)
        setQueue((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'previewed', previewSummary } : i))
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setQueue((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error', errorMessage } : i))
        )
      }
    }
    setRunning(false)
  }

  async function runImport() {
    setRunning(true)
    for (const item of queue) {
      if (item.status !== 'previewed') continue

      setQueue((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'importing' } : i))
      )

      try {
        const result = await uploadFile(item.file)
        setQueue((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'done', result } : i))
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setQueue((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error', errorMessage } : i))
        )
      }
    }
    setRunning(false)
  }

  const queuedCount = queue.filter((i) => i.status === 'queued').length
  const previewedCount = queue.filter((i) => i.status === 'previewed').length
  const doneCount = queue.filter((i) => i.status === 'done').length
  const errorCount = queue.filter((i) => i.status === 'error').length
  const allFinished = queue.length > 0 && queuedCount === 0 && previewedCount === 0 && !running && (doneCount + errorCount === queue.length)

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/data-health">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Data Health
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Upload TikTok Affiliate Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import one or more TikTok affiliate order exports (.xlsx). Files are previewed first, then staged and normalized into downstream facts.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Re-upload is not fully idempotent at the raw batch level: duplicate files can still create duplicate staging batches even though downstream normalization dedupes winner facts.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="space-y-2">
          <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">
            Drop .xlsx files here or click to browse
          </p>
          <p className="text-xs text-muted-foreground">Multiple files supported · TikTok Affiliate Orders export only</p>
        </div>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div className="space-y-2">
          {queue.map((item) => (
            <div key={item.id} className="rounded-lg border bg-card">
              {/* File row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <FileSpreadsheet className={cn(
                  'h-5 w-5 shrink-0',
                  item.status === 'done' ? 'text-emerald-600' :
                  item.status === 'error' ? 'text-destructive' :
                  item.status === 'importing' || item.status === 'previewing' ? 'text-blue-500' :
                  item.status === 'previewed' ? 'text-sky-600' :
                  'text-muted-foreground'
                )} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">{(item.file.size / 1024).toFixed(0)} KB</p>
                </div>

                {/* Status indicators */}
                {item.status === 'previewing' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Previewing…
                  </div>
                )}
                {item.status === 'previewed' && item.previewSummary?.isDuplicateFile && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 shrink-0">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Duplicate
                  </Badge>
                )}
                {item.status === 'previewed' && !item.previewSummary?.isDuplicateFile && (
                  <Badge variant="outline" className="text-xs text-sky-600 border-sky-300 shrink-0">
                    <Eye className="h-3 w-3 mr-1" />
                    Ready
                  </Badge>
                )}
                {item.status === 'importing' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Importing…
                  </div>
                )}
                {item.status === 'done' && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                )}
                {item.status === 'error' && (
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                {item.status === 'queued' && (
                  <Badge variant="outline" className="text-xs shrink-0">Queued</Badge>
                )}

                {/* Remove button (only when not running and not yet importing/done) */}
                {(item.status === 'queued' || item.status === 'previewed') && !running && (
                  <button
                    type="button"
                    onClick={() => removeFile(item.id)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Preview summary */}
              {item.previewSummary && item.status === 'previewed' && (
                <div className="border-t px-4 py-2 space-y-1.5 bg-muted/20">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Rows in file</p>
                      <p className="font-semibold tabular-nums">{item.previewSummary.rowCount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Valid rows</p>
                      <p className="font-semibold tabular-nums text-emerald-600">{item.previewSummary.validRowCount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Pre-write rejected</p>
                      <p className={cn('font-semibold tabular-nums', item.previewSummary.preWriteRejectedRowCount > 0 ? 'text-amber-600' : '')}>
                        {item.previewSummary.preWriteRejectedRowCount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {item.previewSummary.isDuplicateFile && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      This file was already imported (batch {item.previewSummary.existingBatchId?.slice(0, 8)}…). Proceeding will create a duplicate staging batch; normalization will still dedupe winner facts.
                    </p>
                  )}
                  {item.previewSummary.preWriteRejectedRowCount > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      {item.previewSummary.preWriteRejectedRowCount} row{item.previewSummary.preWriteRejectedRowCount !== 1 ? 's' : ''} missing order_id / content_id / product_id will be dropped before staging.
                    </p>
                  )}
                </div>
              )}

              {/* Import result summary */}
              {item.result && (
                <div className="border-t px-4 py-2 bg-muted/20">
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Staged</p>
                      <p className="font-semibold tabular-nums">{item.result.stagedRowCount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Winners</p>
                      <p className="font-semibold tabular-nums text-emerald-600">{item.result.winnerRowCount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Duplicates</p>
                      <p className="font-semibold tabular-nums">{item.result.duplicateNonWinnerRowCount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Errors</p>
                      <p className={cn('font-semibold tabular-nums', (item.result.missingKeyRowCount + item.result.invalidValueRowCount) > 0 ? 'text-destructive' : '')}>
                        {(item.result.missingKeyRowCount + item.result.invalidValueRowCount).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {item.result.preWriteRejectedRowCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {item.result.preWriteRejectedRowCount} row{item.result.preWriteRejectedRowCount !== 1 ? 's' : ''} dropped before staging (missing critical keys).
                    </p>
                  )}
                </div>
              )}

              {/* Error message */}
              {item.errorMessage && (
                <div className="border-t px-4 py-2 text-xs text-destructive bg-destructive/5">
                  {item.errorMessage}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {/* Step 1: Preview queued files */}
        {queuedCount > 0 && !running && (
          <Button onClick={runPreview} className="flex-1 sm:flex-none">
            <Eye className="h-4 w-4 mr-2" />
            Preview {queuedCount} file{queuedCount !== 1 ? 's' : ''}
          </Button>
        )}

        {/* Step 2: Confirm import of previewed files */}
        {previewedCount > 0 && !running && (
          <Button onClick={runImport} className="flex-1 sm:flex-none">
            Import {previewedCount} file{previewedCount !== 1 ? 's' : ''}
          </Button>
        )}

        {running && (
          <Button disabled className="flex-1 sm:flex-none">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Processing…
          </Button>
        )}

        {allFinished && (
          <>
            {doneCount > 0 && (
              <Button asChild size="sm" variant="outline">
                <Link href="/content-ops/analysis/orders">View orders</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={resetQueue}>
              Upload more
            </Button>
          </>
        )}
      </div>

      {/* Status summary when finished */}
      {allFinished && (
        <div className={cn(
          'flex items-center gap-2 text-sm rounded-md px-3 py-2 border',
          errorCount === 0
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        )}>
          {errorCount === 0 ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {doneCount > 0 && `${doneCount} file${doneCount !== 1 ? 's' : ''} imported successfully`}
          {doneCount > 0 && errorCount > 0 && ' · '}
          {errorCount > 0 && `${errorCount} file${errorCount !== 1 ? 's' : ''} failed`}
        </div>
      )}

      {queue.length === 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Files are previewed before import. Rows missing order_id, content_id, or product_id are dropped before staging.
        </p>
      )}
    </div>
  )
}
