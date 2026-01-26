'use client'
import { DateRangeValue } from "@/components/shared/UnifiedDateRangePicker";

import { useState, useEffect } from 'react'
import { subDays } from 'date-fns'
import {
  getReconciliationSummary,
  getUnmatchedBankTransactions,
} from '@/app/(dashboard)/reconciliation/bank-reconciliation-actions'
import { autoMatchBankTransactions } from '@/app/(dashboard)/reconciliation/auto-match-actions'
import { ReconciliationSummary } from '@/types/bank'
import { UnifiedDateRangePicker } from '@/components/shared/UnifiedDateRangePicker'
import ReconciliationSummaryCards from './ReconciliationSummaryCards'
import UnmatchedBankTransactionsTable from './UnmatchedBankTransactionsTable'
import UnmatchedInternalRecordsTabs from './UnmatchedInternalRecordsTabs'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Loader2, Zap } from 'lucide-react'

export default function BankReconciliationClient() {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoMatchLoading, setAutoMatchLoading] = useState(false)
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    from: subDays(new Date(), 7),
    to: new Date(),
  })
  const { toast } = useToast()

  useEffect(() => {
    loadSummary()
  }, [dateRange])

  async function loadSummary() {
    setLoading(true)
    const result = await getReconciliationSummary(dateRange.from, dateRange.to)

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

  async function handleAutoMatch() {
    setAutoMatchLoading(true)
    try {
      const result = await autoMatchBankTransactions(dateRange.from, dateRange.to)

      if (result.success) {
        toast({
          title: 'Auto Match สำเร็จ',
          description: `จับคู่อัตโนมัติ: ${result.matched_count} รายการ

ข้ามไป: ${result.skipped_count} รายการ
- ไม่มี candidate: ${result.details.no_candidate}
- มีหลาย candidates: ${result.details.multiple_candidates}
- matched แล้ว: ${result.details.already_matched}`,
        })

        // Refresh data
        loadSummary()
      } else {
        toast({
          variant: 'destructive',
          title: 'Auto Match ล้มเหลว',
          description: result.error || 'ไม่สามารถ auto-match ได้',
        })
      }
    } catch (error) {
      console.error('Auto match error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'ไม่สามารถ auto-match ได้',
      })
    } finally {
      setAutoMatchLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UnifiedDateRangePicker
            value={dateRange}
            onChange={setDateRange}
          />

          <Button
            onClick={handleAutoMatch}
            disabled={autoMatchLoading}
            variant="default"
          >
            {autoMatchLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลัง Auto Match...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Auto Match (Exact Only)
              </>
            )}
          </Button>
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : summary ? (
        <>
          {/* Summary Cards */}
          <ReconciliationSummaryCards summary={summary} />

          {/* Unmatched Bank Transactions */}
          <UnmatchedBankTransactionsTable
            startDate={dateRange.from}
            endDate={dateRange.to}
          />

          {/* Unmatched Internal Records */}
          <UnmatchedInternalRecordsTabs
            startDate={dateRange.from}
            endDate={dateRange.to}
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
