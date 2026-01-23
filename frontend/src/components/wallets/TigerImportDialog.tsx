'use client'

/**
 * Tiger Awareness Ads Import Dialog
 *
 * Purpose: Import monthly awareness ads (Tiger reports) into TikTok Ads Wallet
 * - File upload with preview
 * - Validation before import
 * - Shows: date range, total spend, campaign count
 * - Requires user confirmation
 */

import { useState } from 'react'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react'
import {
  parseTigerReportFile,
  importTigerReportToWallet,
} from '@/app/(dashboard)/wallets/tiger-import-actions'

interface TigerImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  adsWalletId: string
  onImportSuccess: () => void
}

interface PreviewData {
  fileName: string
  reportDateRange: string
  totalSpend: number
  currency: string
  rowCount: number
  campaignCount: number
  postingDate: string
}

export function TigerImportDialog({
  open,
  onOpenChange,
  adsWalletId,
  onImportSuccess,
}: TigerImportDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setPreview(null)
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      // Read file as ArrayBuffer
      const buffer = await file.arrayBuffer()
      setFileBuffer(buffer)

      // Parse and validate
      const result = await parseTigerReportFile(buffer, file.name)

      if (!result.success) {
        setError(result.error || 'ไม่สามารถอ่านไฟล์ได้')
        setSelectedFile(null)
        setFileBuffer(null)
        return
      }

      if (result.preview) {
        setPreview(result.preview)
      }
    } catch (err) {
      console.error('Error reading file:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์')
      setSelectedFile(null)
      setFileBuffer(null)
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!fileBuffer || !selectedFile || !preview) {
      setError('กรุณาเลือกไฟล์ก่อน')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await importTigerReportToWallet(
        fileBuffer,
        selectedFile.name,
        adsWalletId
      )

      if (!result.success) {
        setError(result.error || 'ไม่สามารถ import ได้')
        return
      }

      const data = result.data as {
        campaignCount: number
        totalSpend: number
        currency: string
      }
      setSuccess(
        `✅ Import สำเร็จ - ${data.campaignCount} campaigns, ยอดรวม ${data.totalSpend.toLocaleString('th-TH')} ${data.currency}`
      )

      // Reset and close after success
      setTimeout(() => {
        handleClose()
        onImportSuccess()
      }, 2000)
    } catch (err) {
      console.error('Error importing:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setSelectedFile(null)
    setFileBuffer(null)
    setPreview(null)
    setError(null)
    setSuccess(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Awareness Ads (Monthly - Tiger)</DialogTitle>
          <DialogDescription>
            Import monthly awareness campaign spend into TikTok Ads Wallet.
            <br />
            <strong>หมายเหตุ:</strong> ไฟล์ต้องเป็น Awareness Report เท่านั้น (ไม่มี GMV/Orders/ROAS)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload */}
          <div className="space-y-2">
            <label htmlFor="tiger-file" className="text-sm font-medium">
              เลือกไฟล์ Tiger Report (.xlsx)
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="tiger-file"
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                disabled={loading}
                className="cursor-pointer"
              />
              <Button
                variant="outline"
                size="icon"
                disabled={loading}
                onClick={() => document.getElementById('tiger-file')?.click()}
              >
                <Upload className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ชื่อไฟล์ต้องมี &quot;Tiger&quot; หรือ &quot;Campaign Report&quot; และมี date
              range ในรูปแบบ (YYYY-MM-DD to YYYY-MM-DD)
            </p>
          </div>

          {/* Loading State */}
          {loading && !preview && (
            <Alert>
              <FileSpreadsheet className="h-4 w-4" />
              <AlertDescription>กำลังอ่านไฟล์...</AlertDescription>
            </Alert>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-green-500 bg-green-50 text-green-900">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {/* Preview */}
          {preview && !success && (
            <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Preview - กรุณาตรวจสอบข้อมูลก่อน Confirm
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">ชื่อไฟล์:</p>
                  <p className="font-medium break-all">{preview.fileName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Report Date Range:</p>
                  <p className="font-medium">{preview.reportDateRange}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Spend:</p>
                  <p className="font-bold text-red-600">
                    {preview.totalSpend.toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {preview.currency}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Posting Date:</p>
                  <p className="font-medium">{preview.postingDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">จำนวน Campaigns:</p>
                  <p className="font-medium">{preview.campaignCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">จำนวนแถว:</p>
                  <p className="font-medium">{preview.rowCount}</p>
                </div>
              </div>
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <strong>การ Import จะสร้าง:</strong>
                  <br />- 1 รายการ Wallet SPEND (monthly aggregation)
                  <br />- ไม่เข้า Accrual P&L (เพราะเป็น awareness spend)
                  <br />- แสดงใน Cashflow Summary เท่านั้น
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            ยกเลิก
          </Button>
          <Button
            onClick={handleImport}
            disabled={!preview || loading || !!success}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? 'กำลัง Import...' : 'Confirm Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
