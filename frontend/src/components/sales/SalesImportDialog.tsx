'use client'

/**
 * Sales Import Dialog
 * Phase 6: CSV/Excel Import Infrastructure
 */

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import {
  createImportBatch,
  importSalesChunk,
  finalizeImportBatch,
} from '@/app/(dashboard)/sales/sales-import-actions'
import { SalesImportPreview, ParsedSalesRow } from '@/types/sales-import'
import { calculateFileHash, toPlain } from '@/lib/file-hash'
import { parseTikTokFile } from '@/lib/sales-parser'

interface SalesImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type Step = 'upload' | 'preview' | 'duplicate' | 'importing' | 'result'

/**
 * Helper: Build FormData for createImportBatch Server Action
 * Prevents payload errors by ensuring proper serialization
 */
function buildBatchFormData(
  fileHash: string,
  fileName: string,
  totalRows: number,
  dateRange: string,
  allowReimport: boolean
): FormData {
  const formData = new FormData()
  formData.append('fileHash', fileHash)
  formData.append('fileName', fileName)
  formData.append('totalRows', String(totalRows))
  formData.append('dateRange', dateRange)
  formData.append('allowReimport', String(allowReimport))
  return formData
}

/**
 * Helper: Build FormData for importSalesChunk Server Action
 */
function buildChunkFormData(
  batchId: string,
  chunkDataJson: string,
  chunkIndex: number,
  totalChunks: number
): FormData {
  const formData = new FormData()
  formData.append('batchId', batchId)
  formData.append('chunkDataJson', chunkDataJson)
  formData.append('chunkIndex', String(chunkIndex))
  formData.append('totalChunks', String(totalChunks))
  return formData
}

/**
 * Helper: Build FormData for finalizeImportBatch Server Action
 */
function buildFinalizeFormData(
  batchId: string,
  totalInserted: number,
  parsedDataJson: string
): FormData {
  const formData = new FormData()
  formData.append('batchId', batchId)
  formData.append('totalInserted', String(totalInserted))
  formData.append('parsedDataJson', parsedDataJson)
  return formData
}

export function SalesImportDialog({ open, onOpenChange, onSuccess }: SalesImportDialogProps) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<SalesImportPreview | null>(null)
  const [parsedData, setParsedData] = useState<ParsedSalesRow[]>([])
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{ fileName: string; importedAt: string } | null>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setIsProcessing(true)

    try {
      // Read file as ArrayBuffer
      const buffer = await selectedFile.arrayBuffer()
      setFileBuffer(buffer)

      // Parse file (CLIENT-SIDE to avoid ArrayBuffer in server action)
      const previewResult = await parseTikTokFile(buffer, selectedFile.name)

      setPreview(previewResult)

      if (previewResult.success && previewResult.allRows && previewResult.allRows.length > 0) {
        // Store full parsed data for import (already plain objects)
        setParsedData(previewResult.allRows)
        setStep('preview')
      } else {
        // Show errors
        setStep('preview')
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setPreview({
        success: false,
        importType: 'generic',
        totalRows: 0,
        sampleRows: [],
        summary: { totalRevenue: 0, totalOrders: 0, uniqueOrderIds: 0, lineCount: 0 },
        errors: [{ message: errorMessage, severity: 'error' }],
        warnings: [],
      })
      setStep('preview')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleConfirmImport = async (allowReimport = false) => {
    if (!file || !fileBuffer || !preview || !preview.success || parsedData.length === 0) {
      return
    }

    setStep('importing')
    setIsProcessing(true)
    setImportProgress(null)

    try {
      // Calculate file hash (client-side)
      const fileHash = await calculateFileHash(fileBuffer)

      // Sanitize parsed data to plain objects (remove Date objects, etc.)
      const plainData = toPlain(parsedData)

      // Determine date range for batch
      const dateRange = plainData.length > 0
        ? `${plainData[0].order_date} to ${plainData[plainData.length - 1].order_date}`
        : 'N/A'

      // Step 1: Create import batch (with allowReimport flag)
      const batchFormData = buildBatchFormData(
        fileHash,
        file.name,
        plainData.length,
        dateRange,
        allowReimport
      )
      const batchResult = await createImportBatch(batchFormData)

      // Handle duplicate file detection
      if (batchResult.status === 'duplicate_file' && !allowReimport) {
        setDuplicateInfo({
          fileName: batchResult.fileName || file.name,
          importedAt: batchResult.importedAt || 'Unknown',
        })
        setIsProcessing(false)
        setStep('duplicate')
        return
      }

      if (!batchResult.success || !batchResult.batchId) {
        setResult({
          success: false,
          message: batchResult.error || 'Failed to create import batch'
        })
        setIsProcessing(false)
        setStep('result')
        return
      }

      const batchId = batchResult.batchId

      // Step 2: Split data into chunks (500 rows per chunk)
      const CHUNK_SIZE = 500
      const chunks: ParsedSalesRow[][] = []
      for (let i = 0; i < plainData.length; i += CHUNK_SIZE) {
        chunks.push(plainData.slice(i, i + CHUNK_SIZE))
      }

      // Step 3: Import chunks sequentially
      let totalInserted = 0
      for (let i = 0; i < chunks.length; i++) {
        setImportProgress({ current: i + 1, total: chunks.length })

        const chunkFormData = buildChunkFormData(
          batchId,
          JSON.stringify(chunks[i]),
          i,
          chunks.length
        )
        const chunkResult = await importSalesChunk(chunkFormData)

        if (!chunkResult.success) {
          // Chunk failed - finalize with error
          setResult({
            success: false,
            message: `Import failed at chunk ${i + 1}/${chunks.length}: ${chunkResult.error || 'Unknown error'}`
          })
          setIsProcessing(false)
          setStep('result')
          return
        }

        totalInserted += chunkResult.inserted
      }

      // Step 4: Finalize import batch
      const finalizeFormData = buildFinalizeFormData(
        batchId,
        totalInserted,
        JSON.stringify(plainData)
      )
      const finalResult = await finalizeImportBatch(finalizeFormData)

      if (finalResult.success) {
        setResult({
          success: true,
          message: `Import สำเร็จ: ${finalResult.inserted} รายการ${finalResult.summary ? ` | รายได้รวม: ฿${finalResult.summary.totalRevenue.toLocaleString()}` : ''}`
        })
        onSuccess()
      } else {
        setResult({
          success: false,
          message: finalResult.error || 'Import failed'
        })
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setResult({
        success: false,
        message: errorMessage
      })
    } finally {
      setIsProcessing(false)
      setImportProgress(null)
      setStep('result')
    }
  }

  const handleClose = () => {
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setPreview(null)
    setParsedData([])
    setResult(null)
    setIsProcessing(false)
    setImportProgress(null)
    setDuplicateInfo(null)
    onOpenChange(false)
  }

  const handleReimport = () => {
    // Proceed to import with allowReimport=true
    handleConfirmImport(true)
  }

  const handleCancelReimport = () => {
    // Reset to upload state
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setPreview(null)
    setParsedData([])
    setDuplicateInfo(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Sales Orders</DialogTitle>
          <DialogDescription>
            Upload TikTok Shop (OrderSKUList .xlsx) หรือไฟล์อื่นๆ
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  รองรับ: .xlsx (TikTok Shop OrderSKUList)
                </p>
                <Input
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileSelect}
                  disabled={isProcessing}
                  className="max-w-sm mx-auto"
                />
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>TikTok Shop:</strong> ไฟล์ต้องเป็น OrderSKUList format จาก TikTok Seller Center
                <br />
                <strong>Line-level import:</strong> แต่ละ SKU จะถูกเก็บแยก row (ไม่ double-count order totals)
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Total Rows</div>
                <div className="text-2xl font-bold">{preview.totalRows}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Total Revenue</div>
                <div className="text-2xl font-bold">
                  ฿{preview.summary.totalRevenue.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Errors */}
            {preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Errors ({preview.errors.length}):</strong>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    {preview.errors.slice(0, 5).map((err, i) => (
                      <li key={i} className="text-sm">
                        {err.row ? `Row ${err.row}: ` : ''}{err.message}
                      </li>
                    ))}
                    {preview.errors.length > 5 && (
                      <li className="text-sm">... and {preview.errors.length - 5} more</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {preview.warnings.map((warn, i) => (
                    <div key={i}>{warn}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* Sample Data */}
            {preview.sampleRows.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-4 py-2 font-medium text-sm">
                  Sample Rows (first {preview.sampleRows.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-2 text-left">Order ID</th>
                        <th className="px-4 py-2 text-left">Product</th>
                        <th className="px-4 py-2 text-right">Qty</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                        <th className="px-4 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-2">{row.order_id}</td>
                          <td className="px-4 py-2">{row.product_name}</td>
                          <td className="px-4 py-2 text-right">{row.quantity}</td>
                          <td className="px-4 py-2 text-right">
                            ฿{row.total_amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-2">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirmImport}
                disabled={!preview.success || isProcessing}
              >
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm Import
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Duplicate File Prompt */}
        {step === 'duplicate' && duplicateInfo && (
          <div className="space-y-4">
            <Alert className="border-amber-500 bg-amber-50 text-amber-900">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">ไฟล์นี้ถูก import ไปแล้ว</p>
                  <p className="text-sm">
                    <strong>ไฟล์:</strong> {duplicateInfo.fileName}
                    <br />
                    <strong>นำเข้าเมื่อ:</strong> {duplicateInfo.importedAt}
                  </p>
                  <p className="text-sm">
                    คุณต้องการนำเข้าซ้ำเพื่ออัปเดตข้อมูลหรือไม่? (ข้อมูลเดิมจะถูก update หากมีการเปลี่ยนแปลง)
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancelReimport}>
                ยกเลิก
              </Button>
              <Button onClick={handleReimport} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                นำเข้าซ้ำเพื่ออัปเดตข้อมูล
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Importing */}
        {step === 'importing' && (
          <div className="text-center py-8">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Importing...</p>
            {importProgress ? (
              <p className="text-sm text-muted-foreground">
                Processing chunk {importProgress.current} of {importProgress.total}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">กรุณารอสักครู่</p>
            )}
          </div>
        )}

        {/* Step 5: Result */}
        {step === 'result' && result && (
          <div className="space-y-4">
            <Alert variant={result.success ? 'default' : 'destructive'}>
              {result.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button onClick={handleClose}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
