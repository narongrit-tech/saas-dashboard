'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AppSettings,
  UserPreferences,
  Role,
  Permission,
  UserRoleAssignment,
  SettingsAuditLog,
  UserProfile,
} from '@/types/settings'

interface ActionResult<T = unknown> {
  success: boolean
  error?: string
  data?: T
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function writeAuditLog(
  supabase: SupabaseClient,
  userId: string,
  tableName: string,
  recordId: string | null,
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  oldValues?: object,
  newValues?: object,
  changedFields?: string[]
): Promise<void> {
  await supabase.from('settings_audit_logs').insert({
    created_by: userId,
    table_name: tableName,
    record_id: recordId,
    action,
    old_values: oldValues ?? null,
    new_values: newValues ?? null,
    changed_fields: changedFields ?? null,
  })
  // Audit log failures are silent — they must not break the main operation
}

// ─────────────────────────────────────────────────────────────────────────────
// App Settings
// ─────────────────────────────────────────────────────────────────────────────

export async function getAppSettings(): Promise<ActionResult<AppSettings | null>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('created_by', user.id)
      .maybeSingle()

    if (error) return { success: false, error: `โหลด Settings ล้มเหลว: ${error.message}` }
    return { success: true, data: data as AppSettings | null }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function upsertAppSettings(
  input: Partial<Omit<AppSettings, 'id' | 'created_by' | 'created_at' | 'updated_at'>>
): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // Validation
    if (input.workspace_name !== undefined) {
      const trimmed = input.workspace_name.trim()
      if (!trimmed) return { success: false, error: 'ชื่อ Workspace ต้องไม่ว่างเปล่า' }
      input.workspace_name = trimmed
    }
    // Timezone and currency are locked
    if (input.timezone !== undefined && input.timezone !== 'Asia/Bangkok') {
      return { success: false, error: 'Timezone ถูกล็อกไว้ที่ Asia/Bangkok ไม่สามารถเปลี่ยนได้' }
    }
    if (input.currency !== undefined && input.currency !== 'THB') {
      return { success: false, error: 'Currency ถูกล็อกไว้ที่ THB ไม่สามารถเปลี่ยนได้' }
    }
    if (
      input.fiscal_year_start !== undefined &&
      (input.fiscal_year_start < 1 || input.fiscal_year_start > 12)
    ) {
      return { success: false, error: 'เดือนเริ่มต้นปีงบต้องอยู่ระหว่าง 1 ถึง 12' }
    }

    // Get old values for audit
    const { data: existing } = await supabase
      .from('app_settings')
      .select('*')
      .eq('created_by', user.id)
      .maybeSingle()

    const payload = {
      ...input,
      created_by: user.id,
      timezone: 'Asia/Bangkok',
      currency: 'THB',
      updated_at: new Date().toISOString(),
    }

    const { data: upserted, error } = await supabase
      .from('app_settings')
      .upsert(payload, { onConflict: 'created_by' })
      .select()
      .single()

    if (error) return { success: false, error: `บันทึก Settings ล้มเหลว: ${error.message}` }

    const changedFields = Object.keys(input).filter(
      (k) => existing && existing[k as keyof typeof existing] !== input[k as keyof typeof input]
    )

    await writeAuditLog(
      supabase,
      user.id,
      'app_settings',
      upserted?.id ?? null,
      existing ? 'UPDATE' : 'INSERT',
      existing ?? undefined,
      upserted ?? undefined,
      changedFields
    )

    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User Preferences
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserPreferences(): Promise<ActionResult<UserPreferences | null>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) return { success: false, error: `โหลด Preferences ล้มเหลว: ${error.message}` }
    return { success: true, data: data as UserPreferences | null }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function upsertUserPreferences(
  input: Partial<Omit<UserPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    if (input.theme && !['light', 'dark', 'system'].includes(input.theme)) {
      return { success: false, error: 'ธีมที่เลือกไม่ถูกต้อง' }
    }

    const { error } = await supabase
      .from('user_preferences')
      .upsert({ ...input, user_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

    if (error) return { success: false, error: `บันทึก Preferences ล้มเหลว: ${error.message}` }
    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

export async function getRoles(): Promise<ActionResult<Role[]>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .eq('created_by', user.id)
      .order('is_system', { ascending: false })
      .order('name')

    if (error) return { success: false, error: `โหลด Roles ล้มเหลว: ${error.message}` }
    return { success: true, data: (data ?? []) as Role[] }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function createRole(input: {
  name: string
  display_name: string
  description?: string
}): Promise<ActionResult<Role>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const name = input.name.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name) return { success: false, error: 'กรุณาระบุชื่อ Role' }
    if (!input.display_name.trim()) return { success: false, error: 'กรุณาระบุชื่อแสดงของ Role' }
    if (['owner', 'admin', 'operator', 'viewer'].includes(name)) {
      return { success: false, error: 'ชื่อ Role นี้ถูกสงวนไว้สำหรับ System Roles' }
    }

    const { data, error } = await supabase
      .from('roles')
      .insert({
        created_by: user.id,
        name,
        display_name: input.display_name.trim(),
        description: input.description?.trim() ?? null,
        is_system: false,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return { success: false, error: `Role ชื่อ "${name}" มีอยู่แล้ว` }
      return { success: false, error: `สร้าง Role ล้มเหลว: ${error.message}` }
    }

    await writeAuditLog(supabase, user.id, 'roles', data.id, 'INSERT', undefined, data)
    return { success: true, data: data as Role }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function updateRole(
  id: string,
  input: { display_name?: string; description?: string }
): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data: existing, error: fetchErr } = await supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (fetchErr || !existing) return { success: false, error: 'ไม่พบ Role หรือไม่มีสิทธิ์แก้ไข' }
    if (existing.is_system) return { success: false, error: 'ไม่สามารถแก้ไข System Role ได้' }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.display_name !== undefined) updatePayload.display_name = input.display_name.trim()
    if (input.description !== undefined) updatePayload.description = input.description.trim() || null

    const { data: updated, error } = await supabase
      .from('roles')
      .update(updatePayload)
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single()

    if (error) return { success: false, error: `แก้ไข Role ล้มเหลว: ${error.message}` }

    const changedFields = Object.keys(input).filter(
      (k) => existing[k as keyof typeof existing] !== input[k as keyof typeof input]
    )
    await writeAuditLog(supabase, user.id, 'roles', id, 'UPDATE', existing, updated, changedFields)
    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function deleteRole(id: string): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data: existing, error: fetchErr } = await supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (fetchErr || !existing) return { success: false, error: 'ไม่พบ Role หรือไม่มีสิทธิ์ลบ' }
    if (existing.is_system) return { success: false, error: 'ไม่สามารถลบ System Role ได้' }

    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id)

    if (error) return { success: false, error: `ลบ Role ล้มเหลว: ${error.message}` }

    await writeAuditLog(supabase, user.id, 'roles', id, 'DELETE', existing)
    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllPermissions(): Promise<ActionResult<Permission[]>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('permissions')
      .select('*')
      .order('module')
      .order('action')

    if (error) return { success: false, error: `โหลด Permissions ล้มเหลว: ${error.message}` }
    return { success: true, data: (data ?? []) as Permission[] }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function getRolePermissions(roleId: string): Promise<ActionResult<string[]>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId)

    if (error) return { success: false, error: `โหลด Role Permissions ล้มเหลว: ${error.message}` }
    return { success: true, data: (data ?? []).map((r: { permission_id: string }) => r.permission_id) }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function setRolePermissions(
  roleId: string,
  permissionIds: string[]
): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // Block system roles
    const { data: role, error: roleErr } = await supabase
      .from('roles')
      .select('is_system, name')
      .eq('id', roleId)
      .single()

    if (roleErr || !role) return { success: false, error: 'ไม่พบ Role' }
    if (role.is_system) return { success: false, error: 'ไม่สามารถแก้ไข Permissions ของ System Role ได้' }

    // Get old permissions for audit
    const { data: oldPerms } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId)
    const oldPermIds = (oldPerms ?? []).map((r: { permission_id: string }) => r.permission_id)

    // Delete all existing
    const { error: delError } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)

    if (delError) return { success: false, error: `ล้าง Permissions ล้มเหลว: ${delError.message}` }

    // Re-insert
    if (permissionIds.length > 0) {
      const rows = permissionIds.map((pid) => ({
        role_id: roleId,
        permission_id: pid,
        created_by: user.id,
      }))
      const { error: insertErr } = await supabase.from('role_permissions').insert(rows)
      if (insertErr) return { success: false, error: `บันทึก Permissions ล้มเหลว: ${insertErr.message}` }
    }

    await writeAuditLog(
      supabase,
      user.id,
      'role_permissions',
      roleId,
      'UPDATE',
      { permission_ids: oldPermIds },
      { permission_ids: permissionIds },
      ['permission_ids']
    )

    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User Role Assignments
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserRoleAssignments(): Promise<
  ActionResult<(UserRoleAssignment & { role: Role })[]>
> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('user_role_assignments')
      .select('*, role:roles(*)')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })

    if (error) return { success: false, error: `โหลด User Roles ล้มเหลว: ${error.message}` }
    return { success: true, data: (data ?? []) as (UserRoleAssignment & { role: Role })[] }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function assignUserRole(userId: string, roleId: string): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    if (!userId || !roleId) return { success: false, error: 'กรุณาระบุ User และ Role' }

    // Fetch existing assignment(s) for this user before replacing
    const { data: existing } = await supabase
      .from('user_role_assignments')
      .select('id, role_id')
      .eq('user_id', userId)
      .eq('created_by', user.id)

    // Remove all existing roles for this user (one-role-per-user semantics)
    if (existing && existing.length > 0) {
      const { error: delError } = await supabase
        .from('user_role_assignments')
        .delete()
        .eq('user_id', userId)
        .eq('created_by', user.id)
      if (delError) return { success: false, error: `ลบ Role เดิมล้มเหลว: ${delError.message}` }
    }

    // Insert new assignment
    const { data, error } = await supabase
      .from('user_role_assignments')
      .insert({ user_id: userId, role_id: roleId, assigned_by: user.id, created_by: user.id })
      .select()
      .single()

    if (error) return { success: false, error: `กำหนด Role ล้มเหลว: ${error.message}` }

    const oldRoleId = existing && existing.length > 0 ? existing[0].role_id : null
    await writeAuditLog(
      supabase,
      user.id,
      'user_role_assignments',
      data?.id ?? null,
      oldRoleId ? 'UPDATE' : 'INSERT',
      oldRoleId ? { user_id: userId, role_id: oldRoleId } : undefined,
      { user_id: userId, role_id: roleId }
    )

    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

export async function removeUserRole(userId: string, roleId: string): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { error } = await supabase
      .from('user_role_assignments')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId)
      .eq('created_by', user.id)

    if (error) return { success: false, error: `ลบ Role ล้มเหลว: ${error.message}` }

    await writeAuditLog(
      supabase,
      user.id,
      'user_role_assignments',
      null,
      'DELETE',
      { user_id: userId, role_id: roleId }
    )

    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Users (admin — uses service client to access auth.admin.listUsers)
// ─────────────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<ActionResult<UserProfile[]>> {
  try {
    // First verify current user is authenticated
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // Use service client to list all users
    let serviceClient
    try {
      serviceClient = createServiceClient()
    } catch {
      return {
        success: false,
        error: 'ไม่พบ SUPABASE_SERVICE_ROLE_KEY กรุณาตั้งค่า environment variable ใน .env.local',
      }
    }

    const { data: authData, error: listErr } = await serviceClient.auth.admin.listUsers({
      perPage: 100,
    })

    if (listErr) return { success: false, error: `โหลดรายชื่อผู้ใช้ล้มเหลว: ${listErr.message}` }

    // Fetch role assignments for merge
    const { data: assignments } = await supabase
      .from('user_role_assignments')
      .select('user_id, role:roles(display_name)')
      .eq('created_by', user.id)

    const roleMap = new Map<string, string>()
    if (assignments) {
      for (const a of assignments as unknown as Array<{ user_id: string; role: { display_name: string } | null }>) {
        if (a.role) roleMap.set(a.user_id, a.role.display_name)
      }
    }

    const profiles: UserProfile[] = (authData?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? '',
      full_name: (u.user_metadata?.full_name as string | undefined) ?? null,
      avatar_url: (u.user_metadata?.avatar_url as string | undefined) ?? null,
      current_role: roleMap.get(u.id) ?? null,
      created_at: u.created_at ?? null,
    }))

    return { success: true, data: profiles }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed Default Roles
// ─────────────────────────────────────────────────────────────────────────────

export async function seedDefaultRoles(): Promise<ActionResult> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { error } = await supabase.rpc('seed_default_roles_for_user', {
      p_user_id: user.id,
    })

    if (error) return { success: false, error: `สร้าง Default Roles ล้มเหลว: ${error.message}` }

    await writeAuditLog(supabase, user.id, 'roles', null, 'INSERT', undefined, {
      action: 'seed_default_roles',
    })

    return { success: true }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Audit Logs
// ─────────────────────────────────────────────────────────────────────────────

export async function getSettingsAuditLogs(
  limit = 50
): Promise<ActionResult<SettingsAuditLog[]>> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { data, error } = await supabase
      .from('settings_audit_logs')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 500))

    if (error) return { success: false, error: `โหลด Audit Logs ล้มเหลว: ${error.message}` }
    return { success: true, data: (data ?? []) as SettingsAuditLog[] }
  } catch (err) {
    return { success: false, error: `เกิดข้อผิดพลาด: ${String(err)}` }
  }
}
