'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DollarSign, Receipt, TrendingUp, TrendingDown } from 'lucide-react'
import { ExpensePickerModal } from './ExpensePickerModal'
import {
  stateToUrlParams,
  getPickerParamKeys,
  isDefaultPickerState,
} from '@/lib/expense-picker'
import type { ExpensePickerState } from '@/lib/expense-picker'
import type { RevenueBasis } from '@/app/(dashboard)/actions'

interface Props {
  initialOp: number
  initialTax: number
  initialOpState: ExpensePickerState
  initialTaxState: ExpensePickerState
  gmv: number
  adSpend: number
  cogs: number
  from: string
  to: string
  revenueBasis?: RevenueBasis
  /** Snapshot of all current URL search params (for building updated URLs). */
  allSearchParams: Record<string, string>
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function OperatingNetCards({
  initialOp, initialTax,
  initialOpState, initialTaxState,
  gmv, adSpend, cogs,
  from, to,
  revenueBasis = 'gmv',
  allSearchParams,
}: Props) {
  const router = useRouter()

  const [currentOp, setCurrentOp] = useState(initialOp)
  const [currentTax, setCurrentTax] = useState(initialTax)
  const [opState, setOpState] = useState<ExpensePickerState>(initialOpState)
  const [taxState, setTaxState] = useState<ExpensePickerState>(initialTaxState)
  const [opOpen, setOpOpen] = useState(false)
  const [taxOpen, setTaxOpen] = useState(false)

  const netProfit = Math.round((gmv - adSpend - cogs - currentOp - currentTax) * 100) / 100
  const isProfit = netProfit >= 0

  /** Replace URL params for a given picker prefix without full navigation */
  const updateUrl = useCallback(
    (prefix: string, newState: ExpensePickerState, defaultCat: string) => {
      const params = new URLSearchParams()
      const remove = new Set(getPickerParamKeys(prefix))
      Object.entries(allSearchParams).forEach(([k, v]) => {
        if (!remove.has(k)) params.set(k, v)
      })
      Object.entries(stateToUrlParams(newState, prefix, defaultCat)).forEach(([k, v]) => {
        params.set(k, v)
      })
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [allSearchParams, router],
  )

  const handleOpApply = (newState: ExpensePickerState, newTotal: number) => {
    setCurrentOp(newTotal)
    setOpState(newState)
    setOpOpen(false)
    updateUrl('op', newState, 'ALL')
  }

  const handleTaxApply = (newState: ExpensePickerState, newTotal: number) => {
    setCurrentTax(newTotal)
    setTaxState(newState)
    setTaxOpen(false)
    updateUrl('tax', newState, 'Tax')
  }

  const opFiltered  = !isDefaultPickerState(opState, 'ALL')
  const taxFiltered = !isDefaultPickerState(taxState, 'Tax')

  return (
    <>
      {/* Operating Card (clickable) */}
      <Card
        className="cursor-pointer hover:shadow-md hover:ring-1 hover:ring-blue-200 transition-all select-none"
        onClick={() => setOpOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Operating (ช่วงที่เลือก){opFiltered ? ' \u270e' : ''}
          </CardTitle>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2 text-blue-600 dark:text-blue-400">
            <DollarSign className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 tracking-tight">฿{fmt(currentOp)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {opFiltered
              ? 'กรองแล้ว · คลิกเพื่อแก้ไขตัวกรอง'
              : 'รวมรายจ่ายที่เลือก (ทุกหมวด) · คลิกเพื่อกรอง'}
          </p>
        </CardContent>
      </Card>

      {/* Tax Card (clickable) */}
      <Card
        className="cursor-pointer hover:shadow-md hover:ring-1 hover:ring-rose-200 transition-all select-none"
        onClick={() => setTaxOpen(true)}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Tax (ช่วงที่เลือก){taxFiltered ? ' \u270e' : ''}
          </CardTitle>
          <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 p-2 text-rose-600 dark:text-rose-400">
            <Receipt className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight">฿{fmt(currentTax)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {taxFiltered
              ? 'กรองแล้ว · คลิกเพื่อแก้ไขตัวกรอง'
              : 'ค่าภาษี · คลิกเพื่อกรอง'}
          </p>
        </CardContent>
      </Card>

      {/* Net Profit Card — visually emphasized on desktop */}
      <Card className={[
        isProfit
          ? 'border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-900/15'
          : 'border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/15',
        'lg:shadow-md',
        isProfit
          ? 'lg:ring-1 lg:ring-green-300/50 dark:lg:ring-green-700/40'
          : 'lg:ring-1 lg:ring-red-300/50 dark:lg:ring-red-700/40',
      ].join(' ')}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 lg:pt-5 lg:px-5">
          <CardTitle className="text-sm font-semibold">
            {revenueBasis === 'cashin' ? 'Net Cash (Cash In)' : revenueBasis === 'bank' ? 'Net Cash (Bank Inflows)' : 'Net Profit (ช่วงที่เลือก)'}
          </CardTitle>
          <div className={`rounded-lg p-2 ${isProfit ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
            {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        <CardContent className="lg:px-5 lg:pb-5">
          <div className={`text-3xl lg:text-4xl font-bold tracking-tight ${isProfit ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            {isProfit ? '' : '-'}฿{fmt(Math.abs(netProfit))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isProfit ? '▲' : '▼'}{' '}
            {revenueBasis === 'cashin' ? 'Cash In - Ads - COGS - Op - Tax' : revenueBasis === 'bank' ? 'Bank Inflows - Ads - COGS - Op - Tax' : 'GMV - Ads - COGS - Op - Tax'}
          </p>
        </CardContent>
      </Card>

      {/* Operating Picker Modal */}
      <ExpensePickerModal
        open={opOpen}
        title="Operating — เลือกรายจ่ายที่นับรวม"
        from={from}
        to={to}
        initialState={opState}
        initialTotal={currentOp}
        otherTotal={currentTax}
        gmv={gmv}
        adSpend={adSpend}
        cogs={cogs}
        onApplyState={handleOpApply}
        onCancel={() => setOpOpen(false)}
      />

      {/* Tax Picker Modal */}
      <ExpensePickerModal
        open={taxOpen}
        title="Tax — เลือกรายจ่ายที่นับรวม"
        from={from}
        to={to}
        initialState={taxState}
        initialTotal={currentTax}
        otherTotal={currentOp}
        gmv={gmv}
        adSpend={adSpend}
        cogs={cogs}
        onApplyState={handleTaxApply}
        onCancel={() => setTaxOpen(false)}
      />
    </>
  )
}
