'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  getSkuMappings,
  upsertSkuMapping,
  deleteSkuMapping,
  getInventoryItemsForMapping,
} from '@/app/(dashboard)/returns/actions'
import { SkuMappingRow } from '@/types/returns'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Plus, RefreshCw, Pencil, Trash2, X, Check } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const CHANNELS = ['tiktok', 'shopee', 'lazada'] as const
type Channel = (typeof CHANNELS)[number]

const CHANNEL_COLORS: Record<Channel, string> = {
  tiktok: 'bg-black text-white',
  shopee: 'bg-orange-500 text-white',
  lazada: 'bg-blue-600 text-white',
}

interface FormState {
  id?: string
  channel: string
  marketplace_sku: string
  sku_internal: string
}

const EMPTY_FORM: FormState = {
  channel: '',
  marketplace_sku: '',
  sku_internal: '',
}

export function SkuMappingsClient() {
  const { toast } = useToast()

  const [mappings, setMappings] = useState<SkuMappingRow[]>([])
  const [inventoryItems, setInventoryItems] = useState<
    { sku_internal: string; product_name: string }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)

  // Edit state: which row is being edited
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [mappingsResult, itemsResult] = await Promise.all([
      getSkuMappings(),
      getInventoryItemsForMapping(),
    ])

    if (mappingsResult.error) {
      setError(mappingsResult.error)
    } else {
      setMappings(mappingsResult.data || [])
    }

    if (!itemsResult.error && itemsResult.data) {
      setInventoryItems(itemsResult.data)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ---------------------------------------------------------------------------
  // Add
  // ---------------------------------------------------------------------------

  function openAddForm() {
    setAddForm(EMPTY_FORM)
    setShowAddForm(true)
    setEditingId(null)
  }

  function cancelAdd() {
    setShowAddForm(false)
    setAddForm(EMPTY_FORM)
  }

  async function handleAdd() {
    if (!addForm.channel || !addForm.marketplace_sku.trim() || !addForm.sku_internal) {
      toast({
        title: 'กรุณากรอกข้อมูลให้ครบ',
        description: 'Channel, Marketplace SKU และ SKU Internal จำเป็นต้องระบุ',
        variant: 'destructive',
      })
      return
    }

    setAddSaving(true)
    const result = await upsertSkuMapping({
      channel: addForm.channel,
      marketplace_sku: addForm.marketplace_sku.trim(),
      sku_internal: addForm.sku_internal,
    })
    setAddSaving(false)

    if (!result.success) {
      toast({
        title: 'เกิดข้อผิดพลาด',
        description: result.error || 'ไม่สามารถบันทึกได้',
        variant: 'destructive',
      })
      return
    }

    toast({ title: 'บันทึกสำเร็จ', description: 'เพิ่ม SKU Mapping เรียบร้อยแล้ว' })
    setShowAddForm(false)
    setAddForm(EMPTY_FORM)
    await loadData()
  }

  // ---------------------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------------------

  function startEdit(row: SkuMappingRow) {
    setEditingId(row.id)
    setEditForm({
      id: row.id,
      channel: row.channel,
      marketplace_sku: row.marketplace_sku,
      sku_internal: row.sku_internal,
    })
    setShowAddForm(false)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(EMPTY_FORM)
  }

  async function handleEdit() {
    if (!editForm.channel || !editForm.marketplace_sku.trim() || !editForm.sku_internal) {
      toast({
        title: 'กรุณากรอกข้อมูลให้ครบ',
        description: 'Channel, Marketplace SKU และ SKU Internal จำเป็นต้องระบุ',
        variant: 'destructive',
      })
      return
    }

    setEditSaving(true)
    const result = await upsertSkuMapping({
      id: editForm.id,
      channel: editForm.channel,
      marketplace_sku: editForm.marketplace_sku.trim(),
      sku_internal: editForm.sku_internal,
    })
    setEditSaving(false)

    if (!result.success) {
      toast({
        title: 'เกิดข้อผิดพลาด',
        description: result.error || 'ไม่สามารถบันทึกได้',
        variant: 'destructive',
      })
      return
    }

    toast({ title: 'บันทึกสำเร็จ', description: 'อัปเดต SKU Mapping เรียบร้อยแล้ว' })
    setEditingId(null)
    setEditForm(EMPTY_FORM)
    await loadData()
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async function handleDelete(id: string) {
    setDeleteLoading(true)
    const result = await deleteSkuMapping(id)
    setDeleteLoading(false)

    if (!result.success) {
      toast({
        title: 'เกิดข้อผิดพลาด',
        description: result.error || 'ไม่สามารถลบได้',
        variant: 'destructive',
      })
      return
    }

    toast({ title: 'ลบสำเร็จ', description: 'ลบ SKU Mapping เรียบร้อยแล้ว' })
    setDeletingId(null)
    await loadData()
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getProductName(skuInternal: string) {
    const item = inventoryItems.find((i) => i.sku_internal === skuInternal)
    return item?.product_name || ''
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderChannelBadge(channel: string) {
    const colorClass = CHANNEL_COLORS[channel as Channel] || 'bg-gray-200 text-gray-800'
    return (
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}
      >
        {channel}
      </span>
    )
  }

  function SkuSelect({
    value,
    onChange,
    disabled,
  }: {
    value: string
    onChange: (v: string) => void
    disabled?: boolean
  }) {
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="เลือก SKU Internal" />
        </SelectTrigger>
        <SelectContent>
          {inventoryItems.map((item) => (
            <SelectItem key={item.sku_internal} value={item.sku_internal}>
              {item.sku_internal}
              {item.product_name ? ` — ${item.product_name}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  function ChannelSelect({
    value,
    onChange,
    disabled,
  }: {
    value: string
    onChange: (v: string) => void
    disabled?: boolean
  }) {
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="เลือก Channel" />
        </SelectTrigger>
        <SelectContent>
          {CHANNELS.map((ch) => (
            <SelectItem key={ch} value={ch}>
              {ch}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SKU Mappings (Marketplace → Canonical)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            จัดการการ map TikTok/Shopee variant IDs ไปยัง sku_internal ที่ใช้ในระบบ Inventory
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={openAddForm} disabled={loading}>
            <Plus className="h-4 w-4 mr-1" />
            Add Mapping
          </Button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Add form */}
      {showAddForm && (
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">เพิ่ม SKU Mapping ใหม่</CardTitle>
            <CardDescription>
              กรอก Channel, Marketplace SKU (variant ID จาก TikTok/Shopee) และ SKU Internal
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Channel</label>
                <ChannelSelect
                  value={addForm.channel}
                  onChange={(v) => setAddForm((f) => ({ ...f, channel: v }))}
                  disabled={addSaving}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Marketplace SKU</label>
                <Input
                  placeholder="เช่น 1729996689533143570"
                  value={addForm.marketplace_sku}
                  onChange={(e) => setAddForm((f) => ({ ...f, marketplace_sku: e.target.value }))}
                  disabled={addSaving}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">SKU Internal</label>
                <SkuSelect
                  value={addForm.sku_internal}
                  onChange={(v) => setAddForm((f) => ({ ...f, sku_internal: v }))}
                  disabled={addSaving}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={cancelAdd} disabled={addSaving}>
                <X className="h-3.5 w-3.5 mr-1" />
                ยกเลิก
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={addSaving}>
                {addSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1" />
                )}
                บันทึก
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : mappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-muted-foreground font-medium">ยังไม่มี SKU Mapping</p>
              <p className="text-sm text-muted-foreground mt-1">
                กด "Add Mapping" เพื่อเพิ่ม mapping ระหว่าง marketplace variant ID กับ sku_internal
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Channel</TableHead>
                  <TableHead>Marketplace SKU</TableHead>
                  <TableHead>SKU Internal (product_name)</TableHead>
                  <TableHead className="text-right w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((row) => {
                  const isEditing = editingId === row.id
                  const isDeleting = deletingId === row.id

                  if (isEditing) {
                    return (
                      <TableRow key={row.id} className="bg-blue-50/50">
                        <TableCell>
                          <ChannelSelect
                            value={editForm.channel}
                            onChange={(v) => setEditForm((f) => ({ ...f, channel: v }))}
                            disabled={editSaving}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={editForm.marketplace_sku}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, marketplace_sku: e.target.value }))
                            }
                            disabled={editSaving}
                            className="min-w-[180px]"
                          />
                        </TableCell>
                        <TableCell>
                          <SkuSelect
                            value={editForm.sku_internal}
                            onChange={(v) => setEditForm((f) => ({ ...f, sku_internal: v }))}
                            disabled={editSaving}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={cancelEdit}
                              disabled={editSaving}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" onClick={handleEdit} disabled={editSaving}>
                              {editSaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  if (isDeleting) {
                    return (
                      <TableRow key={row.id} className="bg-red-50/50">
                        <TableCell colSpan={3}>
                          <span className="text-sm text-destructive font-medium">
                            ยืนยันลบ mapping "{row.channel} / {row.marketplace_sku}" ?
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeletingId(null)}
                              disabled={deleteLoading}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(row.id)}
                              disabled={deleteLoading}
                            >
                              {deleteLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  const productName = getProductName(row.sku_internal)

                  return (
                    <TableRow key={row.id}>
                      <TableCell>{renderChannelBadge(row.channel)}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {row.marketplace_sku}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium text-sm">{row.sku_internal}</span>
                          {productName && (
                            <span className="text-xs text-muted-foreground ml-2">
                              — {productName}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(row)}
                            disabled={!!editingId || !!deletingId}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeletingId(row.id)}
                            disabled={!!editingId || !!deletingId}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        รวม {mappings.length} mapping
      </p>
    </div>
  )
}
