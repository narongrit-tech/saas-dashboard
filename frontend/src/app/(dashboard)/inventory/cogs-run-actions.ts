'use server'

/**
 * COGS Run Actions
 * Server actions for cogs_allocation_runs and notifications tables.
 * All operations are scoped to the authenticated user via Supabase RLS.
 */

import { createClient } from '@/lib/supabase/server'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CogsRun {
  id: string
  created_at: string
  updated_at: string
  created_by: string
  trigger_source: 'MTD' | 'DATE_RANGE' | 'IMPORT_BATCH'
  date_from: string | null
  date_to: string | null
  import_batch_id: string | null
  status: 'running' | 'success' | 'failed'
  summary_json: object | null
  error_message: string | null
}

export interface Notification {
  id: string
  created_at: string
  created_by: string
  type: string
  title: string
  body: string
  entity_type: string
  entity_id: string
  is_read: boolean
}

export interface CogsSummaryJson {
  total: number
  eligible?: number
  successful: number
  skipped: number
  failed: number
  partial?: number
  skip_reasons?: object[]
  date_from?: string
  date_to?: string
  import_batch_id?: string
  method?: string
}

// ─────────────────────────────────────────────
// 1) createCogsRun
// ─────────────────────────────────────────────

/**
 * Insert a new cogs_allocation_runs row with status='running'.
 * Returns the new run ID on success.
 */
export async function createCogsRun(params: {
  triggerSource: 'MTD' | 'DATE_RANGE' | 'IMPORT_BATCH'
  dateFrom?: string
  dateTo?: string
  importBatchId?: string
}): Promise<{ success: boolean; runId?: string; error?: string }> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data, error } = await supabase
      .from('cogs_allocation_runs')
      .insert({
        created_by: user.id,
        trigger_source: params.triggerSource,
        date_from: params.dateFrom ?? null,
        date_to: params.dateTo ?? null,
        import_batch_id: params.importBatchId ?? null,
        status: 'running',
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('createCogsRun error:', error)
      return { success: false, error: error?.message ?? 'Insert failed' }
    }

    return { success: true, runId: data.id }
  } catch (err) {
    console.error('Unexpected error in createCogsRun:', err)
    return { success: false, error: 'Unexpected error' }
  }
}

// ─────────────────────────────────────────────
// 2) completeCogsRunSuccess
// ─────────────────────────────────────────────

/**
 * Mark a cogs_allocation_runs row as success and store summary.
 */
export async function completeCogsRunSuccess(
  runId: string,
  summaryJson: object
): Promise<void> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return

    const { error } = await supabase
      .from('cogs_allocation_runs')
      .update({
        status: 'success',
        summary_json: summaryJson,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('created_by', user.id)

    if (error) {
      console.error('completeCogsRunSuccess error:', error)
    }
  } catch (err) {
    console.error('Unexpected error in completeCogsRunSuccess:', err)
  }
}

// ─────────────────────────────────────────────
// 3) completeCogsRunFailed
// ─────────────────────────────────────────────

/**
 * Mark a cogs_allocation_runs row as failed with an error message.
 */
export async function completeCogsRunFailed(
  runId: string,
  errorMessage: string
): Promise<void> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return

    const { error } = await supabase
      .from('cogs_allocation_runs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('created_by', user.id)

    if (error) {
      console.error('completeCogsRunFailed error:', error)
    }
  } catch (err) {
    console.error('Unexpected error in completeCogsRunFailed:', err)
  }
}

// ─────────────────────────────────────────────
// 4) createNotificationForRun
// ─────────────────────────────────────────────

/**
 * Insert a notification for a completed COGS run.
 */
export async function createNotificationForRun(
  runId: string,
  summaryJson: { successful: number; skipped: number; failed: number; total: number }
): Promise<void> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return

    const title = `Apply COGS เสร็จสิ้น — ${summaryJson.successful} allocated`
    const body = `${summaryJson.total} orders, ${summaryJson.successful} สำเร็จ, ${summaryJson.skipped} ข้าม, ${summaryJson.failed} ล้มเหลว`

    const { error } = await supabase.from('notifications').insert({
      created_by: user.id,
      type: 'cogs_allocation',
      title,
      body,
      entity_type: 'cogs_run',
      entity_id: runId,
      is_read: false,
    })

    if (error) {
      console.error('createNotificationForRun error:', error)
    }
  } catch (err) {
    console.error('Unexpected error in createNotificationForRun:', err)
  }
}

// ─────────────────────────────────────────────
// 5) getUnreadNotificationCount
// ─────────────────────────────────────────────

/**
 * Return the count of unread notifications for the current user.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return 0

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .eq('is_read', false)

    if (error) {
      console.error('getUnreadNotificationCount error:', error)
      return 0
    }

    return count ?? 0
  } catch (err) {
    console.error('Unexpected error in getUnreadNotificationCount:', err)
    return 0
  }
}

// ─────────────────────────────────────────────
// 6) listNotifications
// ─────────────────────────────────────────────

/**
 * Fetch the latest notifications for the current user.
 */
export async function listNotifications(limit = 20): Promise<Notification[]> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return []

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('listNotifications error:', error)
      return []
    }

    return (data ?? []) as Notification[]
  } catch (err) {
    console.error('Unexpected error in listNotifications:', err)
    return []
  }
}

// ─────────────────────────────────────────────
// 7) markNotificationRead
// ─────────────────────────────────────────────

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(id: string): Promise<void> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('created_by', user.id)

    if (error) {
      console.error('markNotificationRead error:', error)
    }
  } catch (err) {
    console.error('Unexpected error in markNotificationRead:', err)
  }
}

// ─────────────────────────────────────────────
// 8) getCogsRun
// ─────────────────────────────────────────────

/**
 * Fetch a single cogs_allocation_runs row by ID (RLS enforced).
 */
export async function getCogsRun(id: string): Promise<CogsRun | null> {
  try {
    const supabase = createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) return null

    const { data, error } = await supabase
      .from('cogs_allocation_runs')
      .select('*')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (error || !data) {
      if (error?.code !== 'PGRST116') {
        console.error('getCogsRun error:', error)
      }
      return null
    }

    return data as CogsRun
  } catch (err) {
    console.error('Unexpected error in getCogsRun:', err)
    return null
  }
}
