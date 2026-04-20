import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { masterRefresh } from '@/lib/content-ops/master-refresh'

export const maxDuration = 300

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthenticated' }, { status: 401 })
  }

  const result = await masterRefresh(user.id)

  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error, result }, { status: 500 })
  }

  return NextResponse.json({ ok: true, result })
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthenticated' }, { status: 401 })
  }

  // Return last refresh log entry for status display
  let lastRun: { status: string; started_at: string; finished_at: string | null; facts_read: number | null; products_upserted: number | null; shops_upserted: number | null } | null = null
  try {
    const { data } = await supabase
      .from('tt_master_refresh_log')
      .select('status,started_at,finished_at,facts_read,products_upserted,shops_upserted')
      .eq('created_by', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastRun = data
  } catch {
    // table may not exist yet
  }

  return NextResponse.json({ ok: true, lastRun })
}
