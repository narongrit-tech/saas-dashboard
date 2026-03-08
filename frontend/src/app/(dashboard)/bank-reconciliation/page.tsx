import { Suspense } from 'react'
import BankReconciliationClient from '@/components/reconciliation/BankReconciliationClient'

export const metadata = {
  title: 'Bank Reconciliation | SaaS Dashboard',
  description: 'Reconcile bank transactions with internal records',
}

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'

export default function BankReconciliationPage() {
  return (
    <div className="space-y-4 w-full min-w-0">
      <div>
        <h1 className="text-xl font-bold leading-tight sm:text-2xl">Bank Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Match bank transactions with marketplace settlements, expenses, and wallet top-ups
        </p>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <BankReconciliationClient />
      </Suspense>
    </div>
  )
}
