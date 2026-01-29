import { createClient } from '@/lib/supabase/server'
import SalesPageClient from './SalesPageClient'

export default async function SalesPage() {
  // Check if user is admin (server-side)
  let isAdmin = false
  let debugInfo: {
    userId?: string
    hasUser: boolean
    roleError?: string
    roleData?: string
    source: string
  } = {
    hasUser: false,
    source: 'server page.tsx',
  }

  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (!authError && user) {
      debugInfo.hasUser = true
      debugInfo.userId = user.id.substring(0, 8)

      // Query user_roles table to check if user is admin
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (roleError) {
        // PGRST116 = no rows returned (user has no role assigned)
        // This is NOT an error, just means user is not admin
        if (roleError.code === 'PGRST116') {
          debugInfo.roleData = 'no_row_found'
          isAdmin = false
        } else {
          // Real error (likely RLS policy blocking access)
          debugInfo.roleError = `${roleError.code}: ${roleError.message}`
          isAdmin = false
          console.error('[Admin Check] RLS or query error:', roleError)
        }
      } else if (roleData) {
        debugInfo.roleData = roleData.role
        if (roleData.role === 'admin') {
          isAdmin = true
        } else {
          // User has role, but not admin
          isAdmin = false
        }
      } else {
        // No error but also no data (shouldn't happen with .single())
        debugInfo.roleData = 'null_data'
        isAdmin = false
      }
    } else if (authError) {
      debugInfo.roleError = `auth: ${authError.message}`
      isAdmin = false
    } else {
      // No user logged in
      debugInfo.roleError = 'no_user'
      isAdmin = false
    }
  } catch (error) {
    console.error('Error checking admin status:', error)
    debugInfo.roleError = error instanceof Error ? error.message : 'unknown error'
    isAdmin = false
  }

  return <SalesPageClient isAdmin={isAdmin} debugInfo={debugInfo} />
}
