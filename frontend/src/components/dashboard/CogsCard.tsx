'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Package } from 'lucide-react'
import { CogsDrilldownModal } from './CogsDrilldownModal'
import type { CogsBasis, CogsInclude } from '@/app/(dashboard)/actions'
import type { ExpensePickerState } from '@/lib/expense-picker'
import { stateToUrlParams, getPickerParamKeys, isDefaultPickerState } from '@/lib/expense-picker'

interface Props {
  allocatedCogs: number
  cogsExpenses: number
  cogsExpState: ExpensePickerState
  cogsBasis: CogsBasis
  cogsInclude: CogsInclude
  from: string
  to: string
  allSearchParams: Record<string, string>
}

const INCLUDE_LABELS: Record<CogsInclude, string> = {
  both: 'รวม',
  allocated: 'SKU',
  expenses: 'Exp',
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function CogsCard({
  allocatedCogs,
  cogsExpenses,
  cogsExpState,
  cogsBasis,
  cogsInclude,
  from,
  to,
  allSearchParams,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [currentCogsExp, setCurrentCogsExp] = useState(cogsExpenses)
  const [currentCogsExpState, setCurrentCogsExpState] = useState<ExpensePickerState>(cogsExpState)
  const [currentInclude, setCurrentInclude] = useState<CogsInclude>(cogsInclude)

  const total = currentInclude === 'allocated' ? allocatedCogs
    : currentInclude === 'expenses' ? currentCogsExp
    : allocatedCogs + currentCogsExp
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

  const updateInclude = useCallback(
    (mode: CogsInclude) => {
      setCurrentInclude(mode)
      const params = new URLSearchParams()
      Object.entries(allSearchParams).forEach(([k, v]) => params.set(k, v))
      if (mode === 'both') {
        params.delete('cogsInclude')
      } else {
        params.set('cogsInclude', mode)
      }
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
        className="cursor-pointer hover:shadow-md hover:ring-1 hover:ring-orange-200 transition-all select-none"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            COGS {cogsBasis === 'created' ? '(Order Date)' : '(Shipped Date)'}
            {expFiltered ? ' \u270e' : ''}
          </CardTitle>
          <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-2 text-orange-600 dark:text-orange-400">
            <Package className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400 tracking-tight">฿{fmt(total)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {currentInclude === 'expenses'
              ? 'เฉพาะ COGS Expenses'
              : currentInclude === 'allocated'
              ? `เฉพาะ SKU ${cogsBasis === 'shipped' ? '(FIFO/AVG)' : '(Order Date)'}`
              : cogsBasis === 'shipped'
              ? 'ต้นทุนตามวันจัดส่ง (FIFO/AVG)'
              : 'ต้นทุนตามวันสร้างออเดอร์ · มุมมองวิเคราะห์'}
            {currentInclude === 'both' && currentCogsExp > 0 && (
              <span className="text-orange-500"> + Expenses</span>
            )}
          </p>
          <div
            className="flex gap-1 mt-2"
            onClick={e => e.stopPropagation()}
          >
            {(['both', 'allocated', 'expenses'] as CogsInclude[]).map(mode => (
              <button
                key={mode}
                onClick={() => updateInclude(mode)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  currentInclude === mode
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'border-orange-200 text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20'
                }`}
              >
                {INCLUDE_LABELS[mode]}
              </button>
            ))}
          </div>
          <p className="text-xs text-orange-500 mt-0.5">คลิกดูรายละเอียด →</p>
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
