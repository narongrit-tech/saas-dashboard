'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ArrowLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ImportResult {
  batchId: string
  fileName: string
  stagingRowCount: number
  validCandidateRowCount: number
  winnerRowCount: number
  missingKeyRowCount: number
  invalidValueRowCount: number
  duplicateNonWinnerRowCount: number
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const f = files[0]
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('Only .xlsx files are supported')
      return
    }
    setFile(f)
    setError(null)
    setResult(null)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return

    setUploading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    if (sheetName.trim()) formData.append('sheet_name', sheetName.trim())

    try {
      const res = await fetch('/api/content-ops/tiktok-affiliate/upload', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error ?? 'Upload failed')
        return
      }

      const r = json.result
      setResult({
        batchId: r.batchId ?? r.batch_id ?? '',
        fileName: r.fileName ?? r.file_name ?? file.name,
        stagingRowCount: r.stagingRowCount ?? r.staging_row_count ?? 0,
        validCandidateRowCount: r.validCandidateRowCount ?? r.valid_candidate_row_count ?? 0,
        winnerRowCount: r.winnerRowCount ?? r.winner_row_count ?? 0,
        missingKeyRowCount: r.missingKeyRowCount ?? r.missing_key_row_count ?? 0,
        invalidValueRowCount: r.invalidValueRowCount ?? r.invalid_value_row_count ?? 0,
        duplicateNonWinnerRowCount: r.duplicateNonWinnerRowCount ?? r.duplicate_non_winner_row_count ?? 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/tiktok-affiliate">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Overview
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Upload TikTok Affiliate File</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import a TikTok affiliate orders Excel export (.xlsx). The file will be staged and normalized automatically.
        </p>
      </div>

      {!result && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Drop zone */}
          <div
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30',
              file && 'border-foreground/30 bg-muted/20'
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
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600 shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null) }}
                  className="ml-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm font-medium">Drop .xlsx file here or click to browse</p>
                <p className="text-xs text-muted-foreground">TikTok Affiliate Orders export only</p>
              </div>
            )}
          </div>

          {/* Sheet name override */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Sheet name (optional)</label>
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="Defaults to first sheet"
              className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" disabled={!file || uploading} className="w-full">
            {uploading ? 'Importing…' : 'Import file'}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Import is idempotent — re-uploading the same file is safe and will be detected by file hash.
          </p>
        </form>
      )}

      {/* Result */}
      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">Import complete</CardTitle>
            </div>
            <CardDescription className="text-xs">{result.fileName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Staged rows', value: result.stagingRowCount, variant: 'default' as const },
                { label: 'Fact winners', value: result.winnerRowCount, variant: 'default' as const },
                { label: 'Missing keys', value: result.missingKeyRowCount, variant: result.missingKeyRowCount > 0 ? 'destructive' as const : 'outline' as const },
                { label: 'Invalid values', value: result.invalidValueRowCount, variant: result.invalidValueRowCount > 0 ? 'destructive' as const : 'outline' as const },
                { label: 'Duplicate non-winners', value: result.duplicateNonWinnerRowCount, variant: 'outline' as const },
                { label: 'Valid candidates', value: result.validCandidateRowCount, variant: 'outline' as const },
              ].map(({ label, value, variant }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/30">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Badge variant={variant} className="tabular-nums">{value.toLocaleString()}</Badge>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href="/content-ops/tiktok-affiliate/batches">View batches</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href="/content-ops/tiktok-affiliate/facts">View facts</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => { setResult(null); setFile(null) }}
              >
                Upload another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
