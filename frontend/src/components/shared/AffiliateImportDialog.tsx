'use client'

/**
 * Affiliate Import Dialog
 * Phase: Profit Reports (D1 Suite)
 *
 * 3-step wizard:
 * 1. Upload - Select CSV/Excel file
 * 2. Preview - Show matched/orphan count + sample rows
 * 3. Result - Display import results
 */

import { useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { MAX_IMPORT_FILE_SIZE_BYTES, MAX_IMPORT_FILE_SIZE_LABEL, REJECTED_MIME_RE } from '@/lib/import-constraints'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Info } from 'lucide-react'
import {
  parseAffiliateImportFile,
  importAffiliateAttributions
} from '@/app/(dashboard)/reports/profit/affiliate-import-actions'
import { AffiliateImportPreview } from '@/types/profit-reports'
import { calculateFileHash } from '@/lib/file-hash'
import * as XLSX from 'xlsx'

interface AffiliateImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type Step = 'upload' | 'preview' | 'importing' | 'result'

export function AffiliateImportDialog({ open, onOpenChange, onSuccess }: AffiliateImportDialogProps) {
  const [step, setStep] = useState<Step>('upload')
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<AffiliateImportPreview | null>(null)
  const [parsedDataJson, setParsedDataJson] = useState<string>('')
  const [result, setResult] = useState<{
    success: boolean
    message: string
    errorDetails?: {
      code?: string | null
      details?: string | null
      hint?: string | null
      status?: number | null
      samplePayloadKeys?: string[]
    }
    // Re-import support
    isDuplicate?: boolean
    existingBatchDate?: string
  } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // ============================================
  // STEP 1: UPLOAD & PARSE FILE
  // ============================================

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
      const parsedData = await parseFile(buffer, selectedFile.name)

      if (parsedData.length === 0) {
        setPreview({
          success: false,
          totalRows: 0,
          matchedCount: 0,
          orphanCount: 0,
          sampleRows: [],
          summary: { totalCommission: 0, channelCount: 0 },
          errors: [{ message: 'No data found in file', severity: 'error' }],
          warnings: []
        })
        setStep('preview')
        setIsProcessing(false)
        return
      }

      // Calculate file hash
      const fileHash = await calculateFileHash(buffer)

      // Store parsed data as JSON string
      const dataJson = JSON.stringify(parsedData)
      setParsedDataJson(dataJson)

      // Send to server for preview (match/orphan detection)
      const previewResult = await parseAffiliateImportFile(fileHash, selectedFile.name, dataJson)

      setPreview(previewResult)
      setStep('preview')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setPreview({
        success: false,
        totalRows: 0,
        matchedCount: 0,
        orphanCount: 0,
        sampleRows: [],
        summary: { totalCommission: 0, channelCount: 0 },
        errors: [{ message: errorMessage, severity: 'error' }],
        warnings: []
      })
      setStep('preview')
    } finally {
      setIsProcessing(false)
    }
  }

  /**
   * Parse CSV/Excel file (client-side)
   * Returns 2D array (array of arrays) for server-side processing
   */
  const parseFile = async (buffer: ArrayBuffer, fileName: string): Promise<any[][]> => {
    const extension = fileName.split('.').pop()?.toLowerCase()

    if (extension === 'csv') {
      // Parse CSV as 2D array
      const text = new TextDecoder('utf-8').decode(buffer)
      const workbook = XLSX.read(text, { type: 'string' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      return XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][]
    } else if (extension === 'xlsx' || extension === 'xls') {
      // Parse Excel as 2D array
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      return XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][]
    } else {
      throw new Error('Unsupported file format. Please upload .csv or .xlsx file.')
    }
  }

  // ============================================
  // STEP 2: CONFIRM IMPORT
  // ============================================

  const handleConfirmImport = async (allowReimport: boolean = false) => {
    if (!file || !fileBuffer || !preview || !preview.success) {
      return
    }

    setStep('importing')
    setIsProcessing(true)

    try {
      // Calculate file hash (again for import)
      const fileHash = await calculateFileHash(fileBuffer)

      // Import to system
      const mapping = preview.mapping || {}
      const mappingType = preview.autoMapped ? 'tiktok_affiliate_th' : 'custom'

      // CRITICAL: All parameters must be JSON-serializable for Server Actions
      // - Stringify all objects
      // - Convert undefined to null (Server Actions don't support undefined)
      const mappingJson = JSON.stringify(mapping)

      // DEFENSIVE: Ensure normalizedPayload is serializable
      // Pass normalized payload from Preview to Import
      let normalizedPayloadJson: string | null = null
      if (preview.normalizedPayload) {
        try {
          // Deep clone to remove any non-serializable objects
          const cloned = JSON.parse(JSON.stringify(preview.normalizedPayload))
          normalizedPayloadJson = JSON.stringify(cloned)
        } catch (serializeError) {
          console.error('[AffiliateImport] Failed to serialize normalizedPayload:', serializeError)
          // Fallback: pass null (server will re-compute)
          normalizedPayloadJson = null
        }
      }

      // CRITICAL FIX: Ensure all string parameters are plain strings (not String objects)
      const fileHashPlain = String(fileHash)
      const fileNamePlain = String(file.name)
      const parsedDataJsonPlain = String(parsedDataJson)
      const mappingJsonPlain = String(mappingJson)
      const mappingTypePlain = String(mappingType)
      const normalizedPayloadJsonPlain = normalizedPayloadJson ? String(normalizedPayloadJson) : null
      const allowReimportPlain = Boolean(allowReimport)

      const importResult = await importAffiliateAttributions(
        fileHashPlain,
        fileNamePlain,
        parsedDataJsonPlain,
        mappingJsonPlain,
        mappingTypePlain,
        normalizedPayloadJsonPlain,
        allowReimportPlain
      )

      if (importResult.success) {
        setResult({
          success: true,
          message: `Import สำเร็จ: ${importResult.insertedCount} รายการ${importResult.orphanCount > 0 ? ` | ${importResult.orphanCount} orphans (order not found)` : ''}${allowReimport ? ' (Re-import: อัปเดตข้อมูลเดิม)' : ''}`
        })
        onSuccess()
      } else {
        // Check if it's a duplicate file error
        const isDuplicate = importResult.existingBatchId !== undefined

        setResult({
          success: false,
          message: importResult.error || 'Import failed',
          errorDetails: importResult.errorDetails,
          isDuplicate,
          existingBatchDate: importResult.existingBatchDate
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
      setStep('result')
    }
  }

  // ============================================
  // STEP 2B: HANDLE RE-IMPORT
  // ============================================

  const handleReimport = () => {
    // Go back to preview step and set flag to allow reimport
    setResult(null)
    setStep('preview')
  }

  const handleConfirmReimport = async () => {
    // Call import with allowReimport=true
    await handleConfirmImport(true)
  }

  // ============================================
  // HANDLERS
  // ============================================

  const handleClose = () => {
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setPreview(null)
    setParsedDataJson('')
    setResult(null)
    setIsProcessing(false)
    onOpenChange(false)
  }

  const handleBack = () => {
    setStep('upload')
  }

  // ============================================
  // RENDER
  // ============================================

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Affiliate Sales Report</DialogTitle>
          <DialogDescription>
            Upload CSV/Excel file with affiliate attributions
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: UPLOAD */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4">
                Select CSV or Excel file (.csv, .xlsx)
              </p>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="max-w-xs mx-auto"
              />
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Required columns: <strong>order_id</strong>, <strong>affiliate_channel_id</strong>, <strong>commission_amt</strong>
                <br />
                Optional: commission_pct, attribution_type (internal_affiliate/external_affiliate)
              </AlertDescription>
            </Alert>

            {isProcessing && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span>Processing file...</span>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: PREVIEW */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 border rounded-lg">
                <div className="text-2xl font-bold">{preview.totalRows}</div>
                <div className="text-sm text-muted-foreground">Total Rows</div>
              </div>
              <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-950">
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                  {preview.matchedCount}
                </div>
                <div className="text-sm text-muted-foreground">Matched Orders</div>
              </div>
              <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-950">
                <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                  {preview.orphanCount}
                </div>
                <div className="text-sm text-muted-foreground">Orphan Orders</div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-2xl font-bold">
                  ฿{preview.summary.totalCommission.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Total Commission</div>
              </div>
            </div>

            {/* Orphan Warning */}
            {preview.orphanCount > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>{preview.orphanCount} orders</strong> not found in sales_orders. These will be skipped (no new orders will be created).
                </AlertDescription>
              </Alert>
            )}

            {/* Errors */}
            {preview.errors && preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Errors found:</strong>
                  <ul className="list-disc list-inside mt-2">
                    {preview.errors.slice(0, 5).map((error, idx) => (
                      <li key={idx}>
                        {error.row && `Row ${error.row}: `}
                        {error.message}
                      </li>
                    ))}
                    {preview.errors.length > 5 && (
                      <li>... and {preview.errors.length - 5} more errors</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Sample Rows */}
            <div>
              <h4 className="font-semibold mb-2">Sample Rows (first 5)</h4>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Channel ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead>%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sampleRows.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{row.order_id}</TableCell>
                        <TableCell>{row.affiliate_channel_id}</TableCell>
                        <TableCell>
                          <span
                            className={
                              row.attribution_type === 'internal_affiliate'
                                ? 'text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded'
                                : 'text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded'
                            }
                          >
                            {row.attribution_type}
                          </span>
                        </TableCell>
                        <TableCell>฿{row.commission_amt.toLocaleString()}</TableCell>
                        <TableCell>{row.commission_pct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button
                onClick={() => handleConfirmImport()}
                disabled={!preview.success || preview.matchedCount === 0}
              >
                {preview.matchedCount === 0
                  ? 'No orders to import'
                  : `Import ${preview.matchedCount} attributions`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: IMPORTING */}
        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-12 h-12 animate-spin mb-4" />
            <p className="text-lg font-medium">Importing affiliate attributions...</p>
            <p className="text-sm text-muted-foreground">Please wait</p>
          </div>
        )}

        {/* STEP 4: RESULT */}
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

            {/* Re-import Option (if duplicate file) */}
            {!result.success && result.isDuplicate && (
              <Alert className="border-orange-200 bg-orange-50">
                <Info className="h-4 w-4 text-orange-600" />
                <AlertDescription>
                  <div className="text-orange-900">
                    <p className="font-medium mb-2">ไฟล์นี้เคย import ไปแล้ว</p>
                    <p className="text-sm mb-3">
                      คุณสามารถ <strong>Re-import</strong> เพื่ออัปเดตข้อมูล commission ใหม่ (UPSERT: อัปเดต rows เดิม)
                    </p>
                    {result.existingBatchDate && (
                      <p className="text-xs text-orange-700">
                        Import ครั้งก่อน: {new Date(result.existingBatchDate).toLocaleDateString('th-TH', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Rich Error Details (if error and not duplicate) */}
            {!result.success && !result.isDuplicate && result.errorDetails && (
              <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
                <div className="font-semibold text-red-900">Debug Information:</div>

                {result.errorDetails.code && (
                  <div>
                    <span className="font-medium text-red-800">Error Code:</span>{' '}
                    <code className="rounded bg-red-100 px-1.5 py-0.5 text-red-900">
                      {result.errorDetails.code}
                    </code>
                  </div>
                )}

                {result.errorDetails.details && (
                  <div>
                    <span className="font-medium text-red-800">Details:</span>{' '}
                    <div className="mt-1 max-h-20 overflow-y-auto rounded bg-red-100 p-2 text-xs text-red-900">
                      {result.errorDetails.details.length > 300
                        ? result.errorDetails.details.substring(0, 300) + '...'
                        : result.errorDetails.details}
                    </div>
                  </div>
                )}

                {result.errorDetails.hint && (
                  <div>
                    <span className="font-medium text-red-800">Hint:</span>{' '}
                    <div className="mt-1 rounded bg-yellow-50 p-2 text-xs text-yellow-900">
                      {result.errorDetails.hint.length > 300
                        ? result.errorDetails.hint.substring(0, 300) + '...'
                        : result.errorDetails.hint}
                    </div>
                  </div>
                )}

                {result.errorDetails.samplePayloadKeys && result.errorDetails.samplePayloadKeys.length > 0 && (
                  <div>
                    <span className="font-medium text-red-800">Payload Columns:</span>{' '}
                    <code className="mt-1 block rounded bg-red-100 p-2 text-xs text-red-900">
                      {result.errorDetails.samplePayloadKeys.join(', ')}
                    </code>
                  </div>
                )}

                {/* Copy Debug Info Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const debugInfo = JSON.stringify(result.errorDetails, null, 2)
                    navigator.clipboard.writeText(debugInfo)
                    // Optional: show toast notification
                  }}
                  className="w-full"
                >
                  📋 Copy Debug Info
                </Button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between gap-2">
              {!result.success && result.isDuplicate ? (
                <>
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleConfirmReimport} className="bg-orange-600 hover:bg-orange-700">
                    🔄 Re-import (อัปเดตข้อมูลเดิม)
                  </Button>
                </>
              ) : (
                <Button onClick={handleClose} className="ml-auto">
                  Close
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
