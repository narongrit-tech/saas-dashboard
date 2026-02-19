'use client'

/**
 * ShopeeOrdersImportDialog
 * Import Shopee orders (.csv หรือ .xlsx) เข้า sales_orders
 *
 * รองรับ:
 * - .csv  (UTF-8 / UTF-8 BOM, Thai headers)
 * - .xlsx (Excel export จาก Shopee Seller Center)
 * - Dynamic header row detection (รองรับ preamble หลายบรรทัด)
 * - Dedup: ข้าม duplicate ผ่าน order_line_hash
 * - Download skipped rows เป็น CSV
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Info,
  Download,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  importSalesChunk,
  finalizeImportBatch,
} from '@/app/(dashboard)/sales/sales-import-actions'
import {
  createShopeeOrdersBatch,
  replaceShopeeOrdersBatch,
} from '@/app/(dashboard)/sales/shopee-import-actions'
import { ParsedSalesRow, SalesImportResult } from '@/types/sales-import'
import { calculateFileHash, toPlain } from '@/lib/file-hash'
import { parseShopeeOrdersFile } from '@/lib/importers/shopee-orders-parser'

// ============================================================
// Types
// ============================================================

type Step = 'upload' | 'preview' | 'duplicate' | 'importing' | 'result'

interface ShopeeOrdersImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

// ============================================================
// Helpers
// ============================================================

function formatThaiDate(isoString?: string): string {
  if (!isoString) return 'Unknown'
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
    return 'Unknown'
  }
}

function downloadCSV(rows: ParsedSalesRow[], filename: string) {
  const headers = ['order_id', 'product_name', 'sku', 'quantity', 'total_amount', 'order_date', 'status']
  const lines = [
    headers.join(','),
    ...rows.map((r) => {
      const rec = r as unknown as Record<string, unknown>
      return headers.map((h) => {
        const val = String(rec[h] ?? '')
        return val.includes(',') ? `"${val}"` : val
      }).join(',')
    }),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ============================================================
// Component
// ============================================================

export function ShopeeOrdersImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: ShopeeOrdersImportDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [result, setResult] = useState<SalesImportResult | null>(null)
  const [parsedData, setParsedData] = useState<ParsedSalesRow[]>([])
  const [detectedHeaderRow, setDetectedHeaderRow] = useState<number>(-1)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [previewSummary, setPreviewSummary] = useState<{
    totalRows: number
    uniqueOrders: number
    totalRevenue: number
    dateRange?: { start: string; end: string }
    errors: Array<{ message: string; severity: 'error' | 'warning' }>
    warnings: string[]
    fileType: 'csv' | 'xlsx'
  } | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{
    fileName: string
    importedAt: string
    existingBatchId?: string
    existingRowCount?: number
    fileHash?: string
  } | null>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep('upload')
      setFile(null)
      setFileBuffer(null)
      setIsProcessing(false)
      setImportProgress(null)
      setResult(null)
      setParsedData([])
      setDetectedHeaderRow(-1)
      setMissingColumns([])
      setPreviewSummary(null)
      setDuplicateInfo(null)
    }
  }, [open])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    const lower = selected.name.toLowerCase()
    const isCSV = lower.endsWith('.csv')
    const isXLSX = lower.endsWith('.xlsx') || lower.endsWith('.xls')

    if (!isCSV && !isXLSX) {
      toast({
        variant: 'destructive',
        title: 'ประเภทไฟล์ไม่ถูกต้อง',
        description: 'รองรับเฉพาะไฟล์ .csv หรือ .xlsx เท่านั้น',
      })
      return
    }

    setFile(selected)
    setIsProcessing(true)

    try {
      const buffer = await selected.arrayBuffer()
      setFileBuffer(buffer)

      // Unified parser: auto-detects CSV vs XLSX by file name
      const parseResult = await parseShopeeOrdersFile(buffer, selected.name)

      setDetectedHeaderRow(parseResult.detectedHeaderRow)
      setMissingColumns(parseResult.missingColumns)
      setPreviewSummary({
        totalRows: parseResult.totalRows,
        uniqueOrders: parseResult.summary.uniqueOrderIds,
        totalRevenue: parseResult.summary.totalRevenue,
        dateRange: parseResult.dateRange,
        errors: parseResult.errors,
        warnings: parseResult.warnings,
        fileType: isXLSX ? 'xlsx' : 'csv',
      })

      if (parseResult.success && parseResult.allRows && parseResult.allRows.length > 0) {
        setParsedData(parseResult.allRows)
      } else {
        setParsedData([])
      }

      setStep('preview')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast({ variant: 'destructive', title: 'Parse Error', description: msg })
      setStep('preview')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleConfirmImport = async (allowReimport = false) => {
    if (!file || !fileBuffer || parsedData.length === 0) return

    setStep('importing')
    setIsProcessing(true)
    setImportProgress(null)

    try {
      // Hash of the raw file buffer (deterministic dedup key)
      const fileHash = await calculateFileHash(fileBuffer)
      const plainData = toPlain(parsedData)
      const dateRange = previewSummary?.dateRange
        ? `${previewSummary.dateRange.start} to ${previewSummary.dateRange.end}`
        : 'N/A'

      // STEP 1: Create batch
      const batchFormData = new FormData()
      batchFormData.append('fileHash', fileHash)
      batchFormData.append('fileName', file.name)
      batchFormData.append('totalRows', String(plainData.length))
      batchFormData.append('dateRange', dateRange)
      batchFormData.append('allowReimport', String(allowReimport))

      const batchResult = await createShopeeOrdersBatch(batchFormData)

      if (batchResult.status === 'duplicate_file') {
        setDuplicateInfo({
          fileName: batchResult.fileName ?? file.name,
          importedAt: formatThaiDate(batchResult.importedAt),
          existingBatchId: batchResult.existingBatchId,
          existingRowCount: batchResult.existingRowCount,
          fileHash,
        })
        setIsProcessing(false)
        setStep('duplicate')
        throw new Error('DUPLICATE_FILE')
      }

      if (!batchResult.success || !batchResult.batchId) {
        throw new Error(`BATCH_FAILED: ${batchResult.error}`)
      }

      const batchId = batchResult.batchId

      // STEP 2: Chunk import
      const CHUNK_SIZE = 500
      const chunks: ParsedSalesRow[][] = []
      for (let i = 0; i < plainData.length; i += CHUNK_SIZE) {
        chunks.push(plainData.slice(i, i + CHUNK_SIZE))
      }

      let totalInserted = 0
      for (let i = 0; i < chunks.length; i++) {
        setImportProgress({ current: i + 1, total: chunks.length })

        const chunkFd = new FormData()
        chunkFd.append('batchId', batchId)
        chunkFd.append('chunkDataJson', JSON.stringify(chunks[i]))
        chunkFd.append('chunkIndex', String(i))
        chunkFd.append('totalChunks', String(chunks.length))

        const chunkResult = await importSalesChunk(chunkFd)
        if (!chunkResult.success) {
          throw new Error(`CHUNK_FAILED: ${chunkResult.error}`)
        }
        totalInserted += chunkResult.inserted
      }

      // STEP 3: Finalize
      const finalizeFd = new FormData()
      finalizeFd.append('batchId', batchId)
      finalizeFd.append('totalInserted', String(totalInserted))
      finalizeFd.append('parsedDataJson', JSON.stringify(plainData))

      const finalResult = await finalizeImportBatch(finalizeFd)
      if (!finalResult.success) {
        throw new Error(`FINALIZE_FAILED: ${finalResult.error}`)
      }

      setResult(finalResult)
      toast({
        title: 'Import สำเร็จ',
        description: `นำเข้า ${finalResult.inserted} รายการ${finalResult.skipped > 0 ? ` (ข้าม ${finalResult.skipped} duplicates)` : ''}`,
      })
      onSuccess()
      router.refresh()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      if (msg.startsWith('DUPLICATE_FILE')) return

      const userMsg = msg.replace(/^(BATCH_FAILED|CHUNK_FAILED|FINALIZE_FAILED): /, '')
      setResult({ success: false, error: userMsg, inserted: 0, updated: 0, skipped: 0, errors: 0 })
      toast({ variant: 'destructive', title: 'Import ล้มเหลว', description: userMsg.split('\n')[0] })
    } finally {
      setIsProcessing(false)
      setImportProgress(null)
      setStep('result')
    }
  }

  const handleReplaceAndReimport = async () => {
    if (!duplicateInfo?.existingBatchId || !duplicateInfo?.fileHash) return

    setIsProcessing(true)
    setStep('importing')

    try {
      const replaceFd = new FormData()
      replaceFd.append('existingBatchId', duplicateInfo.existingBatchId)
      replaceFd.append('fileHash', duplicateInfo.fileHash)

      const replaceResult = await replaceShopeeOrdersBatch(replaceFd)
      if (!replaceResult.success) throw new Error(`Replace failed: ${replaceResult.error}`)

      toast({
        title: 'ลบข้อมูลเดิมแล้ว',
        description: `ลบ ${replaceResult.deletedCount} รายการ กำลังนำเข้าใหม่...`,
      })
      await handleConfirmImport(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setResult({ success: false, error: msg, inserted: 0, updated: 0, skipped: 0, errors: 0 })
      setStep('result')
      toast({ variant: 'destructive', title: 'Replace ล้มเหลว', description: msg })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setParsedData([])
    setResult(null)
    setDuplicateInfo(null)
    onOpenChange(false)
  }

  const previewErrors = previewSummary?.errors.filter((e) => e.severity === 'error') ?? []
  const previewWarnings = previewSummary?.errors.filter((e) => e.severity === 'warning') ?? []
  const canImport = parsedData.length > 0 && previewErrors.length === 0

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Shopee Orders</DialogTitle>
          <DialogDescription>
            อัปโหลดไฟล์ orders.csv หรือ orders.xlsx จาก Shopee Seller Center
          </DialogDescription>
        </DialogHeader>

        {/* ── UPLOAD ── */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">คลิกเพื่อเลือกไฟล์ orders.csv หรือ orders.xlsx</p>
              <p className="text-xs text-muted-foreground mt-1">
                รองรับ <strong>.csv</strong> (UTF-8) และ <strong>.xlsx</strong> (Excel)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                กำลังอ่านและ parse ไฟล์...
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">คอลัมน์ที่ต้องการ:</p>
              <p>หมายเลขคำสั่งซื้อ, สถานะการสั่งซื้อ, จำนวน, ราคาขายสุทธิ</p>
              <p>วันที่ทำการสั่งซื้อ, *หมายเลขติดตามพัสดุ, เลขอ้างอิง SKU</p>
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {step === 'preview' && previewSummary && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {canImport ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500" />
              )}
              <span className="font-medium text-sm">{file?.name}</span>
              <span className="text-xs text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-muted">
                {previewSummary.fileType}
              </span>
            </div>

            {/* Header & Stats */}
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Header row detected</span>
                <span className="font-mono font-medium">
                  {detectedHeaderRow >= 0 ? `บรรทัดที่ ${detectedHeaderRow + 1}` : 'ไม่พบ'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total line items</span>
                <span className="font-medium">{previewSummary.totalRows.toLocaleString()} rows</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unique orders</span>
                <span className="font-medium">{previewSummary.uniqueOrders.toLocaleString()} orders</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total revenue (non-cancelled)</span>
                <span className="font-medium">
                  ฿{previewSummary.totalRevenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {previewSummary.dateRange && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date range</span>
                  <span className="font-medium">
                    {previewSummary.dateRange.start} → {previewSummary.dateRange.end}
                  </span>
                </div>
              )}
              {missingColumns.length > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Missing columns</span>
                  <span>{missingColumns.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Parse Errors */}
            {previewErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {previewErrors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                    {previewErrors.length > 5 && (
                      <li>...และอีก {previewErrors.length - 5} errors</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Warnings */}
            {previewWarnings.length > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {previewWarnings.length} แถวมี warning (จะข้ามแถวเหล่านั้นและนำเข้าแถวที่ valid)
                </AlertDescription>
              </Alert>
            )}

            {/* Info notes */}
            {previewSummary.warnings.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {previewSummary.warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('upload')
                  setFile(null)
                  setFileBuffer(null)
                }}
              >
                เลือกไฟล์ใหม่
              </Button>
              <Button
                onClick={() => handleConfirmImport(false)}
                disabled={!canImport || isProcessing}
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Import {parsedData.length.toLocaleString()} รายการ
              </Button>
            </div>
          </div>
        )}

        {/* ── DUPLICATE ── */}
        {step === 'duplicate' && duplicateInfo && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                ไฟล์ <strong>{duplicateInfo.fileName}</strong> ถูก import ไปแล้วเมื่อ{' '}
                <strong>{duplicateInfo.importedAt}</strong>
                {duplicateInfo.existingRowCount
                  ? ` (${duplicateInfo.existingRowCount} รายการ)`
                  : ''}
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => handleConfirmImport(true)}
                disabled={isProcessing}
              >
                Import ซ้ำ (เพิ่มแถวใหม่เท่านั้น — ข้าม duplicates)
              </Button>
              {duplicateInfo.existingBatchId && (
                <Button
                  variant="destructive"
                  onClick={handleReplaceAndReimport}
                  disabled={isProcessing}
                >
                  ลบข้อมูลเดิมทั้งหมดแล้ว import ใหม่
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('upload')
                  setFile(null)
                  setFileBuffer(null)
                  setDuplicateInfo(null)
                }}
              >
                ยกเลิก
              </Button>
            </div>
          </div>
        )}

        {/* ── IMPORTING ── */}
        {step === 'importing' && (
          <div className="space-y-4 py-4 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="font-medium">กำลัง import...</p>
            {importProgress && (
              <p className="text-sm text-muted-foreground">
                Chunk {importProgress.current}/{importProgress.total}
              </p>
            )}
          </div>
        )}

        {/* ── RESULT ── */}
        {step === 'result' && result && (
          <div className="space-y-4">
            {result.success ? (
              <Alert className="border-green-200 bg-green-50 text-green-800">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  <p className="font-medium">Import สำเร็จ!</p>
                  <p className="text-sm mt-1">
                    นำเข้า {result.inserted} รายการ
                    {result.skipped > 0 ? ` (ข้าม ${result.skipped} duplicates)` : ''}
                  </p>
                  {result.dateRange && (
                    <p className="text-sm">{result.dateRange.min} → {result.dateRange.max}</p>
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">Import ล้มเหลว</p>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{result.error}</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Skipped rows export */}
            {result.success && result.skipped > 0 && parsedData.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  downloadCSV(parsedData, `shopee-orders-skipped-${Date.now()}.csv`)
                }
              >
                <Download className="h-4 w-4 mr-2" />
                ดาวน์โหลด skipped rows ({result.skipped} รายการ)
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStep('upload')
                  setFile(null)
                  setFileBuffer(null)
                  setResult(null)
                }}
              >
                Import ไฟล์อื่น
              </Button>
              <Button className="flex-1" onClick={handleClose}>
                ปิด
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
