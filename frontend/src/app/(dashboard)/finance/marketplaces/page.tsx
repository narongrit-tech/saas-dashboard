import Link from 'next/link'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const MARKETPLACES = [
  {
    name: 'TikTok Shop',
    description: 'Track wallet cashflow and settlements for TikTok Shop.',
    href: '/finance/marketplaces/tiktok-shop?tab=cashflow',
  },
  {
    name: 'Shopee',
    description: 'Manage Shopee settlements and monitor wallet cashflow.',
    href: '/finance/marketplaces/shopee?tab=settlements',
  },
  {
    name: 'Lazada',
    description: 'Track wallet cashflow and settlements for Lazada.',
    href: '/finance/marketplaces/lazada?tab=cashflow',
  },
] as const

export default function MarketplaceFinanceIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Marketplace Finance</h1>
        <p className="text-sm text-muted-foreground">Choose a marketplace to open its finance workspace.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MARKETPLACES.map((marketplace) => (
          <Card key={marketplace.name} className="relative">
            <Link
              href={marketplace.href}
              className="absolute inset-0 rounded-lg"
              aria-label={`Open ${marketplace.name}`}
            />
            <CardHeader>
              <CardTitle>{marketplace.name}</CardTitle>
              <CardDescription>{marketplace.description}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild className="relative z-10">
                <Link href={marketplace.href}>Open</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
