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
import { Plus, Trash2 } from 'lucide-react'
import {
  getInventoryItems,
  getBundles,
  getBundleComponents,
  upsertBundleRecipe,
} from '@/app/(dashboard)/inventory/actions'

interface InventoryItem {
  sku_internal: string
  product_name: string
  is_bundle: boolean
}

interface Bundle {
  sku_internal: string
  product_name: string
  base_cost_per_unit: number
}

interface BundleComponent {
  component_sku: string
  quantity: number
}

interface ComponentRow extends BundleComponent {
  product_name?: string
}

export function BundlesTab() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedBundle, setSelectedBundle] = useState('')
  const [components, setComponents] = useState<ComponentRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [itemsResult, bundlesResult] = await Promise.all([
      getInventoryItems(),
      getBundles(),
    ])

    if (itemsResult.success) {
      setItems(itemsResult.data)
    }
    if (bundlesResult.success) {
      setBundles(bundlesResult.data)
    }
    setLoading(false)
  }

  async function loadBundleComponents(bundleSku: string) {
    const result = await getBundleComponents(bundleSku)
    if (result.success) {
      // Enrich with product names
      const enriched = result.data.map((c: BundleComponent) => {
        const item = items.find((i) => i.sku_internal === c.component_sku)
        return {
          ...c,
          product_name: item?.product_name || c.component_sku,
        }
      })
      setComponents(enriched)
    }
  }

  function handleBundleChange(bundleSku: string) {
    setSelectedBundle(bundleSku)
    if (bundleSku) {
      loadBundleComponents(bundleSku)
    } else {
      setComponents([])
    }
  }

  function addComponent() {
    setComponents([...components, { component_sku: '', quantity: 1 }])
  }

  function updateComponent(index: number, field: keyof ComponentRow, value: any) {
    const updated = [...components]
    updated[index] = { ...updated[index], [field]: value }

    // If SKU changed, update product name
    if (field === 'component_sku') {
      const item = items.find((i) => i.sku_internal === value)
      updated[index].product_name = item?.product_name || value
    }

    setComponents(updated)
  }

  function removeComponent(index: number) {
    setComponents(components.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (!selectedBundle) {
      alert('กรุณาเลือก Bundle SKU')
      return
    }

    // Validate components
    for (const comp of components) {
      if (!comp.component_sku || comp.quantity <= 0) {
        alert('กรุณากรอก Component SKU และ Quantity ให้ครบถ้วน')
        return
      }
    }

    setSaving(true)
    const result = await upsertBundleRecipe({
      bundle_sku: selectedBundle,
      components: components.map((c) => ({
        component_sku: c.component_sku,
        quantity: c.quantity,
      })),
    })

    if (result.success) {
      alert('บันทึก Bundle Recipe สำเร็จ')
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bundle Recipe Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="bundle">Bundle SKU</Label>
            <Select value={selectedBundle} onValueChange={handleBundleChange}>
              <SelectTrigger>
                <SelectValue placeholder="เลือก Bundle SKU" />
              </SelectTrigger>
              <SelectContent>
                {bundles.map((bundle) => (
                  <SelectItem key={bundle.sku_internal} value={bundle.sku_internal}>
                    {bundle.sku_internal} - {bundle.product_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBundle && (
            <>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>Components</Label>
                  <Button size="sm" onClick={addComponent}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Component
                  </Button>
                </div>

                {components.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    ยังไม่มี Component (กด Add Component เพื่อเพิ่ม)
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component SKU</TableHead>
                        <TableHead>Product Name</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {components.map((comp, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Select
                              value={comp.component_sku}
                              onValueChange={(value) =>
                                updateComponent(index, 'component_sku', value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="เลือก SKU" />
                              </SelectTrigger>
                              <SelectContent>
                                {items
                                  .filter((i) => !i.is_bundle)
                                  .map((item) => (
                                    <SelectItem
                                      key={item.sku_internal}
                                      value={item.sku_internal}
                                    >
                                      {item.sku_internal}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {comp.product_name || '-'}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.0001"
                              value={comp.quantity}
                              onChange={(e) =>
                                updateComponent(
                                  index,
                                  'quantity',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-24"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeComponent(index)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก Bundle Recipe'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="text-lg font-semibold mb-4">Bundle List</h3>
        {loading ? (
          <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
        ) : bundles.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">
            ยังไม่มี Bundle ในระบบ (สร้าง Product แบบ is_bundle=true ก่อน)
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bundle SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-right">Base Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundles.map((bundle) => (
                <TableRow key={bundle.sku_internal}>
                  <TableCell className="font-mono">{bundle.sku_internal}</TableCell>
                  <TableCell>{bundle.product_name}</TableCell>
                  <TableCell className="text-right">
                    {bundle.base_cost_per_unit.toFixed(2)}
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
