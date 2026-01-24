'use client'

/**
 * Expenses Import Dialog
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
import { importExpensesToSystem } from '@/app/(dashboard)/expenses/expenses-import-actions'
import { ExpensesImportPreview, ParsedExpenseRow } from '@/types/expenses-import'
import { calculateFileHash, toPlain } from '@/lib/file-hash'
import { parseExpensesFile } from '@/lib/expenses-parser'

interface ExpensesImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type Step = 'upload' | 'preview' | 'importing' | 'result'

export function ExpensesImportDialog({ open, onOpenChange, onSuccess }: ExpensesImportDialogProps) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<ExpensesImportPreview | null>(null)
  const [parsedData, setParsedData] = useState<ParsedExpenseRow[]>([])
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

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
      const previewResult = await parseExpensesFile(buffer, selectedFile.name)

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
        summary: { totalAmount: 0, byCategory: { Advertising: 0, COGS: 0, Operating: 0 } },
        errors: [{ message: errorMessage, severity: 'error' }],
        warnings: [],
      })
      setStep('preview')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!file || !fileBuffer || !preview || !preview.success || parsedData.length === 0) {
      return
    }

    setStep('importing')
    setIsProcessing(true)

    try {
      // Calculate file hash (client-side)
      const fileHash = await calculateFileHash(fileBuffer)

      // Sanitize parsed data to plain objects (remove Date objects, etc.)
      const plainData = toPlain(parsedData)

      // Import to system using stored parsed data
      const importResult = await importExpensesToSystem(fileHash, file.name, plainData)

      if (importResult.success) {
        setResult({
          success: true,
          message: `Import สำเร็จ: ${importResult.inserted} รายการ${importResult.summary ? ` | จำนวนเงินรวม: ฿${importResult.summary.totalAmount.toLocaleString()}` : ''}`
        })
        onSuccess()
      } else {
        setResult({
          success: false,
          message: importResult.error || 'Import failed'
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

  const handleClose = () => {
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setPreview(null)
    setParsedData([])
    setResult(null)
    setIsProcessing(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Expenses</DialogTitle>
          <DialogDescription>
            Upload Standard Expense Template (.xlsx หรือ .csv)
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  รองรับ: .xlsx, .csv
                </p>
                <Input
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={handleFileSelect}
                  disabled={isProcessing}
                  className="max-w-sm mx-auto"
                />
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Required columns:</strong> Date, Category, Amount, Description
                <br />
                <strong>Category must be:</strong> Advertising, COGS, หรือ Operating
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
                <div className="text-sm text-muted-foreground">Total Amount</div>
                <div className="text-2xl font-bold">
                  ฿{preview.summary.totalAmount.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="border rounded-lg p-4">
              <div className="text-sm font-medium mb-2">Category Breakdown</div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Advertising:</span>
                  <span className="font-medium">฿{preview.summary.byCategory.Advertising.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>COGS:</span>
                  <span className="font-medium">฿{preview.summary.byCategory.COGS.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Operating:</span>
                  <span className="font-medium">฿{preview.summary.byCategory.Operating.toLocaleString()}</span>
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
                        <th className="px-4 py-2 text-left">Date</th>
                        <th className="px-4 py-2 text-left">Category</th>
                        <th className="px-4 py-2 text-left">Description</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-2">{row.expense_date}</td>
                          <td className="px-4 py-2">{row.category}</td>
                          <td className="px-4 py-2">{row.description}</td>
                          <td className="px-4 py-2 text-right">
                            ฿{row.amount.toLocaleString()}
                          </td>
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

        {/* Step 3: Importing */}
        {step === 'importing' && (
          <div className="text-center py-8">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Importing...</p>
            <p className="text-sm text-muted-foreground">กรุณารอสักครู่</p>
          </div>
        )}

        {/* Step 4: Result */}
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
