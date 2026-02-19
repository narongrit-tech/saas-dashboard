import { unstable_noStore as noStore } from 'next/cache'
import { getShopeeFinanceSummary } from './shopee-finance-actions'
import { ShopeeFinanceClient } from '@/components/finance/ShopeeFinanceClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ShopeeFinancePage() {
  noStore()

  const { summary, settlements, walletTxns } = await getShopeeFinanceSummary()

  return (
    <ShopeeFinanceClient
      summary={summary}
      settlements={settlements}
      walletTxns={walletTxns}
    />
  )
}
