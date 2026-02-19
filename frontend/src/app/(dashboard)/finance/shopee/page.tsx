import { unstable_noStore as noStore } from 'next/cache'
import { getShopeeFinanceSummary } from './shopee-finance-actions'
import { ShopeeFinanceClient } from '@/components/finance/ShopeeFinanceClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SearchParams {
  startDate?: string
  endDate?: string
}

export default async function ShopeeFinancePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  noStore()

  const { summary, settlements, walletTxns } = await getShopeeFinanceSummary({
    startDate: searchParams.startDate,
    endDate: searchParams.endDate,
  })

  return (
    <ShopeeFinanceClient
      summary={summary}
      settlements={settlements}
      walletTxns={walletTxns}
      startDate={searchParams.startDate ?? ''}
      endDate={searchParams.endDate ?? ''}
    />
  )
}
