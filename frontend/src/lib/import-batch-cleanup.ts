/**
 * Import Batch Cleanup Utility
 * Phase 6: Prevent stuck 'processing' batches
 */

import { createClient } from '@/lib/supabase/server'

/**
 * Mark stale processing batches as failed
 * Run this periodically or on app startup
 *
 * A batch is considered stale if:
 * - status = 'processing'
 * - created_at is older than 1 hour
 */
export async function cleanupStaleImportBatches(): Promise<{
  success: boolean
  count?: number
  error?: string
}> {
  try {
    const supabase = createClient()

    // Get current user (for audit trail)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        error: 'Authentication required'
      }
    }

    // Mark batches older than 1 hour as failed
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('import_batches')
      .update({
        status: 'failed',
        notes: 'Marked as failed due to timeout (> 1 hour) - Automatic cleanup'
      })
      .eq('status', 'processing')
      .eq('created_by', user.id) // Only cleanup current user's batches
      .lt('created_at', oneHourAgo)
      .select('id')

    if (error) {
      console.error('Failed to cleanup stale batches:', error)
      return {
        success: false,
        error: error.message
      }
    }

    const count = data?.length || 0
    console.log(`[CLEANUP] Cleaned up ${count} stale import batches for user: ${user.id}`)

    return {
      success: true,
      count
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Cleanup error:', errorMessage)
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Get count of stale processing batches (for monitoring)
 */
export async function getStaleImportBatchCount(): Promise<{
  success: boolean
  count?: number
  error?: string
}> {
  try {
    const supabase = createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return {
        success: false,
        error: 'Authentication required'
      }
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { count, error } = await supabase
      .from('import_batches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'processing')
      .eq('created_by', user.id)
      .lt('created_at', oneHourAgo)

    if (error) {
      console.error('Failed to count stale batches:', error)
      return {
        success: false,
        error: error.message
      }
    }

    return {
      success: true,
      count: count || 0
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage
    }
  }
}
