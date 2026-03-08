import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses RLS.
 * Use ONLY inside server actions that require admin-level access
 * (e.g. listing auth.users for the Users management page).
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment variables.
 * Never expose this client or key to the browser.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your .env.local file.'
    )
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
