'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProductsTab } from '@/components/inventory/ProductsTab'
import { OpeningBalanceTab } from '@/components/inventory/OpeningBalanceTab'
import { BundlesTab } from '@/components/inventory/BundlesTab'
import { MovementsTab } from '@/components/inventory/MovementsTab'

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Inventory & COGS</h1>
        <p className="text-muted-foreground mt-1">
          จัดการสินค้า, Opening Balance, Bundle และ COGS Allocations (FIFO/AVG)
        </p>
      </div>

      <Tabs defaultValue="products" className="space-y-4">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="opening-balance">Opening Balance</TabsTrigger>
          <TabsTrigger value="bundles">Bundles</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <ProductsTab />
        </TabsContent>

        <TabsContent value="opening-balance" className="space-y-4">
          <OpeningBalanceTab />
        </TabsContent>

        <TabsContent value="bundles" className="space-y-4">
          <BundlesTab />
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          <MovementsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
