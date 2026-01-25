'use client'

import { useState, useEffect } from 'react'
import { getUnmatchedBankTransactions } from '@/app/(dashboard)/reconciliation/bank-reconciliation-actions'
import { UnmatchedBankTransaction } from '@/types/bank'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { ManualMatchModal } from './ManualMatchModal'

interface UnmatchedBankTransactionsTableProps {
  startDate: Date
  endDate: Date
}

export default function UnmatchedBankTransactionsTable({
  startDate,
  endDate,
}: UnmatchedBankTransactionsTableProps) {
  const [transactions, setTransactions] = useState<UnmatchedBankTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [showMatchDialog, setShowMatchDialog] = useState(false)
  const [selectedTxn, setSelectedTxn] = useState<UnmatchedBankTransaction | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadUnmatched()
  }, [startDate, endDate])

  async function loadUnmatched() {
    setLoading(true)
    const result = await getUnmatchedBankTransactions(startDate, endDate)

    if (result.success && result.data) {
      setTransactions(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load unmatched transactions',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Unmatched Bank Transactions</h2>
        <p className="text-sm text-muted-foreground">
          Bank transactions not matched with internal records
        </p>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : transactions.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          All bank transactions are matched
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-right">Withdrawal</th>
                <th className="px-4 py-3 text-right">Deposit</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => {
                const txnAmount = Number(txn.deposit || 0) - Number(txn.withdrawal || 0)
                return (
                  <tr key={txn.id} className="border-t hover:bg-muted/50">
                    <td className="px-4 py-3">{txn.txn_date}</td>
                    <td className="px-4 py-3 max-w-md truncate" title={txn.description || ''}>
                      {txn.description || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {txn.withdrawal > 0
                        ? `฿${txn.withdrawal.toLocaleString('th-TH', {
                            minimumFractionDigits: 2,
                          })}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-green-600">
                      {txn.deposit > 0
                        ? `฿${txn.deposit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="destructive">Unmatched</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedTxn(txn)
                          setShowMatchDialog(true)
                        }}
                      >
                        Match
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Match Modal */}
      {selectedTxn && (
        <ManualMatchModal
          bankTransaction={selectedTxn}
          open={showMatchDialog}
          onOpenChange={setShowMatchDialog}
          onSuccess={() => {
            loadUnmatched() // Refresh unmatched list
          }}
        />
      )}
    </div>
  )
}
