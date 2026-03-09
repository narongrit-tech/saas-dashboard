'use client'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { SankeyTxnRow } from '@/types/cashflow-sankey'
import { INFLOW_SOURCE_LABELS, OUTFLOW_CATEGORY_LABELS } from '@/types/cashflow-sankey'

interface Props {
  open: boolean
  nodeLabel: string
  rows: SankeyTxnRow[]
  loading: boolean
  error?: string | null
  onClose: () => void
  onClassify?: (txn: SankeyTxnRow) => void
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getSourceCategory(row: SankeyTxnRow): string {
  if (row.inflow_source) return INFLOW_SOURCE_LABELS[row.inflow_source] ?? row.inflow_source
  if (row.outflow_category) {
    const label = OUTFLOW_CATEGORY_LABELS[row.outflow_category] ?? row.outflow_category
    return row.outflow_sub ? `${label} / ${row.outflow_sub}` : label
  }
  return row.deposit > 0 ? 'Unclassified Inflow' : 'Unclassified Outflow'
}

export default function SankeyDrilldownDrawer({
  open,
  nodeLabel,
  rows,
  loading,
  error,
  onClose,
  onClassify,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="text-base font-semibold">
            {nodeLabel || 'รายการธุรกรรม'}
          </SheetTitle>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground">{rows.length} รายการ</p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && error && (
            <div className="px-6 py-4 text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="px-6 py-4 text-sm text-muted-foreground">ไม่มีรายการ</div>
          )}

          {!loading && !error && rows.length > 0 && (
            <>
              {/* Mobile: card list */}
              <div className="divide-y sm:hidden">
                {rows.map((row) => (
                  <div key={row.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{formatDate(row.txn_date)}</span>
                      <span className="text-xs text-muted-foreground">{row.bank_name}</span>
                    </div>
                    <p className="text-sm font-medium truncate">{row.description || '—'}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{getSourceCategory(row)}</span>
                      {row.deposit > 0 ? (
                        <span className="text-sm font-mono font-semibold text-green-600">
                          +฿{formatCurrency(row.deposit)}
                        </span>
                      ) : (
                        <span className="text-sm font-mono font-semibold text-red-600">
                          -฿{formatCurrency(row.withdrawal)}
                        </span>
                      )}
                    </div>
                    {row.note && (
                      <p className="text-xs text-muted-foreground italic">{row.note}</p>
                    )}
                    {onClassify && (
                      <button
                        className="text-xs text-blue-600 underline"
                        onClick={() => onClassify(row)}
                      >
                        จัดประเภท
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="px-4 py-2 font-medium text-muted-foreground">วันที่</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">ธนาคาร</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">รายการ</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">ฝาก</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">ถอน</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">หมวดหมู่</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">หมายเหตุ</th>
                      {onClassify && <th className="px-4 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                          {formatDate(row.txn_date)}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                          {row.bank_name}
                        </td>
                        <td className="px-4 py-2 max-w-[200px] truncate">
                          {row.description || '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-green-600 whitespace-nowrap">
                          {row.deposit > 0 ? `฿${formatCurrency(row.deposit)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-red-600 whitespace-nowrap">
                          {row.withdrawal > 0 ? `฿${formatCurrency(row.withdrawal)}` : '—'}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                          {getSourceCategory(row)}
                        </td>
                        <td className="px-4 py-2 max-w-[120px] truncate text-muted-foreground">
                          {row.note || '—'}
                        </td>
                        {onClassify && (
                          <td className="px-4 py-2">
                            <button
                              className="text-xs text-blue-600 underline whitespace-nowrap"
                              onClick={() => onClassify(row)}
                            >
                              จัดประเภท
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose}>
            ปิด
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
