import { unstable_noStore as noStore } from 'next/cache'
import { getShopeeFinanceSummary } from '@/app/(dashboard)/finance/shopee/shopee-finance-actions'
import { ShopeeFinanceClient } from '@/components/finance/ShopeeFinanceClient'

interface ShopeeSettlementsModuleProps {
  startDate?: string
  endDate?: string
  basePath?: string
  tab?: 'cashflow' | 'settlements'
}

export async function ShopeeSettlementsModule({
  startDate,
  endDate,
  basePath = '/finance/shopee',
  tab = 'settlements',
}: ShopeeSettlementsModuleProps) {
  noStore()

  const { summary, settlements, walletTxns } = await getShopeeFinanceSummary({
    startDate,
    endDate,
  })

  return (
    <ShopeeFinanceClient
      summary={summary}
      settlements={settlements}
      walletTxns={walletTxns}
      startDate={startDate ?? ''}
      endDate={endDate ?? ''}
      basePath={basePath}
      tab={tab}
    />
  )
}
