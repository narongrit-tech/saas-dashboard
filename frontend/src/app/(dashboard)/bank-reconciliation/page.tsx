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
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Bank Reconciliation</h1>
        <p className="text-muted-foreground mt-2">
          Match bank transactions with marketplace settlements, expenses, and wallet top-ups
        </p>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <BankReconciliationClient />
      </Suspense>
    </div>
  )
}
