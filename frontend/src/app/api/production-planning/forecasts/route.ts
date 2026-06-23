import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ProdForecastSnapshot } from '@/types/production-planning'

// GET /api/production-planning/forecasts?formulaId=xxx
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const formulaId = searchParams.get('formulaId')
    if (!formulaId) return NextResponse.json({ success: false, error: 'formulaId required' }, { status: 400 })

    const { data, error } = await supabase
      .from('prod_forecast_snapshots')
      .select('*')
      .eq('formula_id', formulaId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json({ success: true, data: data ?? [] })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// POST /api/production-planning/forecasts
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      formula_id, label,
      fg_warehouse_qty, fg_factory_qty, burn_rate, call_rounds, prod_rounds,
      tubes_warehouse_qty, tubes_factory_qty, tube_sent_rounds, tube_new_rounds,
      oil_qty_kg, oil_rounds,
    } = body

    if (!formula_id) return NextResponse.json({ success: false, error: 'formula_id required' }, { status: 400 })

    const { data, error } = await supabase
      .from('prod_forecast_snapshots')
      .insert({
        formula_id,
        created_by: user.id,
        label: label ?? null,
        fg_warehouse_qty: Number(fg_warehouse_qty),
        fg_factory_qty: Number(fg_factory_qty),
        burn_rate: Number(burn_rate),
        call_rounds: call_rounds ?? [],
        prod_rounds: prod_rounds ?? [],
        tubes_warehouse_qty: tubes_warehouse_qty != null ? Number(tubes_warehouse_qty) : null,
        tubes_factory_qty:   tubes_factory_qty   != null ? Number(tubes_factory_qty)   : null,
        tube_sent_rounds:    tube_sent_rounds    ?? [],
        tube_new_rounds:     tube_new_rounds     ?? [],
        oil_qty_kg:          oil_qty_kg          != null ? Number(oil_qty_kg)           : null,
        oil_rounds:          oil_rounds          ?? [],
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, data: data as ProdForecastSnapshot })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/production-planning/forecasts?id=xxx
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

    const { error } = await supabase.from('prod_forecast_snapshots').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
