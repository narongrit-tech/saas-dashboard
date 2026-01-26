'use client'

/**
 * Performance Ads Import Dialog
 *
 * Purpose: Import performance ads (Product/Live) with sales metrics
 * - File upload with preview
 * - Campaign type selector (Product/Live)
 * - Daily breakdown display
 * - Creates ad_daily_performance + wallet_ledger entries
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, TrendingUp, Wand2 } from 'lucide-react'
import {
  parsePerformanceAdsFile,
  importPerformanceAdsToSystem,
} from '@/app/(dashboard)/wallets/performance-ads-import-actions'
import { ManualMappingWizard } from './ManualMappingWizard'
import * as XLSX from 'xlsx'

interface PerformanceAdsImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  adsWalletId: string
  onImportSuccess: () => void
}

interface PreviewData {
  fileName: string
  campaignType: 'product' | 'live'
  reportType?: 'product' | 'live' | 'unknown'
  reportDateRange: string
  totalSpend: number
  totalGMV: number
  totalOrders: number
  avgROAS: number
  currency: string
  rowCount: number
  daysCount: number
  detectedColumns?: {
    date: string | null
    campaign: string | null
    cost: string | null
    gmv: string | null
    orders: string | null
    roas: string | null
    currency: string | null
  }
  missingOptionalColumns?: string[]
}

export function PerformanceAdsImportDialog({
  open,
  onOpenChange,
  adsWalletId,
  onImportSuccess,
}: PerformanceAdsImportDialogProps) {
  const [campaignType, setCampaignType] = useState<'product' | 'live'>('product')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [success, setSuccess] = useState<string | null>(null)

  // Manual mapping wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [excelHeaders, setExcelHeaders] = useState<string[]>([])

  const handleCampaignTypeChange = (type: string) => {
    setCampaignType(type as 'product' | 'live')
    // Reset file selection when changing type
    setSelectedFile(null)
    setFileBuffer(null)
    setPreview(null)
    setError(null)
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setPreview(null)
    setError(null)
    setWarnings([])
    setSuccess(null)
    setExcelHeaders([])
    setLoading(true)

    try {
      // Read file as ArrayBuffer
      const buffer = await file.arrayBuffer()
      setFileBuffer(buffer)

      // Try to parse and validate
      const result = await parsePerformanceAdsFile(buffer, file.name, campaignType)

      if (!result.success) {
        // Extract Excel headers for manual mapping fallback
        try {
          const workbook = XLSX.read(buffer, { type: 'array' })
          const sheetName = workbook.SheetNames[0]
          if (sheetName) {
            const worksheet = workbook.Sheets[sheetName]
            const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null }) as Record<
              string,
              unknown
            >[]
            if (rows.length > 0) {
              const headers = Object.keys(rows[0])
              setExcelHeaders(headers)
            }
          }
        } catch (parseErr) {
          console.error('Error extracting headers:', parseErr)
        }

        setError(result.error || 'ไม่สามารถอ่านไฟล์ได้')
        // Keep file and buffer for manual mapping
        return
      }

      if (result.preview) {
        setPreview(result.preview)
        setWarnings(result.warnings || [])
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
    setWarnings([])
    setSuccess(null)

    try {
      const result = await importPerformanceAdsToSystem(
        fileBuffer,
        selectedFile.name,
        campaignType,
        adsWalletId
      )

      if (!result.success) {
        setError(result.error || 'ไม่สามารถ import ได้')
        return
      }

      const data = result.data as {
        performanceRecords: number
        walletEntries: number
        totalSpend: number
        totalGMV: number
        avgROAS: number
        daysCount: number
      }

      setSuccess(
        `✅ Import สำเร็จ - ${data.daysCount} วัน, ${data.performanceRecords} records, ROAS: ${data.avgROAS.toFixed(2)}`
      )

      // Reset and close after success
      setTimeout(() => {
        handleClose()
        onImportSuccess()
      }, 2500)
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
    setWarnings([])
    setSuccess(null)
    setCampaignType('product')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Import Performance Ads (Product / Live)
          </DialogTitle>
          <DialogDescription>
            Import performance ads with sales metrics (GMV, Orders, ROAS).
            <br />
            <strong>หมายเหตุ:</strong> ไฟล์ต้องมี sales metrics - ถ้าเป็น Awareness Ads
            ให้ใช้ Tiger Import
          </DialogDescription>
        </DialogHeader>

        <Tabs value={campaignType} onValueChange={handleCampaignTypeChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="product">Product Ads (Daily)</TabsTrigger>
            <TabsTrigger value="live">Live Ads (Weekly)</TabsTrigger>
          </TabsList>

          <TabsContent value="product" className="space-y-4 pt-4">
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              <strong>Product Ads:</strong> สินค้า/Creative campaigns - นำเข้ารายวันหรือหลายวัน
            </div>
          </TabsContent>

          <TabsContent value="live" className="space-y-4 pt-4">
            <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-900">
              <strong>Live Ads:</strong> Livestream campaigns - นำเข้ารายสัปดาห์หรือหลายวัน
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-4">
          {/* File Upload */}
          <div className="space-y-2">
            <label htmlFor="perf-ads-file" className="text-sm font-medium">
              เลือกไฟล์ Performance Ads Report (.xlsx)
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="perf-ads-file"
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
                onClick={() => document.getElementById('perf-ads-file')?.click()}
              >
                <Upload className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ต้องมี columns: Date, Campaign, Cost/Spend, GMV, Orders
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
              <AlertDescription>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">{error}</div>
                  {excelHeaders.length > 0 && fileBuffer && selectedFile && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWizardOpen(true)}
                      className="shrink-0"
                    >
                      <Wand2 className="mr-2 h-4 w-4" />
                      Try Manual Mapping
                    </Button>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-green-500 bg-green-50 text-green-900">
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {/* Warnings Alert */}
          {warnings.length > 0 && !success && (
            <Alert className="border-yellow-500 bg-yellow-50 text-yellow-900">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription>
                <div className="space-y-1">
                  {warnings.map((warning, idx) => (
                    <div key={idx}>{warning}</div>
                  ))}
                </div>
              </AlertDescription>
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
                  <p className="font-medium break-all text-xs">{preview.fileName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Campaign Type:</p>
                  <p className="font-medium">
                    {preview.campaignType === 'product' ? 'Product (Daily)' : 'Live (Weekly)'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Report Date Range:</p>
                  <p className="font-medium text-xs">{preview.reportDateRange}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">จำนวนวัน:</p>
                  <p className="font-medium">{preview.daysCount} วัน</p>
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
                  <p className="text-muted-foreground">Total GMV:</p>
                  <p className="font-bold text-green-600">
                    {preview.totalGMV.toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    {preview.currency}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total Orders:</p>
                  <p className="font-medium">{preview.totalOrders.toLocaleString('th-TH')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg ROAS:</p>
                  <p
                    className={`font-bold ${preview.avgROAS >= 1 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {preview.avgROAS.toFixed(2)}x
                  </p>
                </div>
              </div>
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-900 text-xs">
                  <strong>การ Import จะสร้าง:</strong>
                  <br />- {preview.rowCount} ad_daily_performance records (daily breakdown)
                  <br />- {preview.daysCount} wallet SPEND entries (one per day)
                  <br />- เข้า Accrual P&L (Advertising Cost)
                </AlertDescription>
              </Alert>

              {/* Detected Columns Info */}
              {preview.detectedColumns && (
                <div className="rounded-lg bg-slate-100 p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-slate-700">
                    Columns ที่ตรวจพบ (Auto-detected):
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>
                      <span className="font-medium">Date:</span>{' '}
                      {preview.detectedColumns.date || '❌ Not found'}
                    </div>
                    <div>
                      <span className="font-medium">Campaign:</span>{' '}
                      {preview.detectedColumns.campaign || '❌ Not found'}
                    </div>
                    <div>
                      <span className="font-medium">Cost/Spend:</span>{' '}
                      {preview.detectedColumns.cost || '❌ Not found'}
                    </div>
                    <div>
                      <span className="font-medium">GMV:</span>{' '}
                      {preview.detectedColumns.gmv || '⚠️ Not found (using 0)'}
                    </div>
                    <div>
                      <span className="font-medium">Orders:</span>{' '}
                      {preview.detectedColumns.orders || '⚠️ Not found (using 0)'}
                    </div>
                    <div>
                      <span className="font-medium">ROAS:</span>{' '}
                      {preview.detectedColumns.roas || 'ℹ️ Calculated'}
                    </div>
                  </div>
                  {preview.reportType && preview.reportType !== 'unknown' && (
                    <div className="pt-2 border-t border-slate-300 text-xs">
                      <span className="font-medium">Report Type (Auto-detected):</span>{' '}
                      <span className="capitalize font-semibold">{preview.reportType}</span>
                    </div>
                  )}
                </div>
              )}
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

      {/* Manual Mapping Wizard */}
      {fileBuffer && selectedFile && excelHeaders.length > 0 && (
        <ManualMappingWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          adsWalletId={adsWalletId}
          fileBuffer={fileBuffer}
          fileName={selectedFile.name}
          excelHeaders={excelHeaders}
          onImportSuccess={() => {
            setWizardOpen(false)
            handleClose()
            onImportSuccess()
          }}
        />
      )}
    </Dialog>
  )
}
