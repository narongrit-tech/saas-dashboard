import { Suspense } from 'react'
import BankModuleClient from '@/components/bank/BankModuleClient'

export const metadata = {
  title: 'Bank Statement | SaaS Dashboard',
  description: 'Bank statement import and cash tracking',
}

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'

export default function BankPage() {
  return (
    <div className="space-y-6 w-full min-w-0">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Bank Statement</h1>
        <p className="text-muted-foreground mt-2">
          Import bank statements and track company cash flow
        </p>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <BankModuleClient />
      </Suspense>
    </div>
  )

}
