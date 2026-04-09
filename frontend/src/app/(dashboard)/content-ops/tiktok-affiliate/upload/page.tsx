'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ArrowLeft, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ImportResult {
  batchId: string
  fileName: string
  stagedRowCount: number
  winnerRowCount: number
  missingKeyRowCount: number
  invalidValueRowCount: number
  duplicateNonWinnerRowCount: number
}

interface QueueItem {
  id: string
  file: File
  status: 'queued' | 'importing' | 'done' | 'error'
  result: ImportResult | null
  errorMessage: string | null
}

async function uploadFile(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/content-ops/tiktok-affiliate/upload', {
    method: 'POST',
    body: formData,
  })
  const json = await res.json()

  if (!res.ok || json.error) {
    throw new Error(json.error ?? 'Upload failed')
  }

  const r = json.result
  return {
    batchId: r.batchId ?? r.batch_id ?? '',
    fileName: r.fileName ?? r.file_name ?? file.name,
    stagedRowCount: r.stagedRowCount ?? r.staged_row_count ?? 0,
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
      newItems.push({ id, file: f, status: 'queued', result: null, errorMessage: null })
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

  async function runImport() {
    setRunning(true)
    for (const item of queue) {
      if (item.status !== 'queued') continue

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
  const doneCount = queue.filter((i) => i.status === 'done').length
  const errorCount = queue.filter((i) => i.status === 'error').length
  const allFinished = queue.length > 0 && queuedCount === 0 && !running

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
          Import one or more TikTok affiliate order exports (.xlsx). Files are processed sequentially and are idempotent — uploading the same file twice is safe.
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
                  item.status === 'importing' ? 'text-blue-500' :
                  'text-muted-foreground'
                )} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">{(item.file.size / 1024).toFixed(0)} KB</p>
                </div>

                {/* Status badge */}
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

                {/* Remove button (only when not running) */}
                {item.status === 'queued' && !running && (
                  <button
                    type="button"
                    onClick={() => removeFile(item.id)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Result summary */}
              {item.result && (
                <div className="border-t px-4 py-2 grid grid-cols-4 gap-2 bg-muted/20 text-xs">
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
        {queuedCount > 0 && !running && (
          <Button onClick={runImport} className="flex-1 sm:flex-none">
            Import {queuedCount} file{queuedCount !== 1 ? 's' : ''}
          </Button>
        )}
        {running && (
          <Button disabled className="flex-1 sm:flex-none">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Importing…
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
          Import is idempotent — re-uploading the same file is safe and will be detected by file hash.
        </p>
      )}
    </div>
  )
}
