'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { formatBangkok } from '@/lib/bangkok-time'
import { getReceiptLayers, getCOGSAllocations } from '@/app/(dashboard)/inventory/actions'

interface ReceiptLayer {
  id: string
  sku_internal: string
  received_at: string
  qty_received: number
  qty_remaining: number
  unit_cost: number
  ref_type: string
}

interface COGSAllocation {
  id: string
  order_id: string
  sku_internal: string
  shipped_at: string
  method: string
  qty: number
  unit_cost_used: number
  amount: number
  is_reversal: boolean
}

export function MovementsTab() {
  const [layers, setLayers] = useState<ReceiptLayer[]>([])
  const [allocations, setAllocations] = useState<COGSAllocation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [layersResult, allocationsResult] = await Promise.all([
      getReceiptLayers(),
      getCOGSAllocations(),
    ])

    if (layersResult.success) {
      setLayers(layersResult.data)
    }
    if (allocationsResult.success) {
      setAllocations(allocationsResult.data)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        ดูรายการ Receipt Layers (FIFO) และ COGS Allocations (Audit View)
      </p>

      <Tabs defaultValue="layers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="layers">Receipt Layers</TabsTrigger>
          <TabsTrigger value="allocations">COGS Allocations</TabsTrigger>
        </TabsList>

        <TabsContent value="layers">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
          ) : layers.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              ยังไม่มี Receipt Layers ในระบบ
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Received At</TableHead>
                    <TableHead className="text-right">Qty Received</TableHead>
                    <TableHead className="text-right">Qty Remaining</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                    <TableHead>Ref Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {layers.map((layer) => (
                    <TableRow key={layer.id}>
                      <TableCell className="font-mono">{layer.sku_internal}</TableCell>
                      <TableCell>
                        {formatBangkok(new Date(layer.received_at), 'dd/MM/yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="text-right">
                        {layer.qty_received.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            layer.qty_remaining === 0
                              ? 'text-muted-foreground'
                              : 'font-semibold'
                          }
                        >
                          {layer.qty_remaining.toFixed(4)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {layer.unit_cost.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(layer.qty_remaining * layer.unit_cost).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{layer.ref_type}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="allocations">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
          ) : allocations.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              ยังไม่มี COGS Allocations ในระบบ
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Shipped At</TableHead>
                    <TableHead className="text-center">Method</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((alloc) => (
                    <TableRow key={alloc.id}>
                      <TableCell className="font-mono">{alloc.order_id}</TableCell>
                      <TableCell className="font-mono">{alloc.sku_internal}</TableCell>
                      <TableCell>
                        {formatBangkok(new Date(alloc.shipped_at), 'dd/MM/yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{alloc.method}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            alloc.is_reversal ? 'text-destructive' : ''
                          }
                        >
                          {alloc.qty.toFixed(4)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {alloc.unit_cost_used.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            alloc.is_reversal ? 'text-destructive' : ''
                          }
                        >
                          {alloc.amount.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {alloc.is_reversal ? (
                          <Badge variant="destructive">Return</Badge>
                        ) : (
                          <Badge>Sale</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button variant="outline" onClick={loadData}>
          Refresh
        </Button>
      </div>
    </div>
  )
}
