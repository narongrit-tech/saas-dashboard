'use client'

/**
 * Performance Ads Import Dialog
 *
 * Purpose: Import performance ads (Product/Live) with sales metrics
 * - File upload with preview
 * - Campaign type selector (Product/Live)
 * - Report date picker (required)
 * - Daily breakdown display
 * - Creates ad_daily_performance + wallet_ledger entries
 */

import { useState, useEffect } from 'react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, TrendingUp, Wand2, ChevronDown, Calendar as CalendarIcon } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { getBangkokNow } from '@/lib/bangkok-time'
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
  campaignType?: 'product' | 'live' // Optional to match PerformanceAdsPreview (will be set by user selection)
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
  const [reportDate, setReportDate] = useState<Date | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [success, setSuccess] = useState<string | null>(null)
  const [autoDetected, setAutoDetected] = useState({ date: false, type: false })

  // Debug info state
  const [debugInfo, setDebugInfo] = useState<{
    selectedSheet: string | null
    headers: string[]
    mapping: {
      date: string | null
      campaign: string | null
      cost: string | null
      gmv: string | null
      orders: string | null
      roas: string | null
      currency: string | null
    }
    missingFields: string[]
  } | null>(null)

  // Manual mapping wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [excelHeaders, setExcelHeaders] = useState<string[]>([])

  // Auto-detect report date and ads type from filename
  useEffect(() => {
    if (!selectedFile) return

    const filename = selectedFile.name.toLowerCase()

    // Reset auto-detection state
    setAutoDetected({ date: false, type: false })

    // Try to extract date (e.g., "ads-2026-01-20.xlsx" or "20260120-ads.xlsx")
    const datePatterns = [
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{4})(\d{2})(\d{2})/, // YYYYMMDD
      /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
    ]

    for (const pattern of datePatterns) {
      const match = filename.match(pattern)
      if (match) {
        let year, month, day
        if (pattern.toString().includes('(\\d{4})-(\\d{2})-(\\d{2})')) {
          // YYYY-MM-DD
          ;[, year, month, day] = match
        } else if (pattern.toString().includes('(\\d{4})(\\d{2})(\\d{2})')) {
          // YYYYMMDD
          ;[, year, month, day] = match
        } else {
          // DD-MM-YYYY
          ;[, day, month, year] = match
        }

        const detectedDate = new Date(`${year}-${month}-${day}`)
        if (!isNaN(detectedDate.getTime())) {
          setReportDate(detectedDate)
          setAutoDetected(prev => ({ ...prev, date: true }))
          break
        }
      }
    }

    // Try to detect type
    if (filename.includes('live') || filename.includes('livestream')) {
      setCampaignType('live')
      setAutoDetected(prev => ({ ...prev, type: true }))
    } else if (filename.includes('product') || filename.includes('creative')) {
      setCampaignType('product')
      setAutoDetected(prev => ({ ...prev, type: true }))
    }
  }, [selectedFile])

  const handleCampaignTypeChange = (type: string) => {
    setCampaignType(type as 'product' | 'live')
    // Reset file selection when changing type
    setSelectedFile(null)
    setFileBuffer(null)
    setPreview(null)
    setError(null)
    setReportDate(null)
    setAutoDetected({ date: false, type: false })
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

    // Don't auto-preview yet - wait for user to fill reportDate and click Preview
    // Just read the file buffer and let auto-detection work
    try {
      const buffer = await file.arrayBuffer()
      setFileBuffer(buffer)
    } catch (err) {
      console.error('Error reading file:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์')
      setSelectedFile(null)
      setFileBuffer(null)
    }
  }

  const handlePreview = async () => {
    if (!fileBuffer || !selectedFile) {
      setError('กรุณาเลือกไฟล์')
      return
    }

    if (!reportDate) {
      setError('กรุณาเลือก Report Date')
      return
    }

    if (!campaignType) {
      setError('กรุณาเลือก Ads Type')
      return
    }

    setLoading(true)
    setError(null)
    setWarnings([])
    setSuccess(null)

    try {
      // Call parsePerformanceAdsFile with reportDate
      const result = await parsePerformanceAdsFile(
        fileBuffer,
        selectedFile.name,
        campaignType,
        format(reportDate, 'yyyy-MM-dd')
      )

      if (!result.success) {
        // Extract Excel headers for manual mapping fallback
        try {
          const workbook = XLSX.read(fileBuffer, { type: 'array' })
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

        // Store debug info if available
        if (result.debug) {
          setDebugInfo(result.debug)
        }

        setError(result.error || 'ไม่สามารถอ่านไฟล์ได้')
        return
      }

      if (result.preview) {
        setPreview(result.preview)
        setWarnings(result.warnings || [])
      }
    } catch (err) {
      console.error('Error parsing file:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!fileBuffer || !selectedFile || !preview || !reportDate) {
      setError('กรุณาเลือกไฟล์และ Report Date')
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
        adsWalletId,
        format(reportDate, 'yyyy-MM-dd')
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
    setDebugInfo(null)
    setCampaignType('product')
    setReportDate(null)
    setAutoDetected({ date: false, type: false })
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
          {/* Report Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              Report Date *
              {autoDetected.date && (
                <Badge variant="secondary" className="text-xs">
                  Auto-detected 🎯
                </Badge>
              )}
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                  disabled={loading}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {reportDate ? format(reportDate, 'dd MMM yyyy') : 'เลือกวันที่...'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={reportDate || undefined}
                  onSelect={(date) => {
                    setReportDate(date || null)
                    setAutoDetected(prev => ({ ...prev, date: false }))
                  }}
                  disabled={(date) => date > getBangkokNow()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              วันที่ของ report (ต้องไม่อนาคต)
            </p>
          </div>

          {/* Ads Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              Ads Type *
              {autoDetected.type && (
                <Badge variant="secondary" className="text-xs">
                  Auto-detected 🎯
                </Badge>
              )}
            </label>
            <Select
              value={campaignType}
              onValueChange={(value) => {
                setCampaignType(value as 'product' | 'live')
                setAutoDetected(prev => ({ ...prev, type: false }))
              }}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="เลือกประเภทโฆษณา..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="product">Product (Creative)</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ประเภทของโฆษณา (Product/Live)
            </p>
          </div>

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

          {/* Preview Button */}
          {selectedFile && !preview && !loading && (
            <Button
              onClick={handlePreview}
              disabled={!reportDate || !campaignType || loading}
              className="w-full"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Preview
            </Button>
          )}

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
                <div className="space-y-3">
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

                  {/* Debug Details Collapsible */}
                  {debugInfo && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
                          <ChevronDown className="h-4 w-4" />
                          🔍 Debug Details (คลิกเพื่อดูรายละเอียด)
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="rounded-md bg-slate-100 p-3 space-y-2 text-xs">
                          {/* Selected Sheet */}
                          <div>
                            <span className="font-semibold">Sheet ที่เลือก:</span>{' '}
                            {debugInfo.selectedSheet || 'N/A'}
                          </div>

                          {/* Headers Found */}
                          <div>
                            <span className="font-semibold">Headers ที่พบในไฟล์:</span>
                            <div className="mt-1 p-2 bg-white rounded border text-[10px] max-h-24 overflow-y-auto">
                              {debugInfo.headers.join(', ')}
                            </div>
                          </div>

                          {/* Column Mapping Result */}
                          <div>
                            <span className="font-semibold">Mapping Result:</span>
                            <div className="mt-1 space-y-1">
                              <div className={debugInfo.mapping.date ? 'text-green-600' : 'text-red-600'}>
                                • Date: {debugInfo.mapping.date || '❌ Not found'}
                              </div>
                              <div className={debugInfo.mapping.campaign ? 'text-green-600' : 'text-red-600'}>
                                • Campaign: {debugInfo.mapping.campaign || '❌ Not found'}
                              </div>
                              <div className={debugInfo.mapping.cost ? 'text-green-600' : 'text-red-600'}>
                                • Cost/Spend: {debugInfo.mapping.cost || '❌ Not found'}
                              </div>
                              <div className={debugInfo.mapping.gmv ? 'text-green-600' : 'text-yellow-600'}>
                                • GMV: {debugInfo.mapping.gmv || '⚠️ Not found'}
                              </div>
                              <div className={debugInfo.mapping.orders ? 'text-green-600' : 'text-yellow-600'}>
                                • Orders: {debugInfo.mapping.orders || '⚠️ Not found'}
                              </div>
                              <div className={debugInfo.mapping.roas ? 'text-green-600' : 'text-slate-500'}>
                                • ROAS: {debugInfo.mapping.roas || 'ℹ️ Will calculate'}
                              </div>
                            </div>
                          </div>

                          {/* Missing Required Fields */}
                          {debugInfo.missingFields.length > 0 && (
                            <div>
                              <span className="font-semibold text-red-600">Missing Required:</span>
                              <div className="mt-1 text-red-600">
                                {debugInfo.missingFields.join(', ')}
                              </div>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
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

              {/* Import Info Cards */}
              <div className="grid grid-cols-2 gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <p className="text-xs text-blue-700 font-medium">Import Date</p>
                  <p className="font-bold text-blue-900">
                    {reportDate ? format(reportDate, 'dd MMM yyyy') : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-700 font-medium">Ads Type</p>
                  <p className="font-bold text-blue-900">
                    {campaignType === 'product' ? 'Product (Creative)' : 'Live'}
                  </p>
                </div>
              </div>

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
