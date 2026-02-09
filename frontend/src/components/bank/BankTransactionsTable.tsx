'use client'

import { useState, useEffect } from 'react'
import { getBankTransactions } from '@/app/(dashboard)/bank/actions'
import { BankTransaction } from '@/types/bank'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { subDays } from 'date-fns'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface BankTransactionsTableProps {
  bankAccountId: string
}

export default function BankTransactionsTable({ bankAccountId }: BankTransactionsTableProps) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<{ startDate: Date; endDate: Date }>({
    startDate: subDays(new Date(), 7),
    endDate: new Date(),
  })
  const [page, setPage] = useState(1)
  const [isOpen, setIsOpen] = useState(false)
  const perPage = 50
  const { toast } = useToast()

  useEffect(() => {
    if (isOpen) {
      loadTransactions()
    }
  }, [bankAccountId, dateRange, search, page, isOpen])

  async function loadTransactions() {
    if (!bankAccountId) return

    setLoading(true)
    const result = await getBankTransactions(bankAccountId, {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      search,
      page,
      perPage,
    })

    if (result.success && result.data) {
      setTransactions(result.data.transactions)
      setTotal(result.data.total)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load transactions',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  const totalPages = Math.ceil(total / perPage)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-4">
      <div className="flex items-center justify-between">
        <CollapsibleTrigger asChild>
          <Button variant="outline">
            {isOpen ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
            Raw Transactions ({total})
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="pl-9"
            />
          </div>
          <DateRangePicker
            value={dateRange}
            onChange={(range) => {
              setDateRange(range)
              setPage(1)
            }}
          />
        </div>

        {loading ? (
          <div>Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No transactions found
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right">Withdrawal</th>
                    <th className="px-4 py-3 text-right">Deposit</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-left">Channel</th>
                    <th className="px-4 py-3 text-left">Ref ID</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr key={txn.id} className="border-t hover:bg-muted/50">
                      <td className="px-4 py-3">{txn.txn_date}</td>
                      <td className="px-4 py-3 max-w-xs truncate" title={txn.description || ''}>
                        {txn.description || '-'}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {txn.withdrawal > 0
                          ? `฿${txn.withdrawal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-right text-green-600">
                        {txn.deposit > 0
                          ? `฿${txn.deposit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {txn.balance !== null
                          ? `฿${txn.balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                      <td className="px-4 py-3">{txn.channel || '-'}</td>
                      <td className="px-4 py-3">{txn.reference_id || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total} transactions
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
                  <span className="flex items-center px-3 text-sm">
                    Page {page} of {totalPages}
                  </span>
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
      </CollapsibleContent>
    </Collapsible>
  )
}
