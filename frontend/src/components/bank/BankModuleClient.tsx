'use client'

import { useState, useEffect } from 'react'
import { BankAccount } from '@/types/bank'
import { getBankAccounts } from '@/app/(dashboard)/bank/actions'
import BankAccountSelector from './BankAccountSelector'
import AddBankAccountDialog from './AddBankAccountDialog'
import ImportBankStatementDialog from './ImportBankStatementDialog'
import BankDailySummaryTable from './BankDailySummaryTable'
import BankTransactionsTable from './BankTransactionsTable'
import { Button } from '@/components/ui/button'
import { Plus, Upload } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function BankModuleClient() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    loadAccounts()
  }, [])

  async function loadAccounts() {
    setLoading(true)
    const result = await getBankAccounts()
    if (result.success && result.data) {
      setAccounts(result.data)
      if (result.data.length > 0 && !selectedAccountId) {
        setSelectedAccountId(result.data[0].id)
      }
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load bank accounts',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  if (loading) {
    return <div>Loading bank accounts...</div>
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">
          No bank accounts found. Add your first bank account to get started.
        </p>
        <Button onClick={() => setShowAddAccount(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Bank Account
        </Button>
        <AddBankAccountDialog
          open={showAddAccount}
          onOpenChange={setShowAddAccount}
          onSuccess={loadAccounts}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <BankAccountSelector
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
        />
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={() => setShowAddAccount(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Account
          </Button>
          <Button onClick={() => setShowImport(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Statement
          </Button>
        </div>
      </div>

      {/* Daily Summary */}
      {selectedAccountId && (
        <>
          <BankDailySummaryTable bankAccountId={selectedAccountId} />
          <BankTransactionsTable bankAccountId={selectedAccountId} />
        </>
      )}

      {/* Dialogs */}
      <AddBankAccountDialog
        open={showAddAccount}
        onOpenChange={setShowAddAccount}
        onSuccess={loadAccounts}
      />
      <ImportBankStatementDialog
        open={showImport}
        onOpenChange={setShowImport}
        bankAccountId={selectedAccountId}
        onSuccess={() => {
          toast({
            title: 'Success',
            description: 'Bank statement imported successfully',
          })
        }}
      />
    </div>
  )
}
