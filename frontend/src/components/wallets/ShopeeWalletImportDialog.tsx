'use client'

/**
 * ShopeeWalletImportDialog
 * Import Shopee Transaction Report CSV into marketplace_wallet_transactions
 *
 * Features:
 * - Dynamic header row detection (preamble support)
 * - Preview with credit/debit summary
 * - Dedup: skip duplicate txn_hash
 * - Download skipped rows as CSV
 */

import { useState, useEffect, useRef } from 'react'
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
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  createShopeeWalletBatch,
  importShopeeWalletChunk,
  finalizeShopeeWalletBatch,
  replaceShopeeWalletBatch,
  ShopeeWalletImportResult,
} from '@/app/(dashboard)/wallets/shopee-wallet-import-actions'
import { parseShopeeWalletCSV, ShopeeWalletTransaction } from '@/lib/importers/shopee-wallet-parser'

// ============================================================
// Types
// ============================================================

type Step = 'upload' | 'preview' | 'duplicate' | 'importing' | 'result'

interface ShopeeWalletImportDialogProps {
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

function formatTHB(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function downloadSkippedCSV(rows: ShopeeWalletTransaction[], filename: string) {
  const headers = ['occurred_at', 'transaction_type', 'direction', 'amount', 'ref_id', 'description', 'status', 'balance_after', 'txn_hash']
  const lines = [
    headers.join(','),
    ...rows.map((r) => {
      const rec = r as unknown as Record<string, unknown>
      return headers.map((h) => {
        const val = String(rec[h] ?? '')
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val
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

async function computeFileHash(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ============================================================
// Component
// ============================================================

export function ShopeeWalletImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: ShopeeWalletImportDialogProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileText, setFileText] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [result, setResult] = useState<ShopeeWalletImportResult | null>(null)
  const [parsedRows, setParsedRows] = useState<ShopeeWalletTransaction[]>([])
  const [parseResult, setParseResult] = useState<ReturnType<typeof parseShopeeWalletCSV> | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{
    fileName: string
    importedAt: string
    existingBatchId?: string
    existingRowCount?: number
    fileHash?: string
  } | null>(null)

  useEffect(() => {
    if (open) {
      setStep('upload')
      setFile(null)
      setFileText('')
      setIsProcessing(false)
      setImportProgress(null)
      setResult(null)
      setParsedRows([])
      setParseResult(null)
      setDuplicateInfo(null)
    }
  }, [open])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (!selected.name.endsWith('.csv')) {
      toast({ variant: 'destructive', title: 'ประเภทไฟล์ไม่ถูกต้อง', description: 'รองรับเฉพาะไฟล์ .csv เท่านั้น' })
      return
    }

    setFile(selected)
    setIsProcessing(true)

    try {
      const text = await selected.text()
      setFileText(text)

      const pr = parseShopeeWalletCSV(text)
      setParseResult(pr)
      setParsedRows(pr.rows)
      setStep('preview')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast({ variant: 'destructive', title: 'Parse Error', description: msg })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleConfirmImport = async (allowReimport = false) => {
    if (!file || !fileText || parsedRows.length === 0) return

    setStep('importing')
    setIsProcessing(true)
    setImportProgress(null)

    try {
      const fileHash = await computeFileHash(fileText)

      // STEP 1: Create batch
      const batchFd = new FormData()
      batchFd.append('fileHash', fileHash)
      batchFd.append('fileName', file.name)
      batchFd.append('totalRows', String(parsedRows.length))
      batchFd.append('dateRange', 'N/A')
      batchFd.append('allowReimport', String(allowReimport))

      const batchResult = await createShopeeWalletBatch(batchFd)

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
      const chunks: ShopeeWalletTransaction[][] = []
      for (let i = 0; i < parsedRows.length; i += CHUNK_SIZE) {
        chunks.push(parsedRows.slice(i, i + CHUNK_SIZE))
      }

      let totalInserted = 0
      let totalSkipped = 0

      for (let i = 0; i < chunks.length; i++) {
        setImportProgress({ current: i + 1, total: chunks.length })

        const chunkFd = new FormData()
        chunkFd.append('batchId', batchId)
        chunkFd.append('chunkDataJson', JSON.stringify(chunks[i]))
        chunkFd.append('chunkIndex', String(i))
        chunkFd.append('totalChunks', String(chunks.length))
        chunkFd.append('sourceFileName', file.name)

        const chunkResult = await importShopeeWalletChunk(chunkFd)
        if (!chunkResult.success) {
          throw new Error(`CHUNK_FAILED: ${chunkResult.error}`)
        }
        totalInserted += chunkResult.inserted
        totalSkipped += chunkResult.skipped
      }

      // STEP 3: Finalize
      const finalizeFd = new FormData()
      finalizeFd.append('batchId', batchId)
      finalizeFd.append('totalInserted', String(totalInserted))
      finalizeFd.append('totalSkipped', String(totalSkipped))
      finalizeFd.append('summaryJson', JSON.stringify(parseResult?.summary))

      const finalResult = await finalizeShopeeWalletBatch(finalizeFd)
      if (!finalResult.success) {
        throw new Error(`FINALIZE_FAILED: ${finalResult.error}`)
      }

      setResult(finalResult)
      toast({
        title: 'Import สำเร็จ',
        description: `นำเข้า ${finalResult.inserted} รายการ${finalResult.skipped > 0 ? ` (ข้าม ${finalResult.skipped} duplicates)` : ''}`,
      })
      onSuccess()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      if (msg.startsWith('DUPLICATE_FILE')) return

      const userMsg = msg.replace(/^(BATCH_FAILED|CHUNK_FAILED|FINALIZE_FAILED): /, '')
      setResult({ success: false, error: userMsg, inserted: 0, skipped: 0, errors: 0 })
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

      const replaceResult = await replaceShopeeWalletBatch(replaceFd)
      if (!replaceResult.success) throw new Error(`Replace failed: ${replaceResult.error}`)

      toast({ title: 'ลบข้อมูลเดิมแล้ว', description: `ลบ ${replaceResult.deletedCount} รายการ กำลังนำเข้าใหม่...` })
      await handleConfirmImport(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setResult({ success: false, error: msg, inserted: 0, skipped: 0, errors: 0 })
      setStep('result')
      toast({ variant: 'destructive', title: 'Replace ล้มเหลว', description: msg })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    setStep('upload')
    setFile(null)
    setFileText('')
    setParsedRows([])
    setParseResult(null)
    setResult(null)
    setDuplicateInfo(null)
    onOpenChange(false)
  }

  const hasErrors = (parseResult?.errors.filter((e) => e.severity === 'error').length ?? 0) > 0
  const canImport = parsedRows.length > 0 && !hasErrors

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Shopee Wallet Transactions</DialogTitle>
          <DialogDescription>
            อัปโหลดไฟล์ Transaction Report.csv จาก Shopee Seller Center (My Balance)
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
              <p className="text-sm font-medium">คลิกเพื่อเลือกไฟล์ Transaction Report.csv</p>
              <p className="text-xs text-muted-foreground mt-1">รองรับ .csv เท่านั้น (รองรับ preamble หลายบรรทัด)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                กำลังอ่านไฟล์...
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">คอลัมน์ที่ต้องการ (จะ scan หาโดยอัตโนมัติ):</p>
              <p>วันที่, ประเภทการทำธุรกรรม, จำนวนเงิน</p>
              <p className="mt-1">ไฟล์ที่รองรับ: my_balance_transaction_report...csv</p>
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {step === 'preview' && parseResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {canImport ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500" />
              )}
              <span className="font-medium text-sm">{file?.name}</span>
            </div>

            {/* Summary cards */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded bg-green-50 border border-green-200 p-2">
                  <div className="flex items-center gap-1 text-xs text-green-600 mb-1">
                    <TrendingUp className="h-3 w-3" /> เงินเข้า (credit)
                  </div>
                  <p className="font-semibold text-green-700">฿{formatTHB(parseResult.summary.totalCredit)}</p>
                </div>
                <div className="rounded bg-red-50 border border-red-200 p-2">
                  <div className="flex items-center gap-1 text-xs text-red-600 mb-1">
                    <TrendingDown className="h-3 w-3" /> เงินออก (debit)
                  </div>
                  <p className="font-semibold text-red-700">฿{formatTHB(parseResult.summary.totalDebit)}</p>
                </div>
              </div>

              <div className="text-sm space-y-1 pt-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Header row detected</span>
                  <span className="font-mono font-medium">
                    {parseResult.detectedHeaderRow >= 0 ? `บรรทัดที่ ${parseResult.detectedHeaderRow + 1}` : 'ไม่พบ'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total transactions</span>
                  <span className="font-medium">{parseResult.totalRows.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order transactions</span>
                  <span className="font-medium">{parseResult.summary.orderCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Withdrawals</span>
                  <span className="font-medium">{parseResult.summary.withdrawalCount}</span>
                </div>
                <div className="flex justify-between font-medium border-t pt-1">
                  <span>Net amount</span>
                  <span className={parseResult.summary.netAmount >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ฿{formatTHB(parseResult.summary.netAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Parse errors */}
            {hasErrors && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {parseResult.errors.filter((e) => e.severity === 'error').slice(0, 5).map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Warnings count */}
            {parseResult.errors.filter((e) => e.severity === 'warning').length > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {parseResult.errors.filter((e) => e.severity === 'warning').length} แถวมี warning (จะข้ามแถวเหล่านั้น)
                </AlertDescription>
              </Alert>
            )}

            {/* Sample rows */}
            {parseResult.sampleRows.length > 0 && (
              <div className="rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left font-medium">วันที่</th>
                      <th className="p-2 text-left font-medium">ประเภท</th>
                      <th className="p-2 text-right font-medium">จำนวนเงิน</th>
                      <th className="p-2 text-center font-medium">Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.sampleRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono">{row.occurred_at.substring(0, 10)}</td>
                        <td className="p-2 max-w-[140px] truncate">{row.transaction_type}</td>
                        <td className="p-2 text-right font-mono">฿{formatTHB(row.amount)}</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            row.direction === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {row.direction}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parseResult.totalRows > 5 && (
                  <p className="text-xs text-muted-foreground text-center p-2 border-t">
                    แสดง 5 จาก {parseResult.totalRows} รายการ
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setStep('upload'); setFile(null) }}>
                เลือกไฟล์ใหม่
              </Button>
              <Button
                onClick={() => handleConfirmImport(false)}
                disabled={!canImport || isProcessing}
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Import {parsedRows.length.toLocaleString()} รายการ
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
                {duplicateInfo.existingRowCount ? ` (${duplicateInfo.existingRowCount} รายการ)` : ''}
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => handleConfirmImport(true)}
                disabled={isProcessing}
              >
                Import ซ้ำ (ข้าม duplicates อัตโนมัติ)
              </Button>
              {duplicateInfo.existingBatchId && (
                <Button
                  variant="destructive"
                  onClick={handleReplaceAndReimport}
                  disabled={isProcessing}
                >
                  ลบข้อมูลเดิมแล้ว import ใหม่
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => { setStep('upload'); setFile(null); setDuplicateInfo(null) }}
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
                    นำเข้า <strong>{result.inserted}</strong> รายการ
                    {result.skipped > 0 && <span> (ข้าม {result.skipped} duplicates)</span>}
                  </p>
                  {result.summary && (
                    <div className="text-sm mt-1 space-y-0.5">
                      <p>เงินเข้า: ฿{formatTHB(result.summary.totalCredit)}</p>
                      <p>เงินออก: ฿{formatTHB(result.summary.totalDebit)}</p>
                    </div>
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

            {/* Download skipped */}
            {result.success && result.skipped > 0 && parsedRows.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => downloadSkippedCSV(parsedRows, `shopee-wallet-skipped-${Date.now()}.csv`)}
              >
                <Download className="h-4 w-4 mr-2" />
                ดาวน์โหลด skipped rows ({result.skipped} รายการ)
              </Button>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setStep('upload'); setFile(null); setResult(null) }}>
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
