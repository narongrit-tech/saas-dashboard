'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Pencil, Trash2, Search, UserCheck } from 'lucide-react'
import { InternalAffiliate, CreateAffiliateInput, UpdateAffiliateInput } from '@/types/affiliates'
import {
  getInternalAffiliates,
  createInternalAffiliate,
  updateInternalAffiliate,
  deleteInternalAffiliate
} from './actions'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

export default function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<InternalAffiliate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedAffiliate, setSelectedAffiliate] = useState<InternalAffiliate | null>(null)
  const [processing, setProcessing] = useState(false)

  // Form states
  const [formData, setFormData] = useState<CreateAffiliateInput>({
    channel_id: '',
    display_name: '',
    notes: ''
  })

  useEffect(() => {
    fetchAffiliates()
  }, [])

  const fetchAffiliates = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getInternalAffiliates()
      if (result.success) {
        setAffiliates(result.data || [])
      } else {
        setError(result.error || 'เกิดข้อผิดพลาด')
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setFormData({ channel_id: '', display_name: '', notes: '' })
    setShowAddDialog(true)
  }

  const handleEdit = (affiliate: InternalAffiliate) => {
    setSelectedAffiliate(affiliate)
    setFormData({
      channel_id: affiliate.channel_id,
      display_name: affiliate.display_name || '',
      notes: affiliate.notes || ''
    })
    setShowEditDialog(true)
  }

  const handleDeleteClick = (affiliate: InternalAffiliate) => {
    setSelectedAffiliate(affiliate)
    setShowDeleteDialog(true)
  }

  const handleSubmitAdd = async () => {
    if (!formData.channel_id.trim()) {
      setError('กรุณากรอก Channel ID')
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const result = await createInternalAffiliate(formData)
      if (result.success) {
        setShowAddDialog(false)
        fetchAffiliates()
      } else {
        setError(result.error || 'เกิดข้อผิดพลาด')
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setProcessing(false)
    }
  }

  const handleSubmitEdit = async () => {
    if (!selectedAffiliate) return

    setProcessing(true)
    setError(null)

    try {
      const updateData: UpdateAffiliateInput = {
        channel_id: formData.channel_id,
        display_name: formData.display_name,
        notes: formData.notes
      }

      const result = await updateInternalAffiliate(selectedAffiliate.id, updateData)
      if (result.success) {
        setShowEditDialog(false)
        fetchAffiliates()
      } else {
        setError(result.error || 'เกิดข้อผิดพลาด')
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setProcessing(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!selectedAffiliate) return

    setProcessing(true)
    setError(null)

    try {
      const result = await deleteInternalAffiliate(selectedAffiliate.id)
      if (result.success) {
        setShowDeleteDialog(false)
        fetchAffiliates()
      } else {
        setError(result.error || 'เกิดข้อผิดพลาด')
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการลบ')
    } finally {
      setProcessing(false)
    }
  }

  const handleToggleActive = async (affiliate: InternalAffiliate) => {
    setProcessing(true)
    try {
      const result = await updateInternalAffiliate(affiliate.id, {
        is_active: !affiliate.is_active
      })
      if (result.success) {
        fetchAffiliates()
      } else {
        setError(result.error || 'เกิดข้อผิดพลาด')
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการอัปเดต')
    } finally {
      setProcessing(false)
    }
  }

  const filteredAffiliates = affiliates.filter(
    a =>
      a.channel_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.display_name && a.display_name.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Internal Affiliates</h1>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Affiliate
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 max-w-md">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="ค้นหา Channel ID หรือชื่อ..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Active</TableHead>
              <TableHead>Channel ID</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell><div className="h-4 w-12 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-48 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-20 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-16 animate-pulse rounded bg-gray-200" /></TableCell>
                </TableRow>
              ))
            ) : filteredAffiliates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                    <UserCheck className="h-12 w-12" />
                    <p className="text-lg font-medium">ยังไม่มี Affiliate</p>
                    <p className="text-sm">คลิก "Add Affiliate" เพื่อเพิ่มรายการแรก</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredAffiliates.map((affiliate) => (
                <TableRow key={affiliate.id}>
                  <TableCell>
                    <Checkbox
                      checked={affiliate.is_active}
                      onCheckedChange={() => handleToggleActive(affiliate)}
                      disabled={processing}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{affiliate.channel_id}</TableCell>
                  <TableCell>{affiliate.display_name || '-'}</TableCell>
                  <TableCell>
                    <div className="max-w-xs truncate text-sm text-muted-foreground">
                      {affiliate.notes || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(affiliate.created_at).toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(affiliate)}
                        title="แก้ไข"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(affiliate)}
                        title="ลบ"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Affiliate</DialogTitle>
            <DialogDescription>
              เพิ่ม Internal Affiliate ใหม่สำหรับติดตามยอดขายและ commission
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel_id">Channel ID *</Label>
              <Input
                id="channel_id"
                placeholder="@username หรือ Channel ID"
                value={formData.channel_id}
                onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                TikTok username หรือ Channel ID ที่แสดงในรายงาน
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="display_name">Display Name</Label>
              <Input
                id="display_name"
                placeholder="ชื่อแสดง (ไม่บังคับ)"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="หมายเหตุหรือรายละเอียดเพิ่มเติม (ไม่บังคับ)"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={processing}>
              Cancel
            </Button>
            <Button onClick={handleSubmitAdd} disabled={processing}>
              {processing ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Affiliate</DialogTitle>
            <DialogDescription>
              แก้ไขข้อมูล Internal Affiliate
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_channel_id">Channel ID *</Label>
              <Input
                id="edit_channel_id"
                placeholder="@username หรือ Channel ID"
                value={formData.channel_id}
                onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_display_name">Display Name</Label>
              <Input
                id="edit_display_name"
                placeholder="ชื่อแสดง (ไม่บังคับ)"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_notes">Notes</Label>
              <Textarea
                id="edit_notes"
                placeholder="หมายเหตุหรือรายละเอียดเพิ่มเติม (ไม่บังคับ)"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={processing}>
              Cancel
            </Button>
            <Button onClick={handleSubmitEdit} disabled={processing}>
              {processing ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการลบ Affiliate</DialogTitle>
            <DialogDescription>
              คุณต้องการลบ affiliate "{selectedAffiliate?.channel_id}" ใช่หรือไม่?
              การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={processing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={processing}>
              {processing ? 'กำลังลบ...' : 'ลบ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
