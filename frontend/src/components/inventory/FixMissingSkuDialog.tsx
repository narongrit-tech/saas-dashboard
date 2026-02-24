'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wrench,
  ChevronDown,
} from 'lucide-react'
import {
  getMissingSkuOrders,
  getInventoryItemsForSku,
  saveSkusAndAllocate,
} from '@/app/(dashboard)/inventory/actions'
import { formatBangkok } from '@/lib/bangkok-time'

interface MissingSkuOrder {
  order_uuid: string
  order_id: string
  quantity: number
  shipped_at: string
}

interface InventoryItem {
  sku_internal: string
  product_name: string
}

interface FixMissingSkuDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  startDate: string
  endDate: string
  onSuccess?: () => void
  onViewRunDetails?: (runId: string, summary: any) => void
}

type Step = 'loading' | 'list' | 'saving' | 'result'

export function FixMissingSkuDialog({
  open,
  onOpenChange,
  startDate,
  endDate,
  onSuccess,
  onViewRunDetails,
}: FixMissingSkuDialogProps) {
  const [step, setStep] = useState<Step>('loading')
  const [orders, setOrders] = useState<MissingSkuOrder[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [skuMap, setSkuMap] = useState<Record<string, string>>({}) // order_uuid -> sku_internal
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, startDate, endDate])

  async function loadData() {
    setStep('loading')
    setError(null)
    setSkuMap({})
    setSelected(new Set())
    setResult(null)

    const [ordersResult, itemsResult] = await Promise.all([
      getMissingSkuOrders({ startDate, endDate }),
      getInventoryItemsForSku(),
    ])

    if (!ordersResult.success) {
      setError(ordersResult.error || 'ไม่สามารถดึงข้อมูล orders ได้')
      setStep('list')
      return
    }

    if (!itemsResult.success || !itemsResult.data) {
      setError('ไม่สามารถดึงข้อมูล SKU ได้')
      setStep('list')
      return
    }

    setOrders(ordersResult.data || [])
    setInventoryItems(itemsResult.data)
    setStep('list')
  }

  function handleSkuChange(order_uuid: string, sku: string) {
    setSkuMap(prev => ({ ...prev, [order_uuid]: sku }))
    // Auto-select the row when a SKU is assigned
    if (sku) {
      setSelected(prev => new Set([...prev, order_uuid]))
    }
  }

  function toggleSelect(order_uuid: string) {
    // Cannot select a row that has no SKU assigned
    if (!skuMap[order_uuid]) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(order_uuid)) next.delete(order_uuid)
      else next.add(order_uuid)
      return next
    })
  }

  function selectAll() {
    const allWithSku = orders
      .filter(o => skuMap[o.order_uuid])
      .map(o => o.order_uuid)
    setSelected(new Set(allWithSku))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleSaveAndAllocate() {
    const updates = Array.from(selected)
      .filter(uuid => skuMap[uuid])
      .map(uuid => ({ order_uuid: uuid, sku_internal: skuMap[uuid] }))

    if (updates.length === 0) {
      setError('กรุณาเลือก orders และกำหนด SKU อย่างน้อย 1 รายการ')
      return
    }

    setStep('saving')
    setError(null)

    const response = await saveSkusAndAllocate({ updates, method: 'FIFO' })

    if (!response.success) {
      setError(response.error || 'เกิดข้อผิดพลาด')
      setStep('list')
      return
    }

    setResult(response.data)
    setStep('result')
    if (onSuccess) onSuccess()
  }

  function handleClose() {
    setStep('loading')
    setResult(null)
    setError(null)
    onOpenChange(false)
  }

  const ordersWithSku = orders.filter(o => skuMap[o.order_uuid]).length
  const selectedWithSku = Array.from(selected).filter(uuid => skuMap[uuid]).length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-orange-500" />
            Fix Missing SKU
          </DialogTitle>
          <DialogDescription>
            กำหนด SKU สำหรับ orders ที่ยังไม่มี seller_sku แล้ว Apply COGS
          </DialogDescription>
        </DialogHeader>

        {/* Loading */}
        {step === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-muted-foreground">กำลังโหลด orders...</span>
          </div>
        )}

        {/* List / Saving */}
        {(step === 'list' || step === 'saving') && (
          <div className="space-y-4">
            {/* Date range info */}
            <div className="text-sm text-muted-foreground px-3 py-2 bg-muted/30 rounded-md">
              ช่วงวันที่:{' '}
              <strong>{startDate}</strong> ถึง <strong>{endDate}</strong>
              {' · '}
              พบ <strong>{orders.length}</strong> orders ที่ไม่มี seller_sku และยังไม่ถูก allocate
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {orders.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                ไม่มี orders ที่ต้องแก้ไขในช่วงวันที่นี้
              </div>
            ) : (
              <>
                {/* Controls */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    กำหนด SKU แล้ว{' '}
                    <strong>{ordersWithSku}</strong>/{orders.length}{' '}
                    · เลือกแล้ว{' '}
                    <strong>{selectedWithSku}</strong> รายการ
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAll}
                      disabled={step === 'saving' || ordersWithSku === 0}
                    >
                      เลือกทั้งหมด (มี SKU)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearAll}
                      disabled={step === 'saving'}
                    >
                      ยกเลิกทั้งหมด
                    </Button>
                  </div>
                </div>

                {/* Orders table */}
                <div className="rounded-md border max-h-[380px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 text-center">
                          <Checkbox
                            checked={
                              ordersWithSku > 0 &&
                              selectedWithSku === ordersWithSku
                            }
                            onCheckedChange={(checked) => {
                              if (checked) selectAll()
                              else clearAll()
                            }}
                            disabled={step === 'saving' || ordersWithSku === 0}
                            aria-label="Select all"
                          />
                        </TableHead>
                        <TableHead>Order ID</TableHead>
                        <TableHead className="text-right w-16">Qty</TableHead>
                        <TableHead className="w-28">Shipped At</TableHead>
                        <TableHead className="min-w-[220px]">กำหนด SKU</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map(order => {
                        const hasSku = Boolean(skuMap[order.order_uuid])
                        const isSelected = selected.has(order.order_uuid)
                        return (
                          <TableRow
                            key={order.order_uuid}
                            className={isSelected ? 'bg-orange-50 dark:bg-orange-950/20' : ''}
                          >
                            <TableCell className="text-center">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(order.order_uuid)}
                                disabled={step === 'saving' || !hasSku}
                                aria-label={`Select ${order.order_id}`}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {order.order_id}
                            </TableCell>
                            <TableCell className="text-right">
                              {order.quantity}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatBangkok(new Date(order.shipped_at), 'dd/MM/yyyy')}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={skuMap[order.order_uuid] || ''}
                                onValueChange={(val) => handleSkuChange(order.order_uuid, val)}
                                disabled={step === 'saving'}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="-- เลือก SKU --" />
                                </SelectTrigger>
                                <SelectContent>
                                  {inventoryItems.map(item => (
                                    <SelectItem
                                      key={item.sku_internal}
                                      value={item.sku_internal}
                                    >
                                      {item.sku_internal} — {item.product_name}
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
              </>
            )}
          </div>
        )}

        {/* Result */}
        {step === 'result' && result && (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>เสร็จสิ้น</AlertTitle>
              <AlertDescription>
                บันทึก SKU และ Apply COGS เรียบร้อยแล้ว
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{result.total}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Successful</p>
                <p className="text-2xl font-bold text-green-600">{result.successful}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Skipped / Failed</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {(result.skipped ?? 0) + (result.failed ?? 0)}
                </p>
              </div>
            </div>

            {result.run_id && onViewRunDetails && (
              <div className="border rounded-md p-3 bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Run ID</p>
                  <p className="text-xs font-mono text-blue-600">{result.run_id}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onViewRunDetails(result.run_id, {
                      total: result.total,
                      successful: result.successful,
                      skipped: result.skipped,
                      failed: result.failed,
                      partial: result.partial,
                    })
                  }
                >
                  View Details
                </Button>
              </div>
            )}

            {/* Skip reasons breakdown */}
            {result.skip_reasons && result.skip_reasons.length > 0 && (
              <Collapsible className="space-y-2 border rounded-md p-4">
                <CollapsibleTrigger className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <ChevronDown className="h-4 w-4" />
                    <p className="text-sm font-semibold">
                      Skip Reasons ({result.skip_reasons.length} categories)
                    </p>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  {result.skip_reasons.map((reason: any, idx: number) => (
                    <div
                      key={idx}
                      className="border-l-4 border-yellow-500 pl-3 py-2 bg-yellow-50/50"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-sm">{reason.label}</p>
                        <Badge variant="secondary">{reason.count} orders</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Code: <span className="font-mono">{reason.code}</span>
                      </p>
                      {reason.samples && reason.samples.length > 0 && (
                        <div className="space-y-1">
                          {reason.samples.map((sample: any, sIdx: number) => (
                            <div
                              key={sIdx}
                              className="text-xs flex items-center gap-2 bg-white rounded px-2 py-1"
                            >
                              <span className="font-mono text-blue-600">
                                {sample.order_id}
                              </span>
                              {sample.sku && (
                                <span className="text-muted-foreground">
                                  SKU: {sample.sku}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'list' && (
            <>
              <Button type="button" variant="outline" onClick={handleClose}>
                ปิด
              </Button>
              {orders.length > 0 && (
                <Button
                  type="button"
                  onClick={handleSaveAndAllocate}
                  disabled={selectedWithSku === 0}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  Save &amp; Allocate ({selectedWithSku})
                </Button>
              )}
            </>
          )}
          {step === 'saving' && (
            <Button type="button" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              กำลังบันทึกและ allocate...
            </Button>
          )}
          {step === 'result' && (
            <Button type="button" onClick={handleClose}>
              ปิด
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
