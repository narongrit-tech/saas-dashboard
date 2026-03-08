export interface AppSettings {
  id: string
  created_by: string
  workspace_name: string
  timezone: string
  currency: string
  fiscal_year_start: number
  created_at: string
  updated_at: string
}

export interface UserPreferences {
  id: string
  user_id: string
  theme: 'light' | 'dark' | 'system'
  language: string
  notification_cogs_runs: boolean
  notification_import_complete: boolean
  notification_low_balance: boolean
  created_at: string
  updated_at: string
}

export interface Role {
  id: string
  created_by: string
  name: string
  display_name: string
  description?: string | null
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface Permission {
  id: string
  module: string
  action: string
  display_name: string
  description?: string | null
  created_at: string
}

export interface RolePermission {
  id: string
  role_id: string
  permission_id: string
  created_by: string
  created_at: string
}

export interface UserRoleAssignment {
  id: string
  user_id: string
  role_id: string
  assigned_by?: string | null
  created_by: string
  created_at: string
  role?: Role
}

export interface SettingsAuditLog {
  id: string
  created_by: string
  table_name: string
  record_id?: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  old_values?: Record<string, unknown> | null
  new_values?: Record<string, unknown> | null
  changed_fields?: string[] | null
  created_at: string
}

export interface UserProfile {
  id: string
  email: string
  full_name?: string | null
  avatar_url?: string | null
  current_role?: string | null
  created_at?: string | null
}
