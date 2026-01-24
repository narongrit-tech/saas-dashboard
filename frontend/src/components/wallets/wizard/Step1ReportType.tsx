/**
 * Step 1: Report Type Selection
 * User selects Product / Live / Tiger report type
 */

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { AlertCircle, TrendingUp, Megaphone } from 'lucide-react'
import type { ReportType } from '@/types/manual-mapping'

interface Step1ReportTypeProps {
  selectedType: ReportType | null
  onTypeChange: (type: ReportType) => void
}

export function Step1ReportType({ selectedType, onTypeChange }: Step1ReportTypeProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">เลือกประเภทรายงาน</Label>
        <p className="text-sm text-muted-foreground mt-1">
          เลือกประเภทของ ads report ที่คุณต้องการ import
        </p>
      </div>

      <RadioGroup value={selectedType || ''} onValueChange={(val) => onTypeChange(val as ReportType)}>
        <div className="space-y-3">
          {/* Product Ads */}
          <div
            className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              selectedType === 'product'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300'
            }`}
            onClick={() => onTypeChange('product')}
          >
            <RadioGroupItem value="product" id="product" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="product" className="cursor-pointer flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                <span className="font-semibold">Product Ads (Daily)</span>
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                สินค้า/Creative campaigns - มี sales metrics (GMV, Orders, ROAS)
              </p>
              <div className="text-xs text-blue-600 mt-1">
                ✓ สร้าง ad_daily_performance + wallet_ledger
                <br />✓ เข้า Accrual P&L (Advertising Cost)
              </div>
            </div>
          </div>

          {/* Live Ads */}
          <div
            className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              selectedType === 'live'
                ? 'border-purple-500 bg-purple-50'
                : 'border-gray-200 hover:border-purple-300'
            }`}
            onClick={() => onTypeChange('live')}
          >
            <RadioGroupItem value="live" id="live" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="live" className="cursor-pointer flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-purple-600" />
                <span className="font-semibold">Live Ads (Weekly)</span>
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                Livestream campaigns - มี sales metrics (GMV, Orders, ROAS)
              </p>
              <div className="text-xs text-purple-600 mt-1">
                ✓ สร้าง ad_daily_performance + wallet_ledger
                <br />✓ เข้า Accrual P&L (Advertising Cost)
              </div>
            </div>
          </div>

          {/* Tiger Awareness */}
          <div
            className={`flex items-start space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              selectedType === 'tiger'
                ? 'border-orange-500 bg-orange-50'
                : 'border-gray-200 hover:border-orange-300'
            }`}
            onClick={() => onTypeChange('tiger')}
          >
            <RadioGroupItem value="tiger" id="tiger" className="mt-1" />
            <div className="flex-1">
              <Label htmlFor="tiger" className="cursor-pointer flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-orange-600" />
                <span className="font-semibold">Tiger Awareness Ads (Monthly)</span>
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                Brand awareness campaigns - ไม่มี sales metrics (Reach/VDO View only)
              </p>
              <div className="text-xs text-orange-600 mt-1">
                ✓ สร้าง wallet_ledger ONLY (no performance records)
                <br />✓ ไม่เข้า P&L (cashflow tracking only)
              </div>
            </div>
          </div>
        </div>
      </RadioGroup>

      {/* Warning about changing type */}
      {selectedType && (
        <Alert className="bg-blue-50 border-blue-200">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900 text-sm">
            <strong>หมายเหตุ:</strong> หากเปลี่ยนประเภทรายงานหลังจาก map columns แล้ว
            การ mapping ทั้งหมดจะถูก reset
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
