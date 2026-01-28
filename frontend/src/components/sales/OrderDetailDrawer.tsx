'use client'

import { useEffect, useState } from 'react'
import { SalesOrder } from '@/types/sales'
import { getSalesOrderDetail } from '@/app/(dashboard)/sales/actions'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface OrderDetailDrawerProps {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OrderDetailDrawer({ orderId, open, onOpenChange }: OrderDetailDrawerProps) {
  const [lines, setLines] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && orderId) {
      fetchOrderDetail()
    }
  }, [open, orderId])

  const fetchOrderDetail = async () => {
    if (!orderId) return

    setLoading(true)
    setError(null)

    try {
      const result = await getSalesOrderDetail(orderId)
      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาด')
        return
      }
      setLines(result.data || [])
    } catch (err) {
      console.error('Error fetching order detail:', err)
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // Calculate order totals
  const orderSummary = lines.length > 0 ? {
    order_amount: Math.max(...lines.map(l => l.total_amount || 0)), // MAX (should be same)
    total_units: lines.reduce((sum, l) => sum + (l.quantity || 0), 0),
    sku_count: lines.length,
  } : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[600px] w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Order Detail</SheetTitle>
          <SheetDescription>
            Order ID: {orderId}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="mt-6 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded bg-gray-200" />
            ))}
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-md bg-red-50 p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {!loading && !error && lines.length > 0 && (
          <div className="mt-6 space-y-6">
            {/* Order Summary */}
            <div className="rounded-lg border bg-gray-50 p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Platform</span>
                <span className="font-medium">{lines[0].source_platform || lines[0].marketplace}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline">{lines[0].platform_status || '-'}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Payment</span>
                <Badge variant={lines[0].payment_status === 'paid' ? 'default' : 'outline'}>
                  {lines[0].payment_status || '-'}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Order Amount</span>
                <span className="font-semibold text-lg">฿{formatCurrency(orderSummary?.order_amount || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Units</span>
                <span className="font-medium">{orderSummary?.total_units || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">SKUs</span>
                <span className="font-medium">{orderSummary?.sku_count || 0} items</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Order Date</span>
                  <span>{formatDate(lines[0].order_date)}</span>
                </div>
                {lines[0].paid_at && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Paid Date</span>
                    <span>{formatDate(lines[0].paid_at)}</span>
                  </div>
                )}
                {lines[0].shipped_at && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Shipped Date</span>
                    <span>{formatDate(lines[0].shipped_at)}</span>
                  </div>
                )}
                {lines[0].delivered_at && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Delivered Date</span>
                    <span>{formatDate(lines[0].delivered_at)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line Items Table */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Line Items ({lines.length})</h3>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, index) => {
                      // CRITICAL FIX: Compute line subtotal (NOT total_amount which is order-level)
                      // Line subtotal = quantity * unit_price (null-safe)
                      const lineSubtotal = (line.quantity ?? 0) * (line.unit_price ?? 0)

                      return (
                        <TableRow key={index}>
                          <TableCell className="font-medium">
                            <div className="max-w-[200px]">
                              <div className="truncate">{line.product_name}</div>
                              {(line.seller_sku || line.sku_id) && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  SKU: {line.seller_sku || line.sku_id}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{line.quantity ?? 0}</TableCell>
                          <TableCell className="text-right">
                            ฿{formatCurrency(line.unit_price ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            ฿{formatCurrency(lineSubtotal)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && lines.length === 0 && (
          <div className="mt-6 text-center text-muted-foreground">
            ไม่พบข้อมูล
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
