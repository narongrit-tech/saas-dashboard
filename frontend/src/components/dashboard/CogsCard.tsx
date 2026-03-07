'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Package } from 'lucide-react'
import { CogsDrilldownModal } from './CogsDrilldownModal'
import type { CogsBasis } from '@/app/(dashboard)/actions'
import type { ExpensePickerState } from '@/lib/expense-picker'
import { stateToUrlParams, getPickerParamKeys, isDefaultPickerState } from '@/lib/expense-picker'

interface Props {
  allocatedCogs: number
  cogsExpenses: number
  cogsExpState: ExpensePickerState
  cogsBasis: CogsBasis
  from: string
  to: string
  allSearchParams: Record<string, string>
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function CogsCard({
  allocatedCogs,
  cogsExpenses,
  cogsExpState,
  cogsBasis,
  from,
  to,
  allSearchParams,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [currentCogsExp, setCurrentCogsExp] = useState(cogsExpenses)
  const [currentCogsExpState, setCurrentCogsExpState] = useState<ExpensePickerState>(cogsExpState)

  const total = allocatedCogs + currentCogsExp
  const expFiltered = !isDefaultPickerState(currentCogsExpState, 'COGS')

  const updateUrl = useCallback(
    (newState: ExpensePickerState) => {
      const params = new URLSearchParams()
      const remove = new Set(getPickerParamKeys('cogsExp'))
      Object.entries(allSearchParams).forEach(([k, v]) => {
        if (!remove.has(k)) params.set(k, v)
      })
      Object.entries(stateToUrlParams(newState, 'cogsExp', 'COGS')).forEach(([k, v]) => {
        params.set(k, v)
      })
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [allSearchParams, router],
  )

  const handleApply = (newState: ExpensePickerState, newTotal: number) => {
    setCurrentCogsExp(newTotal)
    setCurrentCogsExpState(newState)
    setOpen(false)
    updateUrl(newState)
  }

  return (
    <>
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow select-none"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            COGS {cogsBasis === 'created' ? '(Order Date)' : '(Shipped Date)'}
            {expFiltered ? ' \u270e' : ''}
          </CardTitle>
          <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
            <Package className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">฿{fmt(total)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {cogsBasis === 'shipped'
              ? 'ต้นทุนตามวันจัดส่ง (FIFO/AVG)'
              : 'ต้นทุนตามวันสร้างออเดอร์ · มุมมองวิเคราะห์'}
            {currentCogsExp > 0 && (
              <span className="text-orange-500"> + Expenses</span>
            )}
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
        initialCogsExpState={currentCogsExpState}
        onApply={handleApply}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
