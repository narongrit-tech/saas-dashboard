import { Suspense } from 'react'
import SourceFlowClient from '@/components/cashflow/SourceFlowClient'

export const metadata = { title: 'Cash Source Flow | SaaS Dashboard' }
export const dynamic = 'force-dynamic'

export default function SourceFlowPage() {
  return (
    <div className="space-y-6 w-full min-w-0">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">Cash Source Flow</h1>
        <p className="text-sm text-muted-foreground mt-1">
          ที่มาและจุดหมายของเงินสดจากธนาคาร — ข้อมูลจริงจาก bank statements
        </p>
      </div>
      <Suspense fallback={<div>Loading...</div>}>
        <SourceFlowClient />
      </Suspense>
    </div>
  )
}
