'use client'

import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Marketplace = 'tiktok-shop' | 'shopee' | 'lazada'
type HubTab = 'cashflow' | 'settlements'

interface MarketplaceFinanceHubClientProps {
  marketplace: Marketplace
  tab: HubTab
  cashflowContent: React.ReactNode
  settlementsContent: React.ReactNode
}

const MARKETPLACE_OPTIONS: Array<{ value: Marketplace; label: string }> = [
  { value: 'tiktok-shop', label: 'TikTok Shop' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
]

export function MarketplaceFinanceHubClient({
  marketplace,
  tab,
  cashflowContent,
  settlementsContent,
}: MarketplaceFinanceHubClientProps) {
  const router = useRouter()

  function goTo(nextMarketplace: Marketplace, nextTab: HubTab) {
    router.push(`/finance/marketplaces/${nextMarketplace}?tab=${nextTab}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Marketplace Finance</h1>
          <p className="text-sm text-muted-foreground">Unified cashflow and settlements workspace by marketplace</p>
        </div>

        <div className="w-64">
          <label className="text-sm font-medium text-gray-700 mb-2 block">Marketplace</label>
          <Select value={marketplace} onValueChange={(value) => goTo(value as Marketplace, tab)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARKETPLACE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => goTo(marketplace, value as HubTab)}>
        <TabsList>
          <TabsTrigger value="cashflow">Wallet Cashflow</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
        </TabsList>

        <TabsContent value="cashflow" className="mt-4">
          {cashflowContent}
        </TabsContent>

        <TabsContent value="settlements" className="mt-4">
          {settlementsContent}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function MarketplaceComingSoon() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-muted-foreground">Coming soon</CardContent>
    </Card>
  )
}
