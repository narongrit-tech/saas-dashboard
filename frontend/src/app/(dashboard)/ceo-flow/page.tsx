import { Suspense } from 'react'
import CeoFlowClient from '@/components/cashflow/CeoFlowClient'

export const metadata = { title: 'CEO Cash Flow | SaaS Dashboard' }
export const dynamic = 'force-dynamic'

export default function CeoFlowPage() {
  return (
    <div className="space-y-6 w-full min-w-0">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">CEO Personal Cash Flow</h1>
        <p className="text-sm text-muted-foreground mt-1">
          กระแสเงินสดส่วนตัวของ CEO — แยกจากบัญชีบริษัท
        </p>
      </div>
      <Suspense fallback={<div>Loading...</div>}>
        <CeoFlowClient />
      </Suspense>
    </div>
  )
}
