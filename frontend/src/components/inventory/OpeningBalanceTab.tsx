'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBangkok } from '@/lib/bangkok-time'
import {
  getInventoryItems,
  recordOpeningBalance,
  getReceiptLayers,
} from '@/app/(dashboard)/inventory/actions'

interface InventoryItem {
  sku_internal: string
  product_name: string
}

interface ReceiptLayer {
  id: string
  sku_internal: string
  received_at: string
  qty_received: number
  qty_remaining: number
  unit_cost: number
  ref_type: string
}

export function OpeningBalanceTab() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [layers, setLayers] = useState<ReceiptLayer[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedSku, setSelectedSku] = useState('')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState(formatBangkok(new Date(), 'yyyy-MM-dd'))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [itemsResult, layersResult] = await Promise.all([
      getInventoryItems(),
      getReceiptLayers(),
    ])

    if (itemsResult.success) {
      setItems(itemsResult.data)
    }
    if (layersResult.success) {
      // Filter only opening balances
      const openingBalances = layersResult.data.filter(
        (l: ReceiptLayer) => l.ref_type === 'OPENING_BALANCE'
      )
      setLayers(openingBalances)
    }
    setLoading(false)
  }

  async function handleSubmit() {
    if (!selectedSku || !qty || !unitCost || !date) {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }

    if (parseFloat(qty) <= 0) {
      alert('Quantity ต้องมากกว่า 0')
      return
    }

    if (parseFloat(unitCost) < 0) {
      alert('Unit Cost ต้องไม่ติดลบ')
      return
    }

    setSaving(true)
    const result = await recordOpeningBalance({
      sku_internal: selectedSku,
      qty: parseFloat(qty),
      unit_cost: parseFloat(unitCost),
      date,
    })

    if (result.success) {
      alert('บันทึก Opening Balance สำเร็จ')
      setSelectedSku('')
      setQty('')
      setUnitCost('')
      setDate(formatBangkok(new Date(), 'yyyy-MM-dd'))
      loadData()
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Record Opening Balance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sku">SKU Internal</Label>
              <Select value={selectedSku} onValueChange={setSelectedSku}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือก SKU" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.sku_internal} value={item.sku_internal}>
                      {item.sku_internal} - {item.product_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="date">Date (วันที่เริ่มต้น)</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                step="0.0001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="cost">Unit Cost</Label>
              <Input
                id="cost"
                type="number"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก Opening Balance'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-lg font-semibold mb-4">Opening Balances History</h3>
        {loading ? (
          <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
        ) : layers.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">
            ยังไม่มี Opening Balance ในระบบ
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Qty Received</TableHead>
                <TableHead className="text-right">Qty Remaining</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layers.map((layer) => (
                <TableRow key={layer.id}>
                  <TableCell className="font-mono">{layer.sku_internal}</TableCell>
                  <TableCell>
                    {formatBangkok(new Date(layer.received_at), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell className="text-right">
                    {layer.qty_received.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right">
                    {layer.qty_remaining.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right">
                    {layer.unit_cost.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {(layer.qty_received * layer.unit_cost).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
