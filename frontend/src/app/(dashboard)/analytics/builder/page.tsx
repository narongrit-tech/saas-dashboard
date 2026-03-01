import { type Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { AnalyticsBuilderClient } from '@/components/analytics/AnalyticsBuilderClient'
import { listAnalyticsPresets } from './actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Analytics Builder',
}

export default async function AnalyticsBuilderPage() {
  noStore()
  const presetsResult = await listAnalyticsPresets()
  const initialPresets = presetsResult.success && Array.isArray(presetsResult.data)
    ? presetsResult.data
    : []

  return <AnalyticsBuilderClient initialPresets={initialPresets} />
}
