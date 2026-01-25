'use client'

import { useState, useEffect } from 'react'
import { getUnmatchedInternalRecords } from '@/app/(dashboard)/reconciliation/bank-reconciliation-actions'
import { UnmatchedInternalRecord } from '@/types/bank'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'

interface UnmatchedInternalRecordsTabsProps {
  startDate: Date
  endDate: Date
}

export default function UnmatchedInternalRecordsTabs({
  startDate,
  endDate,
}: UnmatchedInternalRecordsTabsProps) {
  const [settlements, setSettlements] = useState<UnmatchedInternalRecord[]>([])
  const [expenses, setExpenses] = useState<UnmatchedInternalRecord[]>([])
  const [walletTopups, setWalletTopups] = useState<UnmatchedInternalRecord[]>([])
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    loadAllUnmatched()
  }, [startDate, endDate])

  async function loadAllUnmatched() {
    setLoading(true)

    const [settlementsResult, expensesResult, walletResult] = await Promise.all([
      getUnmatchedInternalRecords(startDate, endDate, 'settlement'),
      getUnmatchedInternalRecords(startDate, endDate, 'expense'),
      getUnmatchedInternalRecords(startDate, endDate, 'wallet_topup'),
    ])

    if (settlementsResult.success && settlementsResult.data) {
      setSettlements(settlementsResult.data)
    }
    if (expensesResult.success && expensesResult.data) {
      setExpenses(expensesResult.data)
    }
    if (walletResult.success && walletResult.data) {
      setWalletTopups(walletResult.data)
    }

    setLoading(false)
  }

  function renderTable(records: UnmatchedInternalRecord[]) {
    if (loading) {
      return <div className="py-8 text-center">Loading...</div>
    }

    if (records.length === 0) {
      return (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          All records are matched
        </div>
      )
    }

    return (
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.entity_id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3">{record.date}</td>
                <td className="px-4 py-3 max-w-md truncate" title={record.description}>
                  {record.description}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  ฿{record.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-center">
                  <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                    Unmatched
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Unmatched Internal Records</h2>
        <p className="text-sm text-muted-foreground">
          Internal records not matched with bank transactions
        </p>
      </div>

      <Tabs defaultValue="settlements" className="w-full">
        <TabsList>
          <TabsTrigger value="settlements">
            Settlements ({settlements.length})
          </TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses ({expenses.length})
          </TabsTrigger>
          <TabsTrigger value="wallet">
            Wallet Top-ups ({walletTopups.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settlements" className="mt-4">
          {renderTable(settlements)}
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          {renderTable(expenses)}
        </TabsContent>

        <TabsContent value="wallet" className="mt-4">
          {renderTable(walletTopups)}
        </TabsContent>
      </Tabs>
    </div>
  )
}
