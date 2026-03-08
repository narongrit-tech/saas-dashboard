'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { assignUserRole, removeUserRole } from '@/app/(dashboard)/settings/actions'
import type { UserProfile, Role } from '@/types/settings'
import { Users, AlertCircle, UserX, Info } from 'lucide-react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'

interface Props {
  initialUsers: UserProfile[]
  initialError?: string
  roles: Role[]
}

// Build userId → roleId map from server-provided UserProfile list + roles list
function buildRoleMap(users: UserProfile[], roleList: Role[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const u of users) {
    if (!u.current_role) continue
    const matched = roleList.find((r) => r.display_name === u.current_role)
    if (matched) map[u.id] = matched.id
  }
  return map
}

export function UsersClient({ initialUsers, initialError, roles }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null)

  // Controlled select state: userId → roleId (UUID)
  // Initialized from server data; re-synced whenever initialUsers/roles change (after router.refresh)
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>(() =>
    buildRoleMap(initialUsers, roles)
  )

  useEffect(() => {
    setSelectedRoles(buildRoleMap(initialUsers, roles))
  }, [initialUsers, roles])

  const handleAssignRole = useCallback(
    (userId: string, roleId: string) => {
      if (!roleId) return
      const prevRoleId = selectedRoles[userId] // save for rollback

      // Optimistic update
      setSelectedRoles((prev) => ({ ...prev, [userId]: roleId }))
      setLoadingUserId(userId)

      startTransition(async () => {
        const result = await assignUserRole(userId, roleId)
        setLoadingUserId(null)
        if (result.success) {
          toast({ title: 'กำหนด Role สำเร็จ' })
          router.refresh()
        } else {
          // Rollback to previous persisted value
          setSelectedRoles((prev) => ({ ...prev, [userId]: prevRoleId ?? '' }))
          toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
        }
      })
    },
    [selectedRoles, startTransition, toast, router]
  )

  function handleRemoveRole(userId: string, roleId: string) {
    setLoadingUserId(userId)
    startTransition(async () => {
      const result = await removeUserRole(userId, roleId)
      setLoadingUserId(null)
      if (result.success) {
        // Clear the select for this user optimistically
        setSelectedRoles((prev) => {
          const next = { ...prev }
          delete next[userId]
          return next
        })
        toast({ title: 'ลบ Role สำเร็จ' })
        router.refresh()
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  function formatDate(dateStr?: string | null) {
    if (!dateStr) return '-'
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: th })
    } catch {
      return '-'
    }
  }

  // Find the Role object by roleId (from selectedRoles map) — used for remove button
  function getAssignedRole(userId: string): Role | undefined {
    const roleId = selectedRoles[userId]
    return roleId ? roles.find((r) => r.id === roleId) : undefined
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">จัดการผู้ใช้</h1>
        <p className="text-muted-foreground mt-1">รายชื่อผู้ใช้ที่มีสิทธิ์เข้าถึงระบบ</p>
      </div>

      {/* Info Banner */}
      <Alert className="border-blue-200 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          ระบบรองรับผู้ใช้สูงสุด 5 คน (Internal Team) การเพิ่มผู้ใช้ใหม่ต้องผ่าน Google OAuth
        </AlertDescription>
      </Alert>

      {/* Error */}
      {initialError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {initialError}
            {initialError.includes('SERVICE_ROLE_KEY') && (
              <span className="block mt-1 text-xs">
                กรุณาเพิ่ม SUPABASE_SERVICE_ROLE_KEY ใน .env.local แล้วรีสตาร์ทเซิร์ฟเวอร์
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            ผู้ใช้ทั้งหมด ({initialUsers.length})
          </CardTitle>
          <CardDescription>
            จัดการสิทธิ์การเข้าถึงระบบสำหรับสมาชิกในทีม
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialUsers.length === 0 && !initialError ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              ไม่พบข้อมูลผู้ใช้
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>Role ปัจจุบัน</TableHead>
                  <TableHead>วันที่เข้าร่วม</TableHead>
                  <TableHead className="w-52">กำหนด Role</TableHead>
                  <TableHead className="w-24">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialUsers.map((user) => {
                  const assignedRole = getAssignedRole(user.id)
                  const currentRoleId = selectedRoles[user.id] ?? ''
                  const isLoading = loadingUserId === user.id && isPending

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium text-sm">{user.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.full_name ?? '-'}
                      </TableCell>
                      <TableCell>
                        {assignedRole ? (
                          <Badge variant="secondary">{assignedRole.display_name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">ไม่มี Role</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(user.created_at)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={currentRoleId}
                          disabled={isLoading || roles.length === 0}
                          onValueChange={(roleId) => handleAssignRole(user.id, roleId)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="เลือก Role..." />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((role) => (
                              <SelectItem key={role.id} value={role.id}>
                                {role.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {assignedRole && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isLoading}
                                className="h-8 px-2 text-destructive hover:text-destructive"
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>ยืนยันการลบ Role</AlertDialogTitle>
                                <AlertDialogDescription>
                                  ต้องการลบ Role &ldquo;{assignedRole.display_name}&rdquo; ออกจาก{' '}
                                  <strong>{user.email}</strong> ใช่หรือไม่?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleRemoveRole(user.id, assignedRole.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  ลบ Role
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
