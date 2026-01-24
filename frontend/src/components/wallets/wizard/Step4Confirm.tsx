/**
 * Step 4: Confirm Import
 * Final summary + Save Preset checkbox
 */

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { AlertCircle } from 'lucide-react'
import type { PreviewResult, ReportType } from '@/types/manual-mapping'

interface Step4ConfirmProps {
  reportType: ReportType
  fileName: string
  preview: PreviewResult
  savePreset: boolean
  onSavePresetChange: (checked: boolean) => void
}

export function Step4Confirm({
  reportType,
  fileName,
  preview,
  savePreset,
  onSavePresetChange,
}: Step4ConfirmProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">Ready to Import</Label>
        <p className="text-sm text-muted-foreground mt-1">
          ตรวจสอบข้อมูลและ confirm การ import
        </p>
      </div>

      {/* Final Summary */}
      <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
        <h3 className="font-semibold text-sm">Import Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">ไฟล์:</span>
            <span className="font-medium text-xs break-all max-w-[60%] text-right">
              {fileName}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Report Type:</span>
            <span className="font-medium">
              {reportType === 'product'
                ? 'Product Ads'
                : reportType === 'live'
                  ? 'Live Ads'
                  : 'Tiger Awareness'}
            </span>
          </div>
          {preview.dateRange && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date Range:</span>
              <span className="font-medium text-xs">{preview.dateRange}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Spend:</span>
            <span className="font-bold text-red-600">
              {preview.totalSpend.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              THB
            </span>
          </div>
          {preview.totalRevenue !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total GMV:</span>
              <span className="font-bold text-green-600">
                {preview.totalRevenue.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                THB
              </span>
            </div>
          )}
          {preview.avgROAS !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg ROAS:</span>
              <span
                className={`font-bold ${preview.avgROAS >= 1 ? 'text-green-600' : 'text-red-600'}`}
              >
                {preview.avgROAS.toFixed(2)}x
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Records:</span>
            <span className="font-medium">{preview.recordCount} records</span>
          </div>
        </div>
      </div>

      {/* What will be created */}
      <Alert className="bg-blue-50 border-blue-200">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-900 text-sm">
          <strong>การ Import จะสร้าง:</strong>
          <br />
          {reportType === 'tiger' ? (
            <>
              - 1 wallet_ledger entry (SPEND, monthly total)
              <br />- เข้า Cashflow Summary ONLY
              <br />- ไม่มี ad_daily_performance records
              <br />- ไม่เข้า Accrual P&L
            </>
          ) : (
            <>
              - {preview.recordCount} ad_daily_performance records
              <br />- Multiple wallet_ledger entries (daily aggregated SPEND)
              <br />- เข้า Accrual P&L (Advertising Cost)
              <br />- เข้า Ads Analytics (ROI tracking)
            </>
          )}
        </AlertDescription>
      </Alert>

      {/* Save Preset Option */}
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
        <div className="flex items-start space-x-3">
          <Checkbox
            id="save-preset"
            checked={savePreset}
            onCheckedChange={(checked) => onSavePresetChange(checked === true)}
            className="mt-1"
          />
          <div className="flex-1">
            <Label htmlFor="save-preset" className="cursor-pointer font-medium text-green-900">
              บันทึก column mapping นี้เป็น preset
            </Label>
            <p className="text-xs text-green-700 mt-1">
              เมื่อ import ไฟล์ที่มีชื่อคล้ายกันในอนาคต ระบบจะนำ mapping นี้มาใช้อัตโนมัติ
              ทำให้ไม่ต้อง map ซ้ำ
            </p>
          </div>
        </div>
      </div>

      {/* Final confirmation alert */}
      <Alert className="bg-yellow-50 border-yellow-300">
        <AlertCircle className="h-4 w-4 text-yellow-600" />
        <AlertDescription className="text-yellow-900 text-sm">
          <strong>⚠️ กรุณาตรวจสอบก่อน confirm:</strong>
          <br />
          - ข้อมูล spend และ revenue ถูกต้อง
          <br />
          - Date range ตรงกับรายงาน
          <br />- ไฟล์นี้ยังไม่เคย import มาก่อน (จะถูกตรวจสอบอีกครั้ง)
        </AlertDescription>
      </Alert>
    </div>
  )
}
