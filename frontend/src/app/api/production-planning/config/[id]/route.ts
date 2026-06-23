import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/production-planning/config/[id]
// Body: { burn_rate_window_days?: number, burn_rate_override?: number | null }
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const update: Record<string, unknown> = {}

    if ('burn_rate_window_days' in body) {
      const w = Number(body.burn_rate_window_days)
      if (!Number.isInteger(w) || w < 1 || w > 90) {
        return NextResponse.json({ success: false, error: 'burn_rate_window_days must be 1–90' }, { status: 400 })
      }
      update.burn_rate_window_days = w
    }

    if ('burn_rate_override' in body) {
      const v = body.burn_rate_override
      if (v === null || v === undefined) {
        update.burn_rate_override = null
      } else {
        const n = Number(v)
        if (isNaN(n) || n < 0) {
          return NextResponse.json({ success: false, error: 'burn_rate_override must be >= 0' }, { status: 400 })
        }
        update.burn_rate_override = n
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('prod_formula_config')
      .update(update)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
