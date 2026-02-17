'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { BankAccount } from '@/types/bank'
import { getBankAccounts } from '@/app/(dashboard)/bank/actions'
import BankAccountSelector from './BankAccountSelector'
import AddBankAccountDialog from './AddBankAccountDialog'
import ImportBankStatementDialog from './ImportBankStatementDialog'
import BankDailySummaryTable from './BankDailySummaryTable'
import BankTransactionsTable from './BankTransactionsTable'
import CashInClassification from './CashInClassification'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Upload } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function BankModuleClient() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') || 'overview'

  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [activeTab, setActiveTab] = useState<string>(tabParam)
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

      {/* Tabs */}
      {selectedAccountId && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="cash-in-classification">Cash In Classification</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <BankDailySummaryTable bankAccountId={selectedAccountId} />
          </TabsContent>

          <TabsContent value="transactions">
            <BankTransactionsTable bankAccountId={selectedAccountId} />
          </TabsContent>

          <TabsContent value="cash-in-classification">
            <CashInClassification bankAccountId={selectedAccountId} accounts={accounts} />
          </TabsContent>
        </Tabs>
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
