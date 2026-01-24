/**
 * Step 3: Preview Parsed Data
 * Shows server-validated preview with warnings/errors
 */

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { AlertCircle, CheckCircle, FileSpreadsheet } from 'lucide-react'
import type { PreviewResult, ReportType } from '@/types/manual-mapping'

interface Step3PreviewProps {
  reportType: ReportType
  preview: PreviewResult | null
  loading: boolean
}

export function Step3Preview({ reportType, preview, loading }: Step3PreviewProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <Alert>
          <FileSpreadsheet className="h-4 w-4" />
          <AlertDescription>กำลังอ่านไฟล์และ validate ข้อมูล...</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            กรุณากด "Generate Preview" เพื่อดูข้อมูลก่อน import
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const hasErrors = preview.errors.length > 0
  const hasWarnings = preview.warnings.length > 0

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">Preview Data</Label>
        <p className="text-sm text-muted-foreground mt-1">
          ตรวจสอบข้อมูลก่อน confirm import
        </p>
      </div>

      {/* Errors */}
      {hasErrors && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>❌ พบข้อผิดพลาด:</strong>
            <ul className="list-disc list-inside mt-2 space-y-1">
              {preview.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <Alert className="bg-yellow-50 border-yellow-300">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription>
            <strong>⚠️ คำเตือน:</strong>
            <ul className="list-disc list-inside mt-2 space-y-1 text-yellow-800">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Success indicator */}
      {!hasErrors && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-900">
            ✅ Validation ผ่าน - ข้อมูลพร้อม import
          </AlertDescription>
        </Alert>
      )}

      {/* Preview Summary */}
      <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Summary
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Report Type:</p>
            <p className="font-medium">
              {reportType === 'product'
                ? 'Product Ads (Daily)'
                : reportType === 'live'
                  ? 'Live Ads (Weekly)'
                  : 'Tiger Awareness (Monthly)'}
            </p>
          </div>
          {preview.dateRange && (
            <div>
              <p className="text-muted-foreground">Date Range:</p>
              <p className="font-medium text-xs">{preview.dateRange}</p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground">Total Spend:</p>
            <p className="font-bold text-red-600">
              {preview.totalSpend.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              THB
            </p>
          </div>
          {preview.totalRevenue !== undefined && (
            <div>
              <p className="text-muted-foreground">Total GMV:</p>
              <p className="font-bold text-green-600">
                {preview.totalRevenue.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                THB
              </p>
            </div>
          )}
          {preview.totalOrders !== undefined && (
            <div>
              <p className="text-muted-foreground">Total Orders:</p>
              <p className="font-medium">{preview.totalOrders.toLocaleString('th-TH')}</p>
            </div>
          )}
          {preview.avgROAS !== undefined && (
            <div>
              <p className="text-muted-foreground">Avg ROAS:</p>
              <p
                className={`font-bold ${preview.avgROAS >= 1 ? 'text-green-600' : 'text-red-600'}`}
              >
                {preview.avgROAS.toFixed(2)}x
              </p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground">Records to Create:</p>
            <p className="font-medium">{preview.recordCount} records</p>
          </div>
        </div>

        {/* Business Logic Info */}
        <Alert className="bg-blue-50 border-blue-200 mt-3">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900 text-xs">
            <strong>การ Import จะสร้าง:</strong>
            <br />
            {reportType === 'tiger' ? (
              <>
                - 1 wallet_ledger entry (monthly total)
                <br />- แสดงใน Cashflow Summary ONLY (ไม่เข้า P&L)
              </>
            ) : (
              <>
                - {preview.recordCount} ad_daily_performance records (daily breakdown)
                <br />- Multiple wallet_ledger entries (aggregated by day)
                <br />- เข้า Accrual P&L (Advertising Cost)
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>

      {/* Sample Rows */}
      {preview.sampleRows.length > 0 && (
        <div className="rounded-lg border bg-white p-4 space-y-2">
          <h3 className="font-semibold text-sm">Sample Data (First 5 Rows)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {reportType !== 'tiger' && <th className="text-left p-2">Date</th>}
                  <th className="text-left p-2">Campaign</th>
                  <th className="text-right p-2">Spend</th>
                  {reportType !== 'tiger' && (
                    <>
                      <th className="text-right p-2">Orders</th>
                      <th className="text-right p-2">GMV</th>
                      <th className="text-right p-2">ROAS</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row, index) => (
                  <tr key={index} className="border-b">
                    {reportType !== 'tiger' && <td className="p-2">{row.date}</td>}
                    <td className="p-2">{row.campaignName}</td>
                    <td className="text-right p-2">{row.spend.toFixed(2)}</td>
                    {reportType !== 'tiger' && (
                      <>
                        <td className="text-right p-2">{row.orders || 0}</td>
                        <td className="text-right p-2">{row.revenue?.toFixed(2) || '0.00'}</td>
                        <td className="text-right p-2">{row.roi?.toFixed(2) || '0.00'}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
