import { redirect } from 'next/navigation'
import { CashflowModule } from '@/components/finance/marketplace/CashflowModule'
import {
  MarketplaceComingSoon,
  MarketplaceFinanceHubClient,
} from '@/components/finance/marketplace/MarketplaceFinanceHubClient'
import { ShopeeSettlementsModule } from '@/components/finance/marketplace/ShopeeSettlementsModule'

type Marketplace = 'tiktok-shop' | 'shopee' | 'lazada'
type HubTab = 'cashflow' | 'settlements'

interface PageProps {
  params: { marketplace: string }
  searchParams: {
    tab?: string
    startDate?: string
    endDate?: string
  }
}

function isMarketplace(value: string): value is Marketplace {
  return value === 'tiktok-shop' || value === 'shopee' || value === 'lazada'
}

function normalizeTab(tab?: string): HubTab {
  return tab === 'settlements' ? 'settlements' : 'cashflow'
}

export default async function MarketplaceFinanceHubPage({ params, searchParams }: PageProps) {
  if (!isMarketplace(params.marketplace)) {
    redirect('/finance/marketplaces/tiktok-shop?tab=cashflow')
  }

  const marketplace = params.marketplace
  const tab = normalizeTab(searchParams.tab)

  const settlementsContent =
    marketplace === 'shopee' ? (
      <ShopeeSettlementsModule
        startDate={searchParams.startDate}
        endDate={searchParams.endDate}
        basePath="/finance/marketplaces/shopee"
        tab="settlements"
      />
    ) : (
      <MarketplaceComingSoon />
    )

  return (
    <MarketplaceFinanceHubClient
      marketplace={marketplace}
      tab={tab}
      cashflowContent={<CashflowModule marketplace={marketplace} showMarketplaceSelector={false} />}
      settlementsContent={settlementsContent}
    />
  )
}
