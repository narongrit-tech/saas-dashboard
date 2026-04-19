'use client'

/**
 * Sales Import Dialog
 * Phase 6: CSV/Excel Import Infrastructure
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
import { FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Info, ExternalLink, Package } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { MAX_IMPORT_FILE_SIZE_BYTES, MAX_IMPORT_FILE_SIZE_LABEL, REJECTED_MIME_RE } from '@/lib/import-constraints'
import {
  createImportBatch,
  importSalesChunk,
  finalizeImportBatch,
  replaceSalesImportBatch,
} from '@/app/(dashboard)/sales/sales-import-actions'
import { applyCOGSForBatch } from '@/app/(dashboard)/inventory/actions'
import { SalesImportPreview, ParsedSalesRow, SalesImportResult } from '@/types/sales-import'
import { calculateFileHash, toPlain } from '@/lib/file-hash'
import { parseTikTokFile } from '@/lib/sales-parser'

interface SalesImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type Step = 'upload' | 'preview' | 'duplicate' | 'already_processing' | 'importing' | 'result'

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
  const router = useRouter()
  const { toast } = useToast()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<SalesImportPreview | null>(null)
  const [parsedData, setParsedData] = useState<ParsedSalesRow[]>([])
  const [result, setResult] = useState<SalesImportResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [forceReimport, setForceReimport] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<{
    fileName: string;
    importedAt: string;
    existingBatchId?: string;
    existingRowCount?: number;
    fileHash?: string;
  } | null>(null)
  const [processingInfo, setProcessingInfo] = useState<{ batchId?: string; fileName?: string; createdAt?: string } | null>(null)
  const [cogsApplying, setCogsApplying] = useState(false)
  const [cogsApplied, setCogsApplied] = useState(false)
  const [cogsError, setCogsError] = useState<string | null>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    if (selectedFile.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      toast({ variant: 'destructive', title: 'ไฟล์ใหญ่เกินไป', description: `ขนาดไฟล์ต้องไม่เกิน ${MAX_IMPORT_FILE_SIZE_LABEL}` })
      e.target.value = ''
      return
    }
    if (selectedFile.type && REJECTED_MIME_RE.test(selectedFile.type)) {
      toast({ variant: 'destructive', title: 'ประเภทไฟล์ไม่รองรับ', description: 'รองรับเฉพาะไฟล์ CSV และ Excel เท่านั้น' })
      e.target.value = ''
      return
    }

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
    console.log('[IMPORT] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('[IMPORT] START handleConfirmImport')
    console.log('[IMPORT] allowReimport:', allowReimport)
    console.log('[IMPORT] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    if (!file || !fileBuffer || !preview || !preview.success || parsedData.length === 0) {
      console.error('[IMPORT] Pre-condition failed:', {
        hasFile: !!file,
        hasFileBuffer: !!fileBuffer,
        hasPreview: !!preview,
        previewSuccess: preview?.success,
        parsedDataLength: parsedData.length
      })
      return
    }

    setStep('importing')
    setIsProcessing(true)
    setImportProgress(null)

    try {
      // Calculate file hash (client-side)
      const fileHash = await calculateFileHash(fileBuffer)
      console.log('[IMPORT] File hash calculated:', fileHash.substring(0, 16) + '...')

      // Sanitize parsed data to plain objects (remove Date objects, etc.)
      const plainData = toPlain(parsedData)
      console.log('[IMPORT] Plain data rows:', plainData.length)

      // Determine date range for batch
      const dateRange = plainData.length > 0
        ? `${plainData[0].order_date} to ${plainData[plainData.length - 1].order_date}`
        : 'N/A'

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 1: Create import batch
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log('[IMPORT] STEP 1: Calling createImportBatch')
      const batchFormData = buildBatchFormData(
        fileHash,
        file.name,
        plainData.length,
        dateRange,
        allowReimport
      )
      const batchResult = await createImportBatch(batchFormData)
      console.log('[IMPORT] createImportBatch result:', {
        status: batchResult.status,
        success: batchResult.success,
        batchId: batchResult.batchId,
        error: batchResult.error
      })

      // Handle duplicate file detection - THROW ERROR instead of early return
      if (batchResult.status === 'duplicate_file') {
        console.log('[IMPORT] Server returned: DUPLICATE_FILE')
        console.log('[IMPORT] Message:', batchResult.message)

        let formattedDate = 'Unknown'
        if (batchResult.importedAt) {
          try {
            const date = new Date(batchResult.importedAt)
            formattedDate = new Intl.DateTimeFormat('th-TH', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Bangkok'
            }).format(date)
          } catch {
            formattedDate = 'Unknown'
          }
        }

        setDuplicateInfo({
          fileName: batchResult.fileName || file.name,
          importedAt: formattedDate,
          existingBatchId: batchResult.existingBatchId,
          existingRowCount: batchResult.existingRowCount,
          fileHash,
        })
        setIsProcessing(false)
        setStep('duplicate')

        // Show toast notification
        toast({
          variant: 'default',
          title: 'ไฟล์ซ้ำ',
          description: `ไฟล์นี้ถูก import ไปแล้วเมื่อ ${formattedDate} (${batchResult.existingRowCount || 0} รายการ)`,
        })

        // THROW to prevent chunk/finalize from running
        throw new Error(`DUPLICATE_FILE: File imported at ${formattedDate}`)
      }

      // Handle already processing detection - THROW ERROR instead of early return
      if (batchResult.status === 'already_processing') {
        console.log('[IMPORT] Server returned: ALREADY_PROCESSING')
        console.log('[IMPORT] Message:', batchResult.message)

        let formattedDate = 'Unknown'
        if (batchResult.createdAt) {
          try {
            const date = new Date(batchResult.createdAt)
            formattedDate = new Intl.DateTimeFormat('th-TH', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Bangkok'
            }).format(date)
          } catch {
            formattedDate = 'Unknown'
          }
        }

        setProcessingInfo({
          batchId: batchResult.batchId,
          fileName: batchResult.fileName || file.name,
          createdAt: formattedDate,
        })
        setIsProcessing(false)
        setStep('already_processing')

        // Show toast notification
        toast({
          variant: 'default',
          title: 'กำลัง import อยู่',
          description: `ไฟล์นี้กำลังถูก import อยู่ (เริ่มเมื่อ ${formattedDate})`,
        })

        // THROW to prevent chunk/finalize from running
        throw new Error(`ALREADY_PROCESSING: File started at ${formattedDate}`)
      }

      // Batch creation failed - THROW ERROR
      if (!batchResult.success || !batchResult.batchId) {
        const errorMsg = batchResult.error || 'Failed to create import batch'
        console.error('[IMPORT] Batch creation failed:', errorMsg)
        throw new Error(`BATCH_FAILED: ${errorMsg}`)
      }

      const batchId = batchResult.batchId
      console.log('[IMPORT] ✅ Batch created successfully:', batchId)

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 2: Import chunks sequentially
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const CHUNK_SIZE = 500
      const chunks: ParsedSalesRow[][] = []
      for (let i = 0; i < plainData.length; i += CHUNK_SIZE) {
        chunks.push(plainData.slice(i, i + CHUNK_SIZE))
      }

      console.log('[IMPORT] STEP 2: Importing chunks')
      console.log('[IMPORT] Total chunks:', chunks.length)

      let totalInserted = 0
      for (let i = 0; i < chunks.length; i++) {
        setImportProgress({ current: i + 1, total: chunks.length })

        console.log(`[IMPORT] ━━━ Chunk ${i + 1}/${chunks.length} ━━━`)
        console.log(`[IMPORT] Chunk rows:`, chunks[i].length)
        console.log(`[IMPORT] Calling importSalesChunk...`)

        const chunkFormData = buildChunkFormData(
          batchId,
          JSON.stringify(chunks[i]),
          i,
          chunks.length
        )

        const chunkResult = await importSalesChunk(chunkFormData)
        console.log(`[IMPORT] Chunk ${i + 1} result:`, {
          success: chunkResult.success,
          inserted: chunkResult.inserted,
          error: chunkResult.error
        })

        // Chunk failed - THROW ERROR
        if (!chunkResult.success) {
          const errorMsg = `Chunk ${i + 1}/${chunks.length} failed: ${chunkResult.error || 'Unknown error'}`
          console.error('[IMPORT] Chunk error:', errorMsg)
          throw new Error(`CHUNK_FAILED: ${errorMsg}`)
        }

        totalInserted += chunkResult.inserted
        console.log(`[IMPORT] Chunk ${i + 1} success, total inserted so far:`, totalInserted)
      }

      console.log('[IMPORT] ✅ All chunks imported successfully, total:', totalInserted)

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 3: Finalize import batch (MUST RUN)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log('[IMPORT] STEP 3: Calling finalizeImportBatch')
      console.log('[IMPORT] Batch ID:', batchId)
      console.log('[IMPORT] Total inserted:', totalInserted)

      const finalizeFormData = buildFinalizeFormData(
        batchId,
        totalInserted,
        JSON.stringify(plainData)
      )

      const finalResult = await finalizeImportBatch(finalizeFormData)
      console.log('[IMPORT] finalizeImportBatch result:', {
        success: finalResult.success,
        inserted: finalResult.inserted,
        updated: finalResult.updated,
        error: finalResult.error
      })

      // Finalize failed - THROW ERROR
      if (!finalResult.success) {
        const errorMsg = finalResult.error || 'Finalize failed'
        console.error('[IMPORT] Finalize error:', errorMsg)
        throw new Error(`FINALIZE_FAILED: ${errorMsg}`)
      }

      console.log('[IMPORT] ✅ ✅ ✅ IMPORT SUCCESS ✅ ✅ ✅')
      console.log('[IMPORT] Final result:', {
        inserted: finalResult.inserted,
        updated: finalResult.updated,
        dateRange: finalResult.dateRange
      })

      setResult(finalResult)

      // Show success toast
      toast({
        title: 'Import Success',
        description: `นำเข้า ${finalResult.inserted} รายการ${finalResult.skipped > 0 ? ` (ข้าม ${finalResult.skipped} duplicates)` : ''}${finalResult.updated > 0 ? `, อัปเดต ${finalResult.updated} รายการ` : ''}`,
      })

      onSuccess()

    } catch (error: unknown) {
      console.error('[IMPORT] ❌❌❌ IMPORT FAILED ❌❌❌')
      console.error('[IMPORT] Error:', error)
      console.error('[IMPORT] Error stack:', error instanceof Error ? error.stack : 'N/A')

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Check if error is from duplicate/already_processing - don't show error result
      if (errorMessage.startsWith('DUPLICATE_FILE:') || errorMessage.startsWith('ALREADY_PROCESSING:')) {
        console.log('[IMPORT] User action required (duplicate/processing), UI already updated')
        return
      }

      // Real error - show error result with user-friendly messages
      let userFriendlyError = errorMessage.replace(/^(BATCH_FAILED|CHUNK_FAILED|FINALIZE_FAILED): /, '')

      // Add helpful context based on error type
      if (errorMessage.includes('BATCH_FAILED')) {
        userFriendlyError = `ไม่สามารถสร้าง import batch ได้\n\nรายละเอียด: ${userFriendlyError}\n\nกรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ`
      } else if (errorMessage.includes('CHUNK_FAILED')) {
        userFriendlyError = `การนำเข้าข้อมูลล้มเหลว\n\nรายละเอียด: ${userFriendlyError}\n\nอาจเกิดจากข้อมูลไม่ถูกต้องหรือปัญหาการเชื่อมต่อ กรุณาตรวจสอบไฟล์และลองอีกครั้ง`
      } else if (errorMessage.includes('FINALIZE_FAILED')) {
        userFriendlyError = `ไม่สามารถตรวจสอบผลการ import ได้\n\nรายละเอียด: ${userFriendlyError}\n\nกรุณาตรวจสอบว่าข้อมูลถูกนำเข้าสำเร็จหรือไม่ใน Sales Orders`
      } else if (errorMessage.includes('Authentication')) {
        userFriendlyError = `การยืนยันตัวตนล้มเหลว\n\nกรุณา login ใหม่แล้วลองอีกครั้ง`
      } else if (errorMessage.includes('RLS')) {
        userFriendlyError = `ไม่มีสิทธิ์เข้าถึงข้อมูล\n\nกรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบ permissions`
      }

      const errorResult: SalesImportResult = {
        success: false,
        error: userFriendlyError,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      }
      setResult(errorResult)

      // Show error toast with truncated message
      const toastMessage = userFriendlyError.split('\n')[0] // First line only
      toast({
        variant: 'destructive',
        title: 'Import ล้มเหลว',
        description: toastMessage,
      })

    } finally {
      console.log('[IMPORT] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('[IMPORT] END handleConfirmImport')
      console.log('[IMPORT] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      setIsProcessing(false)
      setImportProgress(null)
      setStep('result')
    }
  }

  const handleClose = () => {
    // Reset to initial state on close
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setPreview(null)
    setParsedData([])
    setResult(null)
    setIsProcessing(false)
    setForceReimport(false)
    setImportProgress(null)
    setDuplicateInfo(null)
    setProcessingInfo(null)
    onOpenChange(false)
  }

  // CRITICAL: Force reset to upload state when dialog opens
  useEffect(() => {
    console.log('[SalesImportDialog] open:', open)
    if (open) {
      console.log('[SalesImportDialog] Dialog opened, resetting to upload state')
      setStep('upload')
      setFile(null)
      setFileBuffer(null)
      setPreview(null)
      setParsedData([])
      setResult(null)
      setIsProcessing(false)
      setImportProgress(null)
      setDuplicateInfo(null)
      setProcessingInfo(null)
    }
  }, [open])

  // Debug: Log step changes
  useEffect(() => {
    console.log('[SalesImportDialog] step:', step, { hasFile: !!file, hasPreview: !!preview, isProcessing })
  }, [step, file, preview, isProcessing])

  const handleReimport = () => {
    // Proceed to import with allowReimport=true (update mode)
    handleConfirmImport(true)
  }

  const handleReplaceAndReimport = async () => {
    if (!duplicateInfo?.existingBatchId || !duplicateInfo?.fileHash) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'ไม่พบข้อมูล batch เดิม กรุณาลองใหม่',
      })
      return
    }

    console.log('[REPLACE] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('[REPLACE] START - Replace and re-import')
    console.log('[REPLACE] Existing batch:', duplicateInfo.existingBatchId)
    console.log('[REPLACE] Existing rows:', duplicateInfo.existingRowCount)

    setIsProcessing(true)
    setStep('importing')

    try {
      // STEP 1: Replace (delete old data)
      console.log('[REPLACE] STEP 1: Calling replaceSalesImportBatch...')
      const replaceFormData = new FormData()
      replaceFormData.append('existingBatchId', duplicateInfo.existingBatchId)
      replaceFormData.append('marketplace', 'tiktok_shop')
      replaceFormData.append('reportType', 'sales_order_sku_list')
      replaceFormData.append('fileHash', duplicateInfo.fileHash)

      const replaceResult = await replaceSalesImportBatch(replaceFormData)
      console.log('[REPLACE] Replace result:', replaceResult)

      if (!replaceResult.success) {
        throw new Error(`Replace failed: ${replaceResult.error}`)
      }

      console.log('[REPLACE] ✅ Replace success - deleted ${replaceResult.deletedCount} rows')

      // Show progress toast
      toast({
        title: 'ลบข้อมูลเดิมแล้ว',
        description: `ลบ ${replaceResult.deletedCount} รายการเดิม กำลังนำเข้าข้อมูลใหม่...`,
      })

      // STEP 2: Re-import with allowReimport=true
      console.log('[REPLACE] STEP 2: Re-importing with allowReimport=true...')
      await handleConfirmImport(true)

      console.log('[REPLACE] ✅ REPLACE AND REIMPORT SUCCESS')
      console.log('[REPLACE] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    } catch (error: unknown) {
      console.error('[REPLACE] ❌ Replace and re-import failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Check if error is from import flow (not replace)
      if (!errorMessage.includes('Replace failed')) {
        // Import failed after replace - data already deleted!
        console.error('[REPLACE] CRITICAL: Data deleted but import failed!')
      }

      const errorResult: SalesImportResult = {
        success: false,
        error: `Replace and re-import failed: ${errorMessage}`,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      }
      setResult(errorResult)
      setStep('result')

      toast({
        variant: 'destructive',
        title: 'Replace ล้มเหลว',
        description: errorMessage,
      })
    } finally {
      setIsProcessing(false)
    }
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
        {step === 'upload' && (() => {
          console.log('[SalesImportDialog RENDER] Upload section rendered')
          return (
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
                  <p className="text-xs text-muted-foreground mt-2">
                    เลือกไฟล์ .xlsx เพื่อเริ่มต้น
                  </p>
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
          )
        })()}

        {/* Step 2: Preview */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            {/* Summary - REAL NUMBERS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Total Lines (SKU)</div>
                <div className="text-2xl font-bold">{preview.totalRows.toLocaleString()}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Unique Orders</div>
                <div className="text-2xl font-bold">
                  {preview.summary.uniqueOrderIds?.toLocaleString() || preview.summary.totalOrders?.toLocaleString() || 'N/A'}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">GMV (Completed)</div>
                <div className="text-2xl font-bold">
                  ฿{preview.summary.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Date Range</div>
                <div className="text-lg font-bold">
                  {preview.dateRange ? `${preview.dateRange.start} to ${preview.dateRange.end}` : 'N/A'}
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

            {/* Force Re-import Option */}
            <div className="flex items-center space-x-2 p-4 border rounded-lg bg-muted/50">
              <input
                type="checkbox"
                id="forceReimport"
                checked={forceReimport}
                onChange={(e) => setForceReimport(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label
                htmlFor="forceReimport"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Force Re-import (อนุญาตให้นำเข้าไฟล์ซ้ำ - ใช้สำหรับ update ข้อมูล)
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={() => handleConfirmImport(forceReimport)}
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
            <Alert className="border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription>
                <div className="space-y-3">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">
                    ไฟล์นี้ถูก import ไปแล้ว
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <strong>ไฟล์:</strong> {duplicateInfo.fileName}
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <strong>นำเข้าเมื่อ:</strong> {duplicateInfo.importedAt}
                  </p>
                  {duplicateInfo.existingRowCount !== undefined && (
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>จำนวนรายการ:</strong> {duplicateInfo.existingRowCount} รายการ
                    </p>
                  )}
                  <div className="border-t border-amber-300 dark:border-amber-700 pt-2 mt-2">
                    <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mb-1">
                      💡 คุณต้องการทำอย่างไร?
                    </p>
                    <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-300 space-y-1">
                      <li><strong>อัปเดต:</strong> รายการที่ซ้ำจะถูกอัปเดต, รายการใหม่จะถูกเพิ่ม (ข้อมูลเดิมยังอยู่)</li>
                      <li><strong>แทนที่:</strong> ลบข้อมูลเดิมทั้งหมดแล้วนำเข้าใหม่ (เริ่มต้นใหม่จากศูนย์)</li>
                    </ul>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
                      ⚠️ คำเตือน: การแทนที่จะลบข้อมูลเดิมถาวร กรุณาตรวจสอบให้แน่ใจก่อนดำเนินการ
                    </p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancelReimport}>
                ยกเลิก
              </Button>
              <Button variant="secondary" onClick={handleReimport} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                อัปเดตข้อมูล
              </Button>
              <Button variant="destructive" onClick={handleReplaceAndReimport} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                แทนที่ข้อมูลเดิม
              </Button>
            </div>
          </div>
        )}

        {/* Step 3.5: Already Processing */}
        {step === 'already_processing' && processingInfo && (
          <div className="space-y-4">
            <Alert className="border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold text-blue-900 dark:text-blue-100">
                    กำลัง import ไฟล์นี้อยู่
                  </p>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>ไฟล์:</strong> {processingInfo.fileName}
                  </p>
                  {processingInfo.createdAt && (
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>เริ่มเมื่อ:</strong> {processingInfo.createdAt}
                    </p>
                  )}
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    ไฟล์นี้กำลังถูก import อยู่ กรุณารอให้เสร็จก่อนแล้วค่อย import ใหม่
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button variant="outline" onClick={handleClose}>
                ปิด
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
              <AlertDescription>
                {result.success ? (
                  <div className="space-y-2">
                    <p className="font-semibold text-green-900 dark:text-green-100">
                      Import สำเร็จ
                    </p>
                    <div className="text-sm space-y-1">
                      {result.batchId && (
                        <p className="text-muted-foreground">
                          <strong>Batch ID:</strong> {result.batchId.substring(0, 8)}...
                        </p>
                      )}
                      <p>
                        <strong>นำเข้า:</strong> {result.inserted} รายการ
                        {result.updated > 0 && <span className="ml-2"><strong>อัปเดต:</strong> {result.updated} รายการ</span>}
                        {result.skipped > 0 && <span className="ml-2"><strong>ข้าม:</strong> {result.skipped} รายการ</span>}
                      </p>
                      {result.dateRange && (
                        <p>
                          <strong>ช่วงวันที่:</strong> {result.dateRange.min} ถึง {result.dateRange.max}
                          {result.dateBasisUsed && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (ตาม {result.dateBasisUsed === 'order_date' ? 'วันสั่งซื้อ' : 'วันชำระเงิน'})
                            </span>
                          )}
                        </p>
                      )}
                      {result.summary && (
                        <p>
                          <strong>รายได้รวม:</strong> ฿{result.summary.totalRevenue.toLocaleString()}
                          <span className="ml-2"><strong>จำนวน Orders:</strong> {result.summary.orderCount}</span>
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="font-semibold">Import ล้มเหลว</p>
                    <p className="text-sm">{result.error}</p>
                    {result.errors > 0 && (
                      <p className="text-sm">
                        <strong>Errors:</strong> {result.errors} รายการ
                      </p>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>

            {/* Apply COGS button (only when success and batchId available) */}
            {result.success && result.batchId && !cogsApplied && (
              <div className="space-y-2">
                <Button
                  variant="secondary"
                  disabled={cogsApplying}
                  onClick={async () => {
                    const batchId = result.batchId!
                    console.log(`[SalesImportDialog] Calling applyCOGSForBatch batchId=${batchId}`)
                    setCogsApplying(true)
                    setCogsError(null)
                    try {
                      const cogsResult = await applyCOGSForBatch(batchId)
                      console.log(`[SalesImportDialog] applyCOGSForBatch result:`, JSON.stringify({
                        success: cogsResult.success,
                        error: cogsResult.error,
                        cogs_run_id: cogsResult.data?.cogs_run_id,
                        eligible: cogsResult.data?.eligible,
                        successful: cogsResult.data?.successful,
                      }))
                      if (cogsResult.success) {
                        const d = cogsResult.data
                        toast({
                          title: 'Apply COGS เสร็จสิ้น',
                          description: `${d?.successful ?? 0} สำเร็จ, ${d?.skipped ?? 0} ข้าม, ${d?.failed ?? 0} ล้มเหลว — ดูรายละเอียดที่กระดิ่งมุมขวาบน`,
                        })
                        setCogsApplied(true)
                      } else {
                        const errMsg = cogsResult.error || 'Apply COGS ล้มเหลว'
                        console.error(`[SalesImportDialog] applyCOGSForBatch returned error: ${errMsg}`)
                        setCogsError(errMsg)
                      }
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : 'Apply COGS ล้มเหลว'
                      console.error(`[SalesImportDialog] applyCOGSForBatch threw:`, err)
                      setCogsError(msg)
                    } finally {
                      setCogsApplying(false)
                    }
                  }}
                >
                  {cogsApplying ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Package className="mr-2 h-4 w-4" />
                  )}
                  {cogsApplying ? 'กำลังประมวลผล COGS...' : 'Apply COGS สำหรับ batch นี้'}
                </Button>
                {cogsError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{cogsError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            {result.success && cogsApplied && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>COGS เสร็จสิ้น — ดูรายละเอียดที่กระดิ่งมุมขวาบน</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                ปิด
              </Button>
              {result.success && result.dateRange && (
                <Button
                  onClick={() => {
                    handleClose()
                    // Navigate to sales page with date basis and range
                    const basis = result.dateBasisUsed || 'order_date'
                    const params = new URLSearchParams({
                      basis,
                      startDate: result.dateRange!.min,
                      endDate: result.dateRange!.max,
                    })
                    router.push(`/sales?${params.toString()}`)
                  }}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  ดูรายการคำสั่งซื้อ
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
