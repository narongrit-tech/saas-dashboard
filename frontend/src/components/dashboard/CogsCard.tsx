'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Package } from 'lucide-react'
import { CogsDrilldownModal } from './CogsDrilldownModal'
import type { CogsBasis } from '@/app/(dashboard)/actions'

interface Props {
  amount: number
  cogsBasis: CogsBasis
  from: string
  to: string
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function CogsCard({ amount, cogsBasis, from, to }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow select-none"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            COGS {cogsBasis === 'created' ? '(Order Date)' : '(Shipped Date)'}
          </CardTitle>
          <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
            <Package className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">฿{fmt(amount)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {cogsBasis === 'shipped'
              ? 'ต้นทุนตามวันจัดส่ง (FIFO/AVG)'
              : 'ต้นทุนตามวันสร้างออเดอร์ · มุมมองวิเคราะห์'}
            {' · '}
            <span className="text-orange-500">คลิกดูรายละเอียด</span>
          </p>
        </CardContent>
      </Card>

      <CogsDrilldownModal
        open={open}
        from={from}
        to={to}
        cogsBasis={cogsBasis}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
