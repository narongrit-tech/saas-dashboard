'use client'

/**
 * ShopeeBalanceImportDialog
 * Import "My Balance Transaction Report" (.csv หรือ .xlsx) into shopee_wallet_transactions
 */

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react'
import { parseShopeeBalanceFile } from '@/lib/importers/shopee-balance-parser'
import { calculateFileHash } from '@/lib/file-hash'
import {
  createShopeeBalanceBatch,
  importShopeeBalanceChunk,
  finalizeShopeeBalanceBatch,
} from '@/app/(dashboard)/finance/shopee/shopee-finance-actions'

const CHUNK_SIZE = 500

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type Step = 'upload' | 'importing' | 'result'

export function ShopeeBalanceImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{ existingBatchId: string; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('upload')
    setFile(null)
    setError(null)
    setProgress(0)
    setResult(null)
    setDuplicateInfo(null)
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  async function handleImport(selectedFile: File, allowReimport = false) {
    setStep('importing')
    setProgress(5)
    setError(null)
    setDuplicateInfo(null)

    try {
      // Read file as ArrayBuffer (works for both CSV and XLSX)
      const buffer = await selectedFile.arrayBuffer()

      // Parse (auto-detects CSV vs XLSX from fileName)
      const parsed = await parseShopeeBalanceFile(buffer, selectedFile.name)

      if (!parsed.success || parsed.rows.length === 0) {
        const firstError = parsed.errors[0]?.message ?? 'ไม่สามารถ parse ไฟล์ได้'
        setError(firstError)
        setStep('upload')
        return
      }

      setProgress(15)

      // Hash the raw buffer for dedup
      const fileHash = await calculateFileHash(buffer)

      // Create batch
      const batchForm = new FormData()
      batchForm.set('fileHash', fileHash)
      batchForm.set('fileName', selectedFile.name)
      batchForm.set('totalRows', String(parsed.rows.length))
      batchForm.set('dateRange', '')
      batchForm.set('allowReimport', String(allowReimport))

      const batchResult = await createShopeeBalanceBatch(batchForm)
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

        const chunkResult = await importShopeeBalanceChunk(chunkForm)
        if (!chunkResult.success) {
          setError(chunkResult.error ?? 'เกิดข้อผิดพลาดระหว่าง import')
          setResult({ inserted: totalInserted, skipped: totalSkipped })
          setStep('result')
          return
        }
        totalInserted += chunkResult.inserted
        totalSkipped += chunkResult.skipped
        setProgress(15 + Math.round(((i + 1) / totalChunks) * 80))
      }

      const finalForm = new FormData()
      finalForm.set('batchId', batchId)
      finalForm.set('totalInserted', String(totalInserted))
      finalForm.set('totalSkipped', String(totalSkipped))
      await finalizeShopeeBalanceBatch(finalForm)

      setProgress(100)
      setResult({ inserted: totalInserted, skipped: totalSkipped })
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
          <DialogTitle>Import Shopee Balance Transactions</DialogTitle>
        </DialogHeader>

        {/* STEP: upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              อัปโหลดไฟล์ <strong>My Balance Transaction Report</strong>
              <br />
              <span className="text-xs text-gray-500">ไฟล์: my_balance_transaction_report...xlsx หรือ .csv</span>
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
              <p className="text-sm text-gray-600">คลิกเพื่อเลือกไฟล์</p>
              <p className="text-xs text-gray-400 mt-1">.xlsx หรือ .csv</p>
              {file && <p className="text-xs text-green-600 mt-2 font-medium">{file.name}</p>}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) { setFile(f); setError(null); setDuplicateInfo(null) }
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
              <Button onClick={() => file && handleImport(file)} disabled={!file}>
                <Upload className="mr-2 h-4 w-4" /> Import
              </Button>
            </>
          )}
          {step === 'result' && <Button onClick={handleClose}>ปิด</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
