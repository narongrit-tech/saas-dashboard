'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Plus, Pencil, Trash2, Package, FileEdit } from 'lucide-react'
import { getInventoryItems, upsertInventoryItem, deleteInventoryItem, getInventoryAvailabilityMaps, checkIsInventoryAdmin } from '@/app/(dashboard)/inventory/actions'
import { StockInModal } from '@/components/inventory/StockInModal'
import { RenameSkuModal } from '@/components/inventory/RenameSkuModal'

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
  const [saving, setSaving] = useState(false)

  // Admin and Stock In state
  const [isAdmin, setIsAdmin] = useState(false)
  const [onHandMap, setOnHandMap] = useState<Record<string, number>>({})
  const [reservedMap, setReservedMap] = useState<Record<string, number>>({})
  const [availableMap, setAvailableMap] = useState<Record<string, number>>({})
  const [showStockInModal, setShowStockInModal] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [selectedSku, setSelectedSku] = useState('')

  useEffect(() => {
    loadItems()
    checkAdmin()
  }, [])

  async function loadItems() {
    setLoading(true)
    const result = await getInventoryItems()
    if (result.success) {
      // Filter to show only main SKUs (not bundles)
      const mainProducts = result.data.filter(item => !item.is_bundle)
      setItems(mainProducts)
    }
    setLoading(false)
    // Load availability maps (on hand, reserved, available)
    loadAvailabilityMaps()
  }

  async function checkAdmin() {
    const result = await checkIsInventoryAdmin()
    if (result.success) {
      setIsAdmin(result.isAdmin)
    }
  }

  async function loadAvailabilityMaps() {
    const result = await getInventoryAvailabilityMaps()
    if (result.success) {
      setOnHandMap(result.data.on_hand_map)
      setReservedMap(result.data.reserved_map)
      setAvailableMap(result.data.available_map)

      // Log verification for debugging
      console.log('[ProductsTab] Availability loaded:', {
        on_hand_count: Object.keys(result.data.on_hand_map).length,
        reserved_count: Object.keys(result.data.reserved_map).length,
        sample_reserved: Object.entries(result.data.reserved_map).slice(0, 3),
      })
    }
  }

  function openAddDialog() {
    setEditingItem(null)
    setSku('')
    setProductName('')
    setCost('')
    setShowDialog(true)
  }

  function openEditDialog(item: InventoryItem) {
    setEditingItem(item)
    setSku(item.sku_internal)
    setProductName(item.product_name)
    setCost(item.base_cost_per_unit.toString())
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
      is_bundle: false, // Products tab only creates main products, not bundles
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

  function openStockInModal(sku: string) {
    setSelectedSku(sku)
    setShowStockInModal(true)
  }

  function openRenameModal(sku: string) {
    setSelectedSku(sku)
    setShowRenameModal(true)
  }

  function handleStockInSuccess() {
    // Refresh items and availability maps
    loadItems()
    loadAvailabilityMaps()
  }

  function handleRenameSuccess() {
    // Refresh items and availability maps
    loadItems()
    loadAvailabilityMaps()
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
              <TableHead className="text-right">On Hand (คงเหลือ)</TableHead>
              <TableHead className="text-right">Available (พร้อมขาย)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const onHand = onHandMap[item.sku_internal] || 0
              const reserved = reservedMap[item.sku_internal] || 0
              const available = availableMap[item.sku_internal] || 0

              return (
                <TableRow key={item.id}>
                  <TableCell className="font-mono">{item.sku_internal}</TableCell>
                  <TableCell>{item.product_name}</TableCell>
                  <TableCell className="text-right">
                    {item.base_cost_per_unit.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {onHand.toFixed(4)}
                    {reserved > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (-{reserved.toFixed(4)} reserved)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${available < 0 ? 'text-red-600' : available === 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {available.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openStockInModal(item.sku_internal)}
                          title="Stock In"
                        >
                          <Package className="w-4 h-4 text-blue-600" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(item)}
                        title="Edit Product"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openRenameModal(item.sku_internal)}
                        title="Rename SKU"
                      >
                        <FileEdit className="w-4 h-4 text-orange-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(item.sku_internal)}
                        title="Delete"
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

      {/* Stock In Modal */}
      <StockInModal
        open={showStockInModal}
        onOpenChange={setShowStockInModal}
        sku_internal={selectedSku}
        onSuccess={handleStockInSuccess}
      />

      {/* Rename SKU Modal */}
      <RenameSkuModal
        open={showRenameModal}
        onOpenChange={setShowRenameModal}
        currentSku={selectedSku}
        skuType="product"
        onSuccess={handleRenameSuccess}
      />
    </div>
  )
}
