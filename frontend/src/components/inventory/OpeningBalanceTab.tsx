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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBangkok } from '@/lib/bangkok-time'
import { Pencil, Trash2 } from 'lucide-react'
import {
  getInventoryItems,
  recordOpeningBalance,
  getReceiptLayers,
  updateOpeningBalanceLayer,
  voidOpeningBalanceWithReversal,
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

  // Form state (new record)
  const [selectedSku, setSelectedSku] = useState('')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState(formatBangkok(new Date(), 'yyyy-MM-dd'))
  const [saving, setSaving] = useState(false)

  // Edit modal state
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingLayer, setEditingLayer] = useState<ReceiptLayer | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editQty, setEditQty] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirm state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deletingLayer, setDeletingLayer] = useState<ReceiptLayer | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)

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

  // Check if layer can be edited/deleted
  function isLayerLocked(layer: ReceiptLayer): boolean {
    return layer.qty_remaining < layer.qty_received
  }

  // Open edit modal
  function openEditModal(layer: ReceiptLayer) {
    setEditingLayer(layer)
    setEditDate(formatBangkok(new Date(layer.received_at), 'yyyy-MM-dd'))
    setEditQty(layer.qty_received.toString())
    setEditCost(layer.unit_cost.toString())
    setShowEditDialog(true)
  }

  // Handle edit submit
  async function handleEditSubmit() {
    if (!editingLayer || !editDate || !editQty || !editCost) {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }

    if (parseFloat(editQty) <= 0) {
      alert('Quantity ต้องมากกว่า 0')
      return
    }

    if (parseFloat(editCost) < 0) {
      alert('Unit Cost ต้องไม่ติดลบ')
      return
    }

    setEditSaving(true)
    const result = await updateOpeningBalanceLayer(editingLayer.id, {
      received_at: `${editDate}T00:00:00+07:00`,
      qty_received: parseFloat(editQty),
      unit_cost: parseFloat(editCost),
    })

    if (result.success) {
      alert('แก้ไข Opening Balance สำเร็จ')
      setShowEditDialog(false)
      loadData()
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
    setEditSaving(false)
  }

  // Open delete confirm
  function openDeleteConfirm(layer: ReceiptLayer) {
    setDeletingLayer(layer)
    setShowDeleteDialog(true)
  }

  // Handle delete confirm
  async function handleDeleteConfirm() {
    if (!deletingLayer) return

    setDeleteSaving(true)
    const result = await voidOpeningBalanceWithReversal(
      deletingLayer.id,
      'Manual void from Opening Balance tab'
    )

    if (result.success) {
      alert('ลบ Opening Balance สำเร็จ')
      setShowDeleteDialog(false)
      loadData()
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
    setDeleteSaving(false)
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layers.map((layer) => {
                const locked = isLayerLocked(layer)
                return (
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(layer)}
                          disabled={locked}
                          title={
                            locked
                              ? 'Cannot edit: layer has been consumed by COGS allocations'
                              : 'Edit opening balance'
                          }
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDeleteConfirm(layer)}
                          disabled={locked}
                          title={
                            locked
                              ? 'Cannot delete: layer has been consumed by COGS allocations'
                              : 'Delete opening balance'
                          }
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Opening Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>SKU</Label>
              <Input value={editingLayer?.sku_internal || ''} disabled />
            </div>
            <div>
              <Label htmlFor="edit-date">Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-qty">Quantity</Label>
              <Input
                id="edit-qty"
                type="number"
                step="0.0001"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-cost">Unit Cost</Label>
              <Input
                id="edit-cost"
                type="number"
                step="0.01"
                value={editCost}
                onChange={(e) => setEditCost(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              disabled={editSaving}
            >
              ยกเลิก
            </Button>
            <Button onClick={handleEditSubmit} disabled={editSaving}>
              {editSaving ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ Opening Balance</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการลบ Opening Balance ของ{' '}
              <span className="font-semibold">{deletingLayer?.sku_internal}</span> หรือไม่?
              <br />
              (Qty: {deletingLayer?.qty_received.toFixed(4)}, Cost:{' '}
              {deletingLayer?.unit_cost.toFixed(2)})
              <br />
              <br />
              การลบนี้จะทำเป็น soft delete (void) และไม่สามารถกู้คืนได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteSaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSaving ? 'กำลังลบ...' : 'ลบ'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
