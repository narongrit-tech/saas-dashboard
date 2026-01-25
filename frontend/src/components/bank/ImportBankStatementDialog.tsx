'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BankStatementPreview, BankColumnMapping } from '@/types/bank'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Upload, AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ImportBankStatementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  onSuccess: () => void
}

export default function ImportBankStatementDialog({
  open,
  onOpenChange,
  bankAccountId,
  onSuccess,
}: ImportBankStatementDialogProps) {
  const router = useRouter()
  const [step, setStep] = useState<'upload' | 'preview' | 'manual'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<BankStatementPreview | null>(null)
  const [availableColumns, setAvailableColumns] = useState<string[]>([])
  const [columnMapping, setColumnMapping] = useState<BankColumnMapping>({
    txn_date: '',
    description: '',
    withdrawal: '',
    deposit: '',
  })
  const [uploading, setUploading] = useState(false)
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(0)
  const [dataStartRowIndex, setDataStartRowIndex] = useState<number>(1)
  const [totalRows, setTotalRows] = useState<number>(0)
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const { toast} = useToast()

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
    }
  }

  async function handleUpload() {
    if (!file || !bankAccountId) return

    setUploading(true)
    const buffer = await file.arrayBuffer()
    setFileBuffer(buffer)

    try {
      // Try auto-parse via API
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bank_account_id', bankAccountId)

      const response = await fetch('/api/bank/preview', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (result.success && result.data) {
        setPreview(result.data)
        setStep('preview')
      } else if (result.requires_manual_mapping) {
        // Auto-parse failed, show manual mapping with header detection
        const colsResponse = await fetch('/api/bank/columns', {
          method: 'POST',
          body: formData,
        })

        const colsResult = await colsResponse.json()

        if (colsResult.success && colsResult.columns) {
          setAvailableColumns(colsResult.columns)
          setHeaderRowIndex(colsResult.header_row_index || 0)
          setDataStartRowIndex(colsResult.data_start_row_index || 1)
          setTotalRows(colsResult.total_rows || 0)
          setPreviewRows(colsResult.preview_rows || [])

          // Apply suggested mapping if available
          if (colsResult.suggested_mapping) {
            setColumnMapping({
              txn_date: colsResult.suggested_mapping.txn_date || '',
              description: colsResult.suggested_mapping.description || '',
              withdrawal: colsResult.suggested_mapping.withdrawal || '',
              deposit: colsResult.suggested_mapping.deposit || '',
              balance: colsResult.suggested_mapping.balance || '',
              channel: colsResult.suggested_mapping.channel || '',
              reference_id: colsResult.suggested_mapping.reference_id || '',
            })
          }

          setStep('manual')
        } else {
          toast({
            title: 'Error',
            description: colsResult.error || 'Failed to read file',
            variant: 'destructive',
          })
        }
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to parse file',
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Upload error:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }

    setUploading(false)
  }

  async function handleManualMapping() {
    if (!file || !bankAccountId) return

    // Validate mapping
    if (!validateMapping()) {
      // Validation errors already set by validateMapping()
      return
    }

    setUploading(true)

    try {
      // Preview with manual mapping via API
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bank_account_id', bankAccountId)
      formData.append('column_mapping', JSON.stringify(columnMapping))

      const response = await fetch('/api/bank/preview', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (result.success && result.data) {
        setPreview(result.data)
        setStep('preview')
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to parse file',
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Manual mapping error:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }

    setUploading(false)
  }

  async function handleRebuildPreview() {
    if (!file) return

    setUploading(true)

    try {
      // Rebuild column list with new header row index
      const formData = new FormData()
      formData.append('file', file)
      formData.append('header_row_index', headerRowIndex.toString())

      const colsResponse = await fetch('/api/bank/columns', {
        method: 'POST',
        body: formData,
      })

      const colsResult = await colsResponse.json()

      if (colsResult.success && colsResult.columns) {
        setAvailableColumns(colsResult.columns)
        setDataStartRowIndex(colsResult.data_start_row_index || headerRowIndex + 1)
        setPreviewRows(colsResult.preview_rows || [])

        // Apply suggested mapping if available
        if (colsResult.suggested_mapping) {
          setColumnMapping({
            txn_date: colsResult.suggested_mapping.txn_date || '',
            description: colsResult.suggested_mapping.description || '',
            withdrawal: colsResult.suggested_mapping.withdrawal || '',
            deposit: colsResult.suggested_mapping.deposit || '',
            balance: colsResult.suggested_mapping.balance || '',
            channel: colsResult.suggested_mapping.channel || '',
            reference_id: colsResult.suggested_mapping.reference_id || '',
          })
        }

        toast({
          title: 'Preview Rebuilt',
          description: `Detected ${colsResult.columns.length} columns from row ${headerRowIndex + 1}`,
        })
      } else {
        toast({
          title: 'Error',
          description: colsResult.error || 'Failed to rebuild preview',
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Rebuild preview error:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }

    setUploading(false)
  }

  function validateMapping(): boolean {
    const errors: string[] = []

    // Date column is required
    if (!columnMapping.txn_date) {
      errors.push('Date column is required')
    }

    // At least one of withdrawal or deposit is required
    if (!columnMapping.withdrawal && !columnMapping.deposit) {
      errors.push('At least one of Withdrawal or Deposit column must be selected')
    }

    // Description recommended
    if (!columnMapping.description) {
      errors.push('Description column is recommended for better tracking')
    }

    setValidationErrors(errors)
    return errors.length === 0
  }

  async function handleConfirmImport() {
    if (!file || !bankAccountId) return

    setUploading(true)

    try {
      // Execute import via API
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bank_account_id', bankAccountId)

      // Include column mapping if manual mapping was used
      if (step === 'manual') {
        formData.append('column_mapping', JSON.stringify(columnMapping))
        formData.append('header_row_index', String(headerRowIndex))
        formData.append('data_start_row_index', String(dataStartRowIndex))
      }

      const response = await fetch('/api/bank/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (result.success) {
        toast({
          title: 'Success',
          description: result.message || `Imported ${result.inserted_count} transactions`,
        })
        resetDialog()
        onSuccess()
        // Refresh all pages to show imported transactions
        router.refresh()
      } else {
        // Enhanced error message with diagnostics if available
        let errorMessage = result.error || 'Import failed'
        if (result.diagnostics) {
          const d = result.diagnostics
          errorMessage += `\n\nDiagnostics:\n- Total rows: ${d.totalRows}\n- Parsed: ${d.parsedRows}\n- Invalid dates: ${d.invalidDateCount}\n- Invalid amounts: ${d.invalidAmountCount}`

          if (d.sampleBadRows && d.sampleBadRows.length > 0) {
            errorMessage += `\n\nSample errors:\n${d.sampleBadRows.map((b: any) => `Row ${b.rowIndex + 1}: ${b.reason}`).join('\n')}`
          }
        }

        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        })
      }
    } catch (error) {
      console.error('Import error:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }

    setUploading(false)
  }

  function resetDialog() {
    setStep('upload')
    setFile(null)
    setFileBuffer(null)
    setPreview(null)
    setAvailableColumns([])
    setColumnMapping({
      txn_date: '',
      description: '',
      withdrawal: '',
      deposit: '',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={resetDialog}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Bank Statement</DialogTitle>
          <DialogDescription>
            Upload KBIZ, K PLUS, or generic CSV/Excel file
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="file">Select File</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
              />
              <p className="text-sm text-muted-foreground mt-1">
                Supported formats: .xlsx, .xls, .csv
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetDialog}>
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={!file || uploading}>
                {uploading ? 'Processing...' : 'Next'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'manual' && (
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Cannot auto-detect format. Please configure header row and map columns manually.
              </AlertDescription>
            </Alert>

            {/* Header Row Selection */}
            <div className="space-y-2 border-b pb-4">
              <h4 className="font-medium text-sm">Header Row Configuration</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Header Row (Row {headerRowIndex + 1})</Label>
                  <Input
                    type="number"
                    min={0}
                    max={Math.max(0, totalRows - 1)}
                    value={headerRowIndex}
                    onChange={(e) => setHeaderRowIndex(parseInt(e.target.value) || 0)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Row index containing column names (0-based)
                  </p>
                </div>
                <div>
                  <Label>Data Start Row (Row {dataStartRowIndex + 1})</Label>
                  <Input
                    type="number"
                    min={1}
                    max={totalRows}
                    value={dataStartRowIndex}
                    onChange={(e) => setDataStartRowIndex(parseInt(e.target.value) || 1)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    First row with actual data (usually header + 1)
                  </p>
                </div>
              </div>
              <Button onClick={handleRebuildPreview} disabled={uploading} size="sm">
                Rebuild Preview
              </Button>
            </div>

            {/* Preview Sample Rows */}
            {previewRows.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Sample Data (First {previewRows.length} rows)</h4>
                <div className="border rounded max-h-[200px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        {availableColumns.map((col, idx) => (
                          <th key={idx} className="px-2 py-1 text-left border-b font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, rowIdx) => (
                        <tr key={rowIdx} className="border-b">
                          {row.map((cell, cellIdx) => (
                            <td key={cellIdx} className="px-2 py-1 truncate max-w-[150px]" title={cell}>
                              {cell || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Column Mapping */}
            <div className="grid gap-4">
              <div>
                <Label>Date Column (required)</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={columnMapping.txn_date}
                  onChange={(e) => setColumnMapping({ ...columnMapping, txn_date: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Description Column (recommended)</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={columnMapping.description}
                  onChange={(e) => setColumnMapping({ ...columnMapping, description: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Withdrawal Column</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={columnMapping.withdrawal}
                  onChange={(e) => setColumnMapping({ ...columnMapping, withdrawal: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Deposit Column</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={columnMapping.deposit}
                  onChange={(e) => setColumnMapping({ ...columnMapping, deposit: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={handleManualMapping} disabled={uploading}>
                {uploading ? 'Processing...' : 'Preview'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="border p-3 rounded">
                <p className="text-sm text-muted-foreground">Date Range</p>
                <p className="font-semibold">
                  {preview.date_range.start} to {preview.date_range.end}
                </p>
              </div>
              <div className="border p-3 rounded">
                <p className="text-sm text-muted-foreground">Total Deposits</p>
                <p className="font-semibold text-green-600">
                  ฿{preview.total_deposits.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="border p-3 rounded">
                <p className="text-sm text-muted-foreground">Total Withdrawals</p>
                <p className="font-semibold text-red-600">
                  ฿{preview.total_withdrawals.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div>
              <p className="font-semibold mb-2">Preview (first 5 rows)</p>
              <div className="border rounded overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-right">Withdrawal</th>
                      <th className="px-3 py-2 text-right">Deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2">{row.txn_date}</td>
                        <td className="px-3 py-2">{row.description}</td>
                        <td className="px-3 py-2 text-right text-red-600">
                          {row.withdrawal > 0 ? row.withdrawal.toFixed(2) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-green-600">
                          {row.deposit > 0 ? row.deposit.toFixed(2) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={handleConfirmImport} disabled={uploading}>
                {uploading ? 'Importing...' : `Import ${preview.row_count} Transactions`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
