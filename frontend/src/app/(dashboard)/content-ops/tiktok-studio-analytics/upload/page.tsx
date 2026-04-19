'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, FileJson, CheckCircle2, AlertCircle, ArrowLeft, X, Loader2, Eye, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PreviewSummary {
  rowCount: number
  invalidRowCount: number
  isDuplicateFile: boolean
  existingBatchId: string | null
  snapshotId: string | null
  scrapedAt: string | null
  parseErrors: string[]
}

interface ImportResult {
  batchId: string
  fileName: string
  rowCount: number
  insertedCount: number
}

interface QueueItem {
  id: string
  file: File
  status: 'queued' | 'previewing' | 'previewed' | 'importing' | 'done' | 'error'
  previewSummary: PreviewSummary | null
  result: ImportResult | null
  errorMessage: string | null
}

async function previewFile(file: File): Promise<PreviewSummary> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/content-ops/tiktok-studio-analytics/preview', { method: 'POST', body: formData })
  const json = await res.json()
  if (!res.ok || json.ok === false) throw new Error(json.error?.message ?? 'Preview failed')
  const p = json.preview
  return {
    rowCount: p.rowCount ?? 0,
    invalidRowCount: p.invalidRowCount ?? 0,
    isDuplicateFile: p.isDuplicateFile ?? false,
    existingBatchId: p.existingBatchId ?? null,
    snapshotId: p.snapshotId ?? null,
    scrapedAt: p.scrapedAt ?? null,
    parseErrors: p.parseErrors ?? [],
  }
}

async function importFile(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/content-ops/tiktok-studio-analytics/import', { method: 'POST', body: formData })
  const json = await res.json()
  if (!res.ok || json.ok === false) throw new Error(json.error?.message ?? 'Import failed')
  const r = json.result
  return {
    batchId: r.batchId ?? '',
    fileName: r.fileName ?? file.name,
    rowCount: r.rowCount ?? 0,
    insertedCount: r.insertedCount ?? 0,
  }
}

export default function StudioAnalyticsUploadPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const newItems: QueueItem[] = []
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.json')) continue
      const id = `${f.name}|${f.size}|${f.lastModified}`
      newItems.push({ id, file: f, status: 'queued', previewSummary: null, result: null, errorMessage: null })
    }
    setQueue(prev => {
      const existing = new Set(prev.map(i => i.id))
      return [...prev, ...newItems.filter(i => !existing.has(i.id))]
    })
  }

  async function runPreview() {
    setRunning(true)
    for (const item of queue) {
      if (item.status !== 'queued') continue
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'previewing' } : i))
      try {
        const previewSummary = await previewFile(item.file)
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'previewed', previewSummary } : i))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', errorMessage } : i))
      }
    }
    setRunning(false)
  }

  async function runImport() {
    setRunning(true)
    for (const item of queue) {
      if (item.status !== 'previewed') continue
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'importing' } : i))
      try {
        const result = await importFile(item.file)
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done', result } : i))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', errorMessage } : i))
      }
    }
    setRunning(false)
  }

  const queuedCount = queue.filter(i => i.status === 'queued').length
  const previewedCount = queue.filter(i => i.status === 'previewed').length
  const doneCount = queue.filter(i => i.status === 'done').length
  const errorCount = queue.filter(i => i.status === 'error').length
  const allFinished = queue.length > 0 && queuedCount === 0 && previewedCount === 0 && !running

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/tiktok-studio-analytics">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Studio Analytics
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Import Studio Analytics Snapshot</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload ไฟล์ JSON snapshot จาก TikTok Studio analytics scraper
          (ไฟล์ <code className="text-xs bg-muted px-1 rounded">analytics-rows.json</code>)
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <input ref={inputRef} type="file" accept=".json" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        <div className="space-y-2">
          <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Drop .json ที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
          <p className="text-xs text-muted-foreground">
            ไฟล์อยู่ที่: <code className="bg-muted px-1 rounded">data\studio-analytics\normalized\snapshots\</code>
          </p>
        </div>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div className="space-y-2">
          {queue.map(item => (
            <div key={item.id} className="rounded-lg border bg-card">
              <div className="flex items-center gap-3 px-4 py-3">
                <FileJson className={cn('h-5 w-5 shrink-0',
                  item.status === 'done' ? 'text-emerald-600' :
                  item.status === 'error' ? 'text-destructive' :
                  item.status === 'importing' || item.status === 'previewing' ? 'text-blue-500' :
                  item.status === 'previewed' ? 'text-sky-600' : 'text-muted-foreground'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">{(item.file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>

                {item.status === 'previewing' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Previewing…
                  </div>
                )}
                {item.status === 'previewed' && item.previewSummary?.isDuplicateFile && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 shrink-0">
                    <AlertTriangle className="h-3 w-3 mr-1" />Duplicate
                  </Badge>
                )}
                {item.status === 'previewed' && !item.previewSummary?.isDuplicateFile && (
                  <Badge variant="outline" className="text-xs text-sky-600 border-sky-300 shrink-0">
                    <Eye className="h-3 w-3 mr-1" />Ready
                  </Badge>
                )}
                {item.status === 'importing' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Importing…
                  </div>
                )}
                {item.status === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                {item.status === 'error' && <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                {item.status === 'queued' && <Badge variant="outline" className="text-xs shrink-0">Queued</Badge>}

                {(item.status === 'queued' || item.status === 'previewed') && !running && (
                  <button type="button" onClick={() => setQueue(prev => prev.filter(i => i.id !== item.id))} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {item.previewSummary && item.status === 'previewed' && (
                <div className="border-t px-4 py-2 space-y-1.5 bg-muted/20">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">VDO ในไฟล์</p>
                      <p className="font-semibold tabular-nums">{item.previewSummary.rowCount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Invalid rows</p>
                      <p className={cn('font-semibold tabular-nums', item.previewSummary.invalidRowCount > 0 ? 'text-amber-600' : '')}>
                        {item.previewSummary.invalidRowCount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Scraped at</p>
                      <p className="font-semibold text-xs truncate">
                        {item.previewSummary.scrapedAt
                          ? new Date(item.previewSummary.scrapedAt).toLocaleDateString('th-TH')
                          : '—'}
                      </p>
                    </div>
                  </div>
                  {item.previewSummary.isDuplicateFile && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      Snapshot นี้ถูก import แล้ว (batch {item.previewSummary.existingBatchId?.slice(0, 8)}…)
                    </p>
                  )}
                </div>
              )}

              {item.result && (
                <div className="border-t px-4 py-2 bg-muted/20">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Imported</p>
                      <p className="font-semibold tabular-nums text-emerald-600">{item.result.insertedCount.toLocaleString()} VDO</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total in file</p>
                      <p className="font-semibold tabular-nums">{item.result.rowCount.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              )}

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
          <Button onClick={runPreview} className="flex-1 sm:flex-none">
            <Eye className="h-4 w-4 mr-2" />
            Preview {queuedCount} ไฟล์
          </Button>
        )}
        {previewedCount > 0 && !running && (
          <Button onClick={runImport} className="flex-1 sm:flex-none">
            Import {previewedCount} ไฟล์
          </Button>
        )}
        {running && (
          <Button disabled className="flex-1 sm:flex-none">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…
          </Button>
        )}
        {allFinished && (
          <>
            {doneCount > 0 && (
              <Button asChild size="sm" variant="outline">
                <Link href="/content-ops/tiktok-studio-analytics">ดูข้อมูล</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setQueue([])}>Upload เพิ่ม</Button>
          </>
        )}
      </div>

      {allFinished && (
        <div className={cn(
          'flex items-center gap-2 text-sm rounded-md px-3 py-2 border',
          errorCount === 0
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        )}>
          {errorCount === 0
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />}
          {doneCount > 0 && `${doneCount} ไฟล์ import สำเร็จ`}
          {doneCount > 0 && errorCount > 0 && ' · '}
          {errorCount > 0 && `${errorCount} ไฟล์ failed`}
        </div>
      )}
    </div>
  )
}
