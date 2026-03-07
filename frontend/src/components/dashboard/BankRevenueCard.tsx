'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Landmark } from 'lucide-react'
import { BankInflowPickerModal } from './BankInflowPickerModal'
import type { BankInflowRevenueTotals } from '@/app/(dashboard)/actions'

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props {
  initialTotal: number
  initialBreakdown: BankInflowRevenueTotals
  from: string
  to: string
}

export function BankRevenueCard({ initialTotal, initialBreakdown, from, to }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState(initialTotal)
  const [breakdown, setBreakdown] = useState<BankInflowRevenueTotals>(initialBreakdown)

  const handleDone = (totals: BankInflowRevenueTotals) => {
    setTotal(totals.total)
    setBreakdown(totals)
    setOpen(false)
    router.refresh()
  }

  const hasSelection = total > 0

  return (
    <>
      <Card
        className="cursor-pointer hover:shadow-md hover:ring-1 hover:ring-emerald-200 transition-all select-none"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Bank Inflows (Selected){hasSelection ? ' \u270e' : ''}
          </CardTitle>
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-2 text-emerald-600 dark:text-emerald-400">
            <Landmark className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">฿{fmt(total)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {hasSelection
              ? `TikTok ฿${fmt(breakdown.tiktok)} · Shopee ฿${fmt(breakdown.shopee)} · Other ฿${fmt(breakdown.other)}`
              : 'ยังไม่มีรายการที่เลือก'}
          </p>
          {!hasSelection && (
            <p className="text-xs text-emerald-600 mt-0.5">คลิกเพื่อเลือกรายการ →</p>
          )}
        </CardContent>
      </Card>

      <BankInflowPickerModal
        open={open}
        from={from}
        to={to}
        onDone={handleDone}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}
