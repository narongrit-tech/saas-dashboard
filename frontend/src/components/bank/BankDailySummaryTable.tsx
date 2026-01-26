'use client'

import { useState, useEffect } from 'react'
import { exportBankTransactions } from '@/app/(dashboard)/bank/actions'
import { getCashPositionFromDates } from '@/app/(dashboard)/bank/cash-position-actions'
import { CashPositionResult } from '@/lib/cashflow/cash-position'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { subDays } from 'date-fns'
import { SingleDateRangePicker } from '@/components/shared/SingleDateRangePicker'
import OpeningBalanceCard from './OpeningBalanceCard'
import SetOpeningBalanceDialog from './SetOpeningBalanceDialog'
import BankBalanceSummaryCard from './BankBalanceSummaryCard'

interface BankDailySummaryTableProps {
  bankAccountId: string
}

export default function BankDailySummaryTable({ bankAccountId }: BankDailySummaryTableProps) {
  const [cashPosition, setCashPosition] = useState<CashPositionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dateRange, setDateRange] = useState<{ startDate: Date; endDate: Date }>({
    startDate: subDays(new Date(), 7),
    endDate: new Date(),
  })
  const [showSetOpeningBalance, setShowSetOpeningBalance] = useState(false)
  const [page, setPage] = useState(1)
  const perPage = 30
  const { toast } = useToast()

  useEffect(() => {
    loadSummary()
  }, [bankAccountId, dateRange])

  async function loadSummary() {
    if (!bankAccountId) return

    setLoading(true)
    const result = await getCashPositionFromDates(
      bankAccountId,
      dateRange.startDate,
      dateRange.endDate
    )

    if (result.success && result.data) {
      setCashPosition(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load cash position',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  async function handleExport() {
    setExporting(true)
    const result = await exportBankTransactions(bankAccountId, dateRange.startDate, dateRange.endDate)

    if (result.success && result.csv && result.filename) {
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = result.filename
      link.click()
      toast({
        title: 'Success',
        description: 'CSV exported successfully',
      })
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Export failed',
        variant: 'destructive',
      })
    }
    setExporting(false)
  }

  const summary = cashPosition?.daily || []
  const paginatedSummary = summary.slice((page - 1) * perPage, page * perPage)
  const totalPages = Math.ceil(summary.length / perPage)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Daily Summary</h2>
        <div className="flex items-center gap-2">
          <SingleDateRangePicker
            defaultRange={dateRange}
            onChange={setDateRange}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              loadSummary()
              toast({ title: 'Refreshing...', description: 'Loading latest data' })
            }}
            title="Refresh data"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Opening Balance Card */}
      <OpeningBalanceCard
        openingBalance={cashPosition?.openingBalance || 0}
        effectiveDate={cashPosition?.openingEffectiveDate || null}
        onEdit={() => setShowSetOpeningBalance(true)}
      />

      {/* Bank Balance Summary Card (with Delta) */}
      <BankBalanceSummaryCard
        bankAccountId={bankAccountId}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
        onUpdate={loadSummary}
      />

      {loading ? (
        <div>Loading...</div>
      ) : summary.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No transactions found for this date range
        </div>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Cash In</th>
                  <th className="px-4 py-3 text-right">Cash Out</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3 text-right">Running Balance</th>
                  <th className="px-4 py-3 text-center">Txns</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSummary.map((day) => (
                  <tr key={day.date} className="border-t hover:bg-muted/50">
                    <td className="px-4 py-3">{day.date}</td>
                    <td className="px-4 py-3 text-right text-green-600">
                      ฿{day.cashIn.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      ฿{day.cashOut.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${day.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ฿{day.net.toLocaleString('th-TH', { minimumFractionDigits: 2, signDisplay: 'always' })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      ฿{day.runningBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {day.txnCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, summary.length)} of {summary.length} days
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Set Opening Balance Dialog */}
      <SetOpeningBalanceDialog
        open={showSetOpeningBalance}
        onOpenChange={setShowSetOpeningBalance}
        bankAccountId={bankAccountId}
        defaultDate={dateRange.startDate}
        onSuccess={loadSummary}
      />
    </div>
  )
}
