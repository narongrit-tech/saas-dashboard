'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Package } from 'lucide-react'
import { OrderSearchResult, ReturnType, RETURN_TYPE_LABELS, ReturnSubmitPayload } from '@/types/returns'
import { submitReturn } from '@/app/(dashboard)/returns/actions'
import { useToast } from '@/hooks/use-toast'

interface ReturnDrawerProps {
  open: boolean
  order: OrderSearchResult
  onClose: () => void
  onSuccess: () => void
}

interface LineItemState {
  line_item_id: string
  sku: string
  qty_to_return: number
  return_type: ReturnType
}

export function ReturnDrawer({ open, order, onClose, onSuccess }: ReturnDrawerProps) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState(order.external_order_id || '')

  // Initialize line item state
  const [lineItems, setLineItems] = useState<LineItemState[]>(
    order.line_items.map((item) => ({
      line_item_id: item.id,
      sku: item.sku,
      qty_to_return: Math.max(0, item.quantity - item.qty_returned),
      return_type: 'RETURN_RECEIVED' as ReturnType,
    }))
  )

  const handleQtyChange = (lineItemId: string, value: string) => {
    const qty = parseInt(value) || 0
    setLineItems((prev) =>
      prev.map((item) =>
        item.line_item_id === lineItemId ? { ...item, qty_to_return: qty } : item
      )
    )
  }

  const handleReturnTypeChange = (lineItemId: string, value: ReturnType) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item.line_item_id === lineItemId ? { ...item, return_type: value } : item
      )
    )
  }

  const handleSubmit = async () => {
    // Validate: at least one item with qty > 0
    const itemsToReturn = lineItems.filter((item) => item.qty_to_return > 0)

    if (itemsToReturn.length === 0) {
      toast({
        title: 'Error',
        description: 'กรุณาระบุจำนวนที่ต้องการรับคืนอย่างน้อย 1 รายการ',
        variant: 'destructive',
      })
      return
    }

    // Validate: qty_to_return <= available
    for (const item of itemsToReturn) {
      const orderItem = order.line_items.find((i) => i.id === item.line_item_id)
      if (!orderItem) continue

      const available = orderItem.quantity - orderItem.qty_returned
      if (item.qty_to_return > available) {
        toast({
          title: 'Error',
          description: `SKU ${item.sku}: ไม่สามารถรับคืน ${item.qty_to_return} ชิ้นได้ (มีเพียง ${available} ชิ้น)`,
          variant: 'destructive',
        })
        return
      }
    }

    setSubmitting(true)

    const payload: ReturnSubmitPayload = {
      order_id: order.id,
      items: itemsToReturn.map((item) => ({
        line_item_id: item.line_item_id,
        sku: item.sku,
        qty: item.qty_to_return,
        return_type: item.return_type,
      })),
      note: note.trim() || undefined,
    }

    const { success, error } = await submitReturn(payload)

    setSubmitting(false)

    if (!success) {
      toast({
        title: 'Error',
        description: error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล',
        variant: 'destructive',
      })
      return
    }

    toast({
      title: 'Success',
      description: 'บันทึกข้อมูลการรับคืนเรียบร้อยแล้ว',
    })

    onSuccess()
  }

  return (
    <Sheet open={open} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Return Order
          </SheetTitle>
          <SheetDescription>
            Order: {order.external_order_id || order.order_id}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Order Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Platform:</span>
              <span className="font-medium">
                {order.source_platform || order.marketplace}
              </span>
            </div>
            {order.tracking_number && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Tracking:</span>
                <Badge variant="outline">{order.tracking_number}</Badge>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge>{order.status_group || order.platform_status}</Badge>
            </div>
            {order.shipped_at && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Shipped:</span>
                <span>{new Date(order.shipped_at).toLocaleDateString('th-TH')}</span>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div>
            <h3 className="text-sm font-medium mb-3">รายการสินค้า</h3>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Returned</TableHead>
                    <TableHead className="text-right">To Return</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.line_items.map((item, index) => {
                    const state = lineItems[index]
                    const available = item.quantity - item.qty_returned

                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium text-xs font-mono">{item.sku}</div>
                            {item.seller_sku && (
                              <div className="text-xs text-muted-foreground">
                                → {item.seller_sku}
                              </div>
                            )}
                            {item.sku_internal && item.sku_internal !== item.seller_sku && (
                              <div className="text-xs text-blue-600 font-medium">
                                internal: {item.sku_internal}
                              </div>
                            )}
                            <div className="text-xs text-muted-foreground">
                              {item.product_name}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {item.qty_returned > 0 ? (
                            <Badge variant="secondary">{item.qty_returned}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {available === 0 ? (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              คืนครบ
                            </Badge>
                          ) : (
                            <Input
                              type="number"
                              min="0"
                              max={available}
                              value={state.qty_to_return || ''}
                              onChange={(e) => handleQtyChange(item.id, e.target.value)}
                              className="w-20 text-right"
                              disabled={submitting}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={state.return_type}
                            onValueChange={(value) =>
                              handleReturnTypeChange(item.id, value as ReturnType)
                            }
                            disabled={submitting}
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(RETURN_TYPE_LABELS).map(([key, label]) => (
                                <SelectItem key={key} value={key}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <label className="text-sm font-medium">หมายเลข Order Marketplace</label>
            <Textarea
              placeholder="เลขออร์เดอร์ TikTok/Shopee (ใช้ป้องกันการบันทึกซ้ำ)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              rows={3}
            />
          </div>

          {/* Missing seller_sku warning */}
          {lineItems.some((item) => {
            const orderItem = order.line_items.find((i) => i.id === item.line_item_id)
            return item.qty_to_return > 0 && !orderItem?.seller_sku
          }) && (
            <Alert variant="destructive">
              <AlertDescription>
                บางรายการไม่มี seller_sku — กรุณาตั้งค่า{' '}
                <a href="/sku-mappings" className="underline font-medium">
                  SKU Mapping
                </a>{' '}
                หรือ Fix Missing SKU ก่อนรับคืน
              </AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'Confirm Return'
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
