import { Metadata } from 'next'
import { SkuMappingsClient } from '@/components/sku-mappings/SkuMappingsClient'

export const metadata: Metadata = { title: 'SKU Mappings' }
export const dynamic = 'force-dynamic'

export default function SkuMappingsPage() {
  return (
    <div className="container mx-auto py-6">
      <SkuMappingsClient />
    </div>
  )
}
