'use client'

/**
 * ShopeeSettlementImportDialog
 * Import "Income / โอนเงินสำเร็จ" CSV into shopee_order_settlements
 */

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react'
import { parseShopeeSettlementCSV } from '@/lib/importers/shopee-settlement-parser'
import {
  createShopeeSettlementBatch,
  importShopeeSettlementChunk,
  finalizeShopeeSettlementBatch,
} from '@/app/(dashboard)/finance/shopee/shopee-finance-actions'

const CHUNK_SIZE = 500

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type Step = 'upload' | 'importing' | 'result'

async function computeFileHash(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function ShopeeSettlementImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ inserted: number; skipped: number; totalNetPayout?: number } | null>(null)
  const [allowReimport, setAllowReimport] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<{ existingBatchId: string; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('upload')
    setFile(null)
    setError(null)
    setProgress(0)
    setResult(null)
    setAllowReimport(false)
    setDuplicateInfo(null)
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  async function handleImport(selectedFile: File, reimport = false) {
    setStep('importing')
    setProgress(0)
    setError(null)
    setDuplicateInfo(null)

    try {
      const text = await selectedFile.text()
      const parsed = parseShopeeSettlementCSV(text)

      if (!parsed.success || parsed.rows.length === 0) {
        const firstError = parsed.errors[0]?.message ?? 'ไม่สามารถ parse ไฟล์ได้'
        setError(firstError)
        setStep('upload')
        return
      }

      const fileHash = await computeFileHash(text)

      // Create batch
      const batchForm = new FormData()
      batchForm.set('fileHash', fileHash)
      batchForm.set('fileName', selectedFile.name)
      batchForm.set('totalRows', String(parsed.rows.length))
      batchForm.set('dateRange', '')
      batchForm.set('allowReimport', String(reimport))

      const batchResult = await createShopeeSettlementBatch(batchForm)
      if (!batchResult.success) {
        if (batchResult.status === 'duplicate_file') {
          setDuplicateInfo({ existingBatchId: batchResult.existingBatchId!, message: batchResult.message! })
          setStep('upload')
          return
        }
        setError(batchResult.error ?? 'ไม่สามารถสร้าง batch ได้')
        setStep('upload')
        return
      }

      const batchId = batchResult.batchId!

      // Import chunks
      const totalChunks = Math.ceil(parsed.rows.length / CHUNK_SIZE)
      let totalInserted = 0
      let totalSkipped = 0

      for (let i = 0; i < totalChunks; i++) {
        const chunk = parsed.rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        const chunkForm = new FormData()
        chunkForm.set('batchId', batchId)
        chunkForm.set('chunkDataJson', JSON.stringify(chunk))
        chunkForm.set('chunkIndex', String(i))
        chunkForm.set('totalChunks', String(totalChunks))

        const chunkResult = await importShopeeSettlementChunk(chunkForm)
        if (!chunkResult.success) {
          setError(chunkResult.error ?? 'เกิดข้อผิดพลาดระหว่าง import')
          setStep('result')
          setResult({ inserted: totalInserted, skipped: totalSkipped })
          return
        }
        totalInserted += chunkResult.inserted
        totalSkipped += chunkResult.skipped
        setProgress(Math.round(((i + 1) / totalChunks) * 100))
      }

      // Finalize
      const finalForm = new FormData()
      finalForm.set('batchId', batchId)
      finalForm.set('totalInserted', String(totalInserted))
      finalForm.set('totalSkipped', String(totalSkipped))
      finalForm.set('summaryJson', JSON.stringify({
        totalNetPayout: parsed.summary.totalNetPayout,
        totalCommission: parsed.summary.totalCommission,
        totalRefunds: parsed.summary.totalRefunds,
        orderCount: parsed.summary.orderCount,
      }))

      await finalizeShopeeSettlementBatch(finalForm)

      setResult({
        inserted: totalInserted,
        skipped: totalSkipped,
        totalNetPayout: parsed.summary.totalNetPayout,
      })
      setStep('result')
      onSuccess?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStep('result')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import Shopee Settlement (โอนเงินสำเร็จ)</DialogTitle>
        </DialogHeader>

        {/* STEP: upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              อัปโหลดไฟล์ <strong>Income / โอนเงินสำเร็จ</strong> (.csv)
              <br />
              <span className="text-xs">ไฟล์: Income.โอนเงินสำเร็จ.th.YYYYMMDD_YYYYMMDD.xlsx - Income.csv</span>
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {duplicateInfo && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p>{duplicateInfo.message}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      setAllowReimport(true)
                      setDuplicateInfo(null)
                      if (file) handleImport(file, true)
                    }}
                  >
                    Import ซ้ำ (upsert)
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-8 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <p className="text-sm text-gray-600">คลิกเพื่อเลือกไฟล์ .csv</p>
              {file && <p className="text-xs text-green-600 mt-1">{file.name}</p>}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setFile(f)
                  setError(null)
                  setDuplicateInfo(null)
                }
                e.target.value = ''
              }}
            />
          </div>
        )}

        {/* STEP: importing */}
        {step === 'importing' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              กำลัง import...
            </p>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-orange-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-center text-muted-foreground">{progress}%</p>
          </div>
        )}

        {/* STEP: result */}
        {step === 'result' && (
          <div className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-green-500 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-700">
                  Import สำเร็จ: <strong>{result?.inserted ?? 0}</strong> รายการ
                  {(result?.skipped ?? 0) > 0 && ` (ข้ามซ้ำ ${result?.skipped} รายการ)`}
                  {result?.totalNetPayout != null && (
                    <div className="mt-1 text-sm">
                      Net Payout รวม: ฿{result.totalNetPayout.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                <X className="mr-2 h-4 w-4" /> ยกเลิก
              </Button>
              <Button
                onClick={() => file && handleImport(file, allowReimport)}
                disabled={!file}
              >
                <Upload className="mr-2 h-4 w-4" /> Import
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button onClick={handleClose}>ปิด</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
