'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { getInventoryItems, upsertInventoryItem, deleteInventoryItem } from '@/app/(dashboard)/inventory/actions'

interface InventoryItem {
  id: string
  sku_internal: string
  product_name: string
  base_cost_per_unit: number
  is_bundle: boolean
  created_at: string
  updated_at: string
}

export function ProductsTab() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  // Form state
  const [sku, setSku] = useState('')
  const [productName, setProductName] = useState('')
  const [cost, setCost] = useState('')
  const [isBundle, setIsBundle] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadItems()
  }, [])

  async function loadItems() {
    setLoading(true)
    const result = await getInventoryItems()
    if (result.success) {
      setItems(result.data)
    }
    setLoading(false)
  }

  function openAddDialog() {
    setEditingItem(null)
    setSku('')
    setProductName('')
    setCost('')
    setIsBundle(false)
    setShowDialog(true)
  }

  function openEditDialog(item: InventoryItem) {
    setEditingItem(item)
    setSku(item.sku_internal)
    setProductName(item.product_name)
    setCost(item.base_cost_per_unit.toString())
    setIsBundle(item.is_bundle)
    setShowDialog(true)
  }

  async function handleSave() {
    if (!sku || !productName || !cost) {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }

    setSaving(true)
    const result = await upsertInventoryItem({
      sku_internal: sku,
      product_name: productName,
      base_cost_per_unit: parseFloat(cost),
      is_bundle: isBundle,
    })

    if (result.success) {
      setShowDialog(false)
      loadItems()
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
    setSaving(false)
  }

  async function handleDelete(sku: string) {
    if (!confirm('ต้องการลบ SKU นี้หรือไม่?')) return

    const result = await deleteInventoryItem(sku)
    if (result.success) {
      loadItems()
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          จัดการ SKU master สำหรับ inventory costing
        </p>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={openAddDialog}>
              <Plus className="w-4 h-4 mr-2" />
              เพิ่ม Product
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingItem ? 'แก้ไข Product' : 'เพิ่ม Product'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sku">SKU Internal</Label>
                <Input
                  id="sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="เช่น SKU001"
                  disabled={!!editingItem}
                />
              </div>
              <div>
                <Label htmlFor="name">Product Name</Label>
                <Input
                  id="name"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="เช่น แก้ว 16oz"
                />
              </div>
              <div>
                <Label htmlFor="cost">Base Cost Per Unit</Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="bundle"
                  checked={isBundle}
                  onCheckedChange={(checked) => setIsBundle(checked as boolean)}
                />
                <Label htmlFor="bundle">Is Bundle (เป็น bundle SKU)</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowDialog(false)}
                  disabled={saving}
                >
                  ยกเลิก
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
      ) : items.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">
          ยังไม่มี Product ในระบบ
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU Internal</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead className="text-right">Base Cost</TableHead>
              <TableHead className="text-center">Is Bundle</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono">{item.sku_internal}</TableCell>
                <TableCell>{item.product_name}</TableCell>
                <TableCell className="text-right">
                  {item.base_cost_per_unit.toFixed(2)}
                </TableCell>
                <TableCell className="text-center">
                  {item.is_bundle ? '✓' : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(item)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(item.sku_internal)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
