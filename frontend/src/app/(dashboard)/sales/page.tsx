import { createClient } from '@/lib/supabase/server'
import SalesPageClient from './SalesPageClient'

export default async function SalesPage() {
  // Check if user is admin (server-side)
  let isAdmin = false

  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (!authError && user) {
      // Query user_roles table to check if user is admin
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (!roleError && roleData?.role === 'admin') {
        isAdmin = true
      }
    }
  } catch (error) {
    console.error('Error checking admin status:', error)
    isAdmin = false
  }

  return <SalesPageClient isAdmin={isAdmin} />
}
