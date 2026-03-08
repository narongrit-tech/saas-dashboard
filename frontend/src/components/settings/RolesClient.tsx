'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
  DialogTrigger,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { createRole, updateRole, deleteRole, seedDefaultRoles } from '@/app/(dashboard)/settings/actions'
import type { Role } from '@/types/settings'
import { Plus, Lock, Pencil, Trash2, Shield, Wand2, Check, X } from 'lucide-react'

interface Props {
  initialRoles: Role[]
}

interface EditState {
  id: string
  display_name: string
  description: string
}

export function RolesClient({ initialRoles }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  // Edit inline state
  const [editState, setEditState] = useState<EditState | null>(null)

  function handleCreate() {
    startTransition(async () => {
      const result = await createRole({
        name: newName,
        display_name: newDisplayName,
        description: newDescription,
      })
      if (result.success) {
        toast({ title: 'สร้าง Role สำเร็จ', description: `Role "${newDisplayName}" ถูกสร้างแล้ว` })
        setCreateOpen(false)
        setNewName('')
        setNewDisplayName('')
        setNewDescription('')
        router.refresh()
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleUpdate() {
    if (!editState) return
    startTransition(async () => {
      const result = await updateRole(editState.id, {
        display_name: editState.display_name,
        description: editState.description,
      })
      if (result.success) {
        toast({ title: 'อัปเดต Role สำเร็จ' })
        setEditState(null)
        router.refresh()
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleDelete(id: string, name: string) {
    startTransition(async () => {
      const result = await deleteRole(id)
      if (result.success) {
        toast({ title: 'ลบ Role สำเร็จ', description: `Role "${name}" ถูกลบแล้ว` })
        router.refresh()
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleSeedRoles() {
    startTransition(async () => {
      const result = await seedDefaultRoles()
      if (result.success) {
        toast({ title: 'สร้าง Default Roles สำเร็จ' })
        router.refresh()
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">จัดการ Roles</h1>
          <p className="text-muted-foreground mt-1">
            กำหนด Roles สำหรับการควบคุมสิทธิ์การเข้าถึง
          </p>
        </div>
        <div className="flex gap-2">
          {initialRoles.length === 0 && (
            <Button variant="outline" onClick={handleSeedRoles} disabled={isPending}>
              <Wand2 className="h-4 w-4 mr-2" />
              สร้าง Default Roles
            </Button>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                สร้าง Role ใหม่
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>สร้าง Role ใหม่</DialogTitle>
                <DialogDescription>กำหนดชื่อและรายละเอียดสำหรับ Role ที่กำหนดเอง</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="role-name">
                    ชื่อ Role (ภาษาอังกฤษ ไม่มีช่องว่าง) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="role-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="เช่น finance_manager"
                  />
                  <p className="text-xs text-muted-foreground">
                    จะถูกแปลงเป็นตัวพิมพ์เล็กและใช้ _ แทนช่องว่าง
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role-display">
                    ชื่อแสดง <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="role-display"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="เช่น Finance Manager"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role-desc">คำอธิบาย</Label>
                  <Textarea
                    id="role-desc"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="อธิบายหน้าที่และสิทธิ์ของ Role นี้..."
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  ยกเลิก
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={isPending || !newName.trim() || !newDisplayName.trim()}
                >
                  {isPending ? 'กำลังสร้าง...' : 'สร้าง Role'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Roles Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Roles ทั้งหมด ({initialRoles.length})
          </CardTitle>
          <CardDescription>
            System Roles ไม่สามารถแก้ไขหรือลบได้
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialRoles.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <Shield className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">ยังไม่มี Roles</p>
              <Button variant="outline" size="sm" onClick={handleSeedRoles} disabled={isPending}>
                <Wand2 className="h-4 w-4 mr-2" />
                สร้าง Default Roles เพื่อเริ่มต้น
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ Role</TableHead>
                  <TableHead>ชื่อแสดง</TableHead>
                  <TableHead>คำอธิบาย</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead className="w-28 text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialRoles.map((role) => {
                  const isEditing = editState?.id === role.id

                  return (
                    <TableRow key={role.id}>
                      <TableCell className="font-mono text-sm">{role.name}</TableCell>

                      {/* Display Name — inline edit */}
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editState.display_name}
                            onChange={(e) =>
                              setEditState({ ...editState, display_name: e.target.value })
                            }
                            className="h-8 text-sm"
                            autoFocus
                          />
                        ) : (
                          <span className="font-medium text-sm">{role.display_name}</span>
                        )}
                      </TableCell>

                      {/* Description — inline edit */}
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editState.description}
                            onChange={(e) =>
                              setEditState({ ...editState, description: e.target.value })
                            }
                            className="h-8 text-sm"
                            placeholder="คำอธิบาย..."
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {role.description ?? '-'}
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        {role.is_system ? (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1">
                            <Lock className="h-3 w-3" />
                            System
                          </Badge>
                        ) : (
                          <Badge variant="outline">Custom</Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {role.is_system ? (
                          <span className="text-xs text-muted-foreground">ล็อก</span>
                        ) : isEditing ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
                              onClick={handleUpdate}
                              disabled={isPending}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => setEditState(null)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() =>
                                setEditState({
                                  id: role.id,
                                  display_name: role.display_name,
                                  description: role.description ?? '',
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                  disabled={isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>ยืนยันการลบ Role</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    ต้องการลบ Role &ldquo;{role.display_name}&rdquo; ใช่หรือไม่?
                                    การกระทำนี้จะลบ Permission ทั้งหมดที่กำหนดให้ Role นี้ด้วย
                                    และไม่สามารถกู้คืนได้
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(role.id, role.display_name)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    ลบ Role
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
