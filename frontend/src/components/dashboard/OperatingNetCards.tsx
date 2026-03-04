'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react'
import { OperatingPickerModal } from './OperatingPickerModal'

interface Props {
  initialOperating: number
  initialNetProfit: number
  gmv: number
  adSpend: number
  cogs: number
  from: string
  to: string
  /** Retained for API compatibility but no longer used for URL-based filtering. */
  initialSelectedSubcats: string[] | null
}

function fmt(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Renders the Operating card (clickable → expense-row picker modal) and
 * Net Profit card as a React Fragment so they slot naturally into the
 * parent summary grid.
 */
export function OperatingNetCards({
  initialOperating,
  initialNetProfit,
  gmv,
  adSpend,
  cogs,
  from,
  to,
}: Props) {
  const [currentOperating, setCurrentOperating] = useState(initialOperating)
  const [currentNetProfit, setCurrentNetProfit] = useState(initialNetProfit)
  const [isFiltered, setIsFiltered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const isProfit = currentNetProfit >= 0

  const handleApply = (newOperating: number, newNetProfit: number) => {
    setCurrentOperating(newOperating)
    setCurrentNetProfit(newNetProfit)
    // Mark as filtered only when Operating changed from initial value
    setIsFiltered(Math.abs(newOperating - initialOperating) > 0.001)
    setModalOpen(false)
  }

  return (
    <>
      {/* Operating Card — clickable */}
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow select-none"
        onClick={() => setModalOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Operating (ช่วงที่เลือก){isFiltered ? ' ✎' : ''}
          </CardTitle>
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
            <DollarSign className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">฿{fmt(currentOperating)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {isFiltered ? 'กรองแล้ว · คลิกเพื่อแก้ไขตัวกรอง' : 'ค่าดำเนินงาน · คลิกเพื่อเลือกรายการ'}
          </p>
        </CardContent>
      </Card>

      {/* Net Profit Card */}
      <Card className={isProfit ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Net Profit (ช่วงที่เลือก)</CardTitle>
          <div className={`rounded-lg p-2 ${isProfit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${isProfit ? 'text-green-700' : 'text-red-700'}`}>
            {isProfit ? '' : '-'}฿{fmt(Math.abs(currentNetProfit))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isProfit ? '✓ กำไร' : '✗ ขาดทุน'} · GMV - Ads - COGS - Operating
          </p>
        </CardContent>
      </Card>

      {/* Expense-row picker modal */}
      <OperatingPickerModal
        open={modalOpen}
        from={from}
        to={to}
        initialOperating={initialOperating}
        gmv={gmv}
        adSpend={adSpend}
        cogs={cogs}
        onApply={handleApply}
        onCancel={() => setModalOpen(false)}
      />
    </>
  )
}
