'use client'

import { useState, useEffect } from 'react'
import { subDays } from 'date-fns'
import {
  getReconciliationSummary,
  getUnmatchedBankTransactions,
} from '@/app/(dashboard)/reconciliation/bank-reconciliation-actions'
import { ReconciliationSummary } from '@/types/bank'
import { SingleDateRangePicker } from '@/components/shared/SingleDateRangePicker'
import ReconciliationSummaryCards from './ReconciliationSummaryCards'
import UnmatchedBankTransactionsTable from './UnmatchedBankTransactionsTable'
import UnmatchedInternalRecordsTabs from './UnmatchedInternalRecordsTabs'
import { useToast } from '@/hooks/use-toast'

export default function BankReconciliationClient() {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<{ startDate: Date; endDate: Date }>({
    startDate: subDays(new Date(), 7),
    endDate: new Date(),
  })
  const { toast } = useToast()

  useEffect(() => {
    loadSummary()
  }, [dateRange])

  async function loadSummary() {
    setLoading(true)
    const result = await getReconciliationSummary(dateRange.startDate, dateRange.endDate)

    if (result.success && result.data) {
      setSummary(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load reconciliation summary',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SingleDateRangePicker
          defaultRange={dateRange}
          onChange={setDateRange}
        />
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : summary ? (
        <>
          {/* Summary Cards */}
          <ReconciliationSummaryCards summary={summary} />

          {/* Unmatched Bank Transactions */}
          <UnmatchedBankTransactionsTable
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
          />

          {/* Unmatched Internal Records */}
          <UnmatchedInternalRecordsTabs
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
          />
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          No data available
        </div>
      )}
    </div>
  )
}
