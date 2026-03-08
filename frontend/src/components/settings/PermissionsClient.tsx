'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { setRolePermissions as saveRolePermissions } from '@/app/(dashboard)/settings/actions'
import type { Role, Permission } from '@/types/settings'
import { Key, Lock, Save, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  roles: Role[]
  permissions: Permission[]
  initialRolePermissions: Record<string, string[]>
}

// Group permissions by module
function groupByModule(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {}
  for (const p of permissions) {
    if (!groups[p.module]) groups[p.module] = []
    groups[p.module].push(p)
  }
  return groups
}

// Translate module names to Thai
const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  sales_orders: 'Sales Orders',
  expenses: 'Expenses',
  inventory: 'Inventory',
  daily_pnl: 'Daily P&L',
  marketplace_cashflow: 'Marketplace Cashflow',
  wallets: 'Wallets',
  bank: 'Bank',
  reconciliation: 'Reconciliation',
  payables: 'Payables',
  tax_records: 'Tax Records',
  ceo_transactions: 'CEO Transactions',
  imports: 'Imports',
  settings: 'Settings',
  users: 'Users',
  roles: 'Roles',
  permissions: 'Permissions',
  audit_logs: 'Audit Logs',
  notifications: 'Notifications',
  master_data: 'Master Data',
}

const ACTION_LABELS: Record<string, string> = {
  view: 'ดู',
  create: 'สร้าง',
  edit: 'แก้ไข',
  delete: 'ลบ',
  export: 'Export',
  manage: 'จัดการ',
  import: 'Import',
}

export function PermissionsClient({ roles, permissions, initialRolePermissions }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id ?? '')
  // Local state for permission checkboxes
  const [rolePermissions, setRolePermissions] = useState<Record<string, Set<string>>>(() => {
    const state: Record<string, Set<string>> = {}
    for (const [roleId, permIds] of Object.entries(initialRolePermissions)) {
      state[roleId] = new Set(permIds)
    }
    return state
  })

  const selectedRole = roles.find((r) => r.id === selectedRoleId)
  const isSystemRole = selectedRole?.is_system ?? false

  const permsByModule = groupByModule(permissions)
  const moduleKeys = Object.keys(permsByModule).sort()

  function togglePermission(permId: string) {
    if (isSystemRole) return
    setRolePermissions((prev) => {
      const current = new Set(prev[selectedRoleId] ?? [])
      if (current.has(permId)) {
        current.delete(permId)
      } else {
        current.add(permId)
      }
      return { ...prev, [selectedRoleId]: current }
    })
  }

  function toggleModule(module: string, checked: boolean) {
    if (isSystemRole) return
    const modulePermIds = (permsByModule[module] ?? []).map((p) => p.id)
    setRolePermissions((prev) => {
      const current = new Set(prev[selectedRoleId] ?? [])
      for (const id of modulePermIds) {
        if (checked) {
          current.add(id)
        } else {
          current.delete(id)
        }
      }
      return { ...prev, [selectedRoleId]: current }
    })
  }

  // Snapshot of last-saved permissions per role (for dirty check + rollback)
  const [savedPermissions, setSavedPermissions] = useState<Record<string, Set<string>>>(() => {
    const state: Record<string, Set<string>> = {}
    for (const [roleId, permIds] of Object.entries(initialRolePermissions)) {
      state[roleId] = new Set(permIds)
    }
    return state
  })

  function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }

  const isDirty = !isSystemRole && !setsEqual(
    rolePermissions[selectedRoleId] ?? new Set(),
    savedPermissions[selectedRoleId] ?? new Set()
  )

  function handleSave() {
    if (!selectedRoleId || isSystemRole) return
    const permIds = Array.from(rolePermissions[selectedRoleId] ?? [])
    // Snapshot current saved state for rollback
    const rollbackSnapshot = new Set(savedPermissions[selectedRoleId] ?? [])
    startTransition(async () => {
      const result = await saveRolePermissions(selectedRoleId, permIds)
      if (result.success) {
        toast({ title: 'บันทึก Permissions สำเร็จ' })
        // Update saved snapshot so dirty indicator clears
        setSavedPermissions((prev) => ({ ...prev, [selectedRoleId]: new Set(permIds) }))
        router.refresh()
      } else {
        // Rollback local state to last saved state
        setRolePermissions((prev) => ({ ...prev, [selectedRoleId]: rollbackSnapshot }))
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  if (roles.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Permission Matrix</h1>
          <p className="text-muted-foreground mt-1">
            กำหนด Permissions ที่แต่ละ Role สามารถเข้าถึงได้
          </p>
        </div>
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            ยังไม่มี Roles กรุณาไปที่หน้า{' '}
            <a href="/settings/roles" className="underline font-medium">
              Roles
            </a>{' '}
            เพื่อสร้าง Default Roles ก่อน
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Permission Matrix</h1>
        <p className="text-muted-foreground mt-1">
          กำหนด Permissions ที่แต่ละ Role สามารถเข้าถึงได้
        </p>
      </div>

      {/* System roles notice */}
      <Alert className="border-blue-200 bg-blue-50">
        <Lock className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          System Roles (owner, admin) มีสิทธิ์เข้าถึงทุก module และไม่สามารถแก้ไขได้
        </AlertDescription>
      </Alert>

      <div className="flex gap-4">
        {/* Role Selector */}
        <div className="w-48 shrink-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-2">
            เลือก Role
          </p>
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
              className={cn(
                'w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-2',
                selectedRoleId === role.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {role.is_system && <Lock className="h-3 w-3 shrink-0" />}
              <span className="truncate">{role.display_name}</span>
            </button>
          ))}
        </div>

        {/* Permissions Matrix */}
        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    {selectedRole?.display_name ?? 'เลือก Role'}
                    {isSystemRole && (
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs gap-1">
                        <Lock className="h-3 w-3" />
                        System
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-0.5 flex items-center gap-2">
                    {isSystemRole
                      ? 'System Role — Permissions ถูกล็อกและไม่สามารถแก้ไขได้'
                      : `${rolePermissions[selectedRoleId]?.size ?? 0} permissions ที่เลือก`}
                    {isDirty && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        ยังไม่ได้บันทึก
                      </span>
                    )}
                  </CardDescription>
                </div>
                {!isSystemRole && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={isPending || !isDirty}
                    variant={isDirty ? 'default' : 'outline'}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {moduleKeys.map((module) => {
                  const modulePerms = permsByModule[module]
                  const selectedPerms = rolePermissions[selectedRoleId] ?? new Set()
                  const checkedCount = modulePerms.filter((p) => selectedPerms.has(p.id)).length
                  const allChecked = checkedCount === modulePerms.length
                  const someChecked = checkedCount > 0 && !allChecked

                  return (
                    <div key={module} className="border rounded-lg overflow-hidden">
                      {/* Module Header Row */}
                      <div className="flex items-center gap-3 px-3 py-2 bg-muted/40">
                        {!isSystemRole && (
                          <Checkbox
                            checked={someChecked ? 'indeterminate' : allChecked}
                            onCheckedChange={(v) => toggleModule(module, v === true)}
                          />
                        )}
                        <span className="text-sm font-semibold">
                          {MODULE_LABELS[module] ?? module}
                        </span>
                        <Badge variant="outline" className="text-xs ml-auto">
                          {checkedCount}/{modulePerms.length}
                        </Badge>
                      </div>

                      {/* Permission Rows */}
                      <div className="divide-y">
                        {modulePerms.map((perm) => {
                          const isChecked = (rolePermissions[selectedRoleId] ?? new Set()).has(perm.id)
                          return (
                            <label
                              key={perm.id}
                              className={cn(
                                'flex items-center gap-3 px-3 py-2 text-sm',
                                !isSystemRole && 'cursor-pointer hover:bg-muted/30'
                              )}
                            >
                              <Checkbox
                                checked={isChecked}
                                disabled={isSystemRole}
                                onCheckedChange={() => togglePermission(perm.id)}
                              />
                              <span className={cn(!isChecked && 'text-muted-foreground')}>
                                {ACTION_LABELS[perm.action] ?? perm.action}
                              </span>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {perm.display_name}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
