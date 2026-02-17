'use client'

import { useState } from 'react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  parseAndMatchCashInImport,
  applyCashInImport,
  CashInImportPreview,
} from '@/app/(dashboard)/bank/cash-in-actions'
import { CASH_IN_TYPE_LABELS } from '@/types/bank'
import { Upload, CheckCircle2, XCircle, AlertCircle, RefreshCw, Info } from 'lucide-react'

interface ImportCashInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function ImportCashInDialog({
  open,
  onOpenChange,
  onSuccess,
}: ImportCashInDialogProps) {
  const { toast } = useToast()

  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<CashInImportPreview | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setPreview(null)
  }

  async function handleUpload() {
    if (!selectedFile) return

    try {
      setUploading(true)

      const arrayBuffer = await selectedFile.arrayBuffer()
      const result = await parseAndMatchCashInImport(arrayBuffer)

      if (!result.success || !result.data) {
        toast({
          title: 'ข้อผิดพลาด',
          description: result.error || 'ไม่สามารถอ่านไฟล์ได้',
          variant: 'destructive',
        })
        return
      }

      setPreview(result.data)
    } catch (error) {
      console.error('Upload error:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการอ่านไฟล์',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirmImport() {
    if (!preview) return

    try {
      setApplying(true)

      const result = await applyCashInImport(preview.rows)

      if (!result.success) {
        toast({
          title: 'ข้อผิดพลาด',
          description: result.error || 'ไม่สามารถจัดประเภทได้',
          variant: 'destructive',
        })
        return
      }

      toast({
        title: 'สำเร็จ',
        description: result.message || `จัดประเภท ${result.updated_count} รายการสำเร็จ`,
      })

      // Close dialog and refresh
      onSuccess()
      handleClose()
    } catch (error) {
      console.error('Apply error:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
        variant: 'destructive',
      })
    } finally {
      setApplying(false)
    }
  }

  function handleClose() {
    setSelectedFile(null)
    setPreview(null)
    onOpenChange(false)
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'MATCHED':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'UNMATCHED':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'INVALID':
        return <AlertCircle className="h-4 w-4 text-orange-600" />
      case 'CONFLICT':
        return <RefreshCw className="h-4 w-4 text-yellow-600" />
      default:
        return null
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'MATCHED':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            MATCHED
          </Badge>
        )
      case 'UNMATCHED':
        return (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
            UNMATCHED
          </Badge>
        )
      case 'INVALID':
        return (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
            INVALID
          </Badge>
        )
      case 'CONFLICT':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
            CONFLICT
          </Badge>
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Cash In Classification</DialogTitle>
          <DialogDescription>
            อัปโหลดไฟล์ CSV/XLSX เพื่อจัดประเภทเงินเข้าแบบกลุ่ม
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">เลือกไฟล์</label>
            <div className="flex gap-2">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="flex-1 text-sm"
              />
              <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
                {uploading ? (
                  <>กำลังอ่านไฟล์...</>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    อ่านไฟล์
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <>
              {/* Summary */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <div className="grid grid-cols-5 gap-4 text-sm">
                    <div>
                      <strong>Total:</strong> {preview.total_rows} rows
                    </div>
                    <div>
                      <strong className="text-green-600">Matched:</strong> {preview.matched}
                    </div>
                    <div>
                      <strong className="text-red-600">Unmatched:</strong> {preview.unmatched}
                    </div>
                    <div>
                      <strong className="text-orange-600">Invalid:</strong> {preview.invalid}
                    </div>
                    <div>
                      <strong className="text-yellow-600">Conflicts:</strong> {preview.conflicts}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Preview Table */}
              <div className="border rounded-md max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead>Bank Account</TableHead>
                      <TableHead>DateTime</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reason / Current Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.row_index}>
                        <TableCell className="font-mono text-sm">{row.row_index}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(row.status)}
                            {getStatusBadge(row.status)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm truncate max-w-[150px]">
                          {row.input_data.bank_account}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.input_data.txn_datetime}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600">
                          {parseFloat(String(row.input_data.amount)).toLocaleString('th-TH', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">
                          {row.input_data.description}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline">
                            {CASH_IN_TYPE_LABELS[row.input_data.cash_in_type as keyof typeof CASH_IN_TYPE_LABELS] ||
                              row.input_data.cash_in_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.status === 'CONFLICT' && row.conflict_details ? (
                            <div>
                              <span className="text-muted-foreground">Current: </span>
                              <Badge variant="secondary" className="mr-2">
                                {CASH_IN_TYPE_LABELS[row.conflict_details.current_type as keyof typeof CASH_IN_TYPE_LABELS]}
                              </Badge>
                              <span className="text-muted-foreground">→ </span>
                              <Badge variant="outline">
                                {CASH_IN_TYPE_LABELS[row.conflict_details.new_type as keyof typeof CASH_IN_TYPE_LABELS]}
                              </Badge>
                            </div>
                          ) : row.reason ? (
                            <span className="text-muted-foreground">{row.reason}</span>
                          ) : row.current_cash_in_type ? (
                            <Badge variant="secondary">
                              {CASH_IN_TYPE_LABELS[row.current_cash_in_type as keyof typeof CASH_IN_TYPE_LABELS]}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                  จะอัปเดต {preview.matched} รายการ (Conflicts และ Invalid จะถูกข้าม)
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose} disabled={applying}>
                    ยกเลิก
                  </Button>
                  <Button
                    onClick={handleConfirmImport}
                    disabled={preview.matched === 0 || applying}
                  >
                    {applying ? 'กำลังอัปเดต...' : `Confirm Import (${preview.matched} rows)`}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Instructions */}
          {!preview && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>ดาวน์โหลด template ก่อนเพื่อดูรูปแบบไฟล์ที่ถูกต้อง</li>
                  <li>กรอกข้อมูลใน Excel/Sheets ตามคอลัมน์ที่กำหนด</li>
                  <li>บันทึกเป็นไฟล์ CSV หรือ XLSX</li>
                  <li>อัปโหลดไฟล์และตรวจสอบ preview ก่อน Confirm</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
