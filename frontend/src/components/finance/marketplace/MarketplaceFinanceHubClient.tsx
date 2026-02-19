'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Marketplace = 'tiktok-shop' | 'shopee' | 'lazada'
type HubTab = 'cashflow' | 'settlements'

interface MarketplaceFinanceHubClientProps {
  marketplace: Marketplace
  tab: HubTab
  cashflowContent: React.ReactNode
  settlementsContent: React.ReactNode
}

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

        <Button asChild variant="outline" size="sm">
          <Link href="/finance/marketplaces">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to marketplaces
          </Link>
        </Button>
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
