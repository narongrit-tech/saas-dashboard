import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CreateOrderInput } from '@/types/production-planning'

// GET /api/production-planning/orders?status=pending
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let query = supabase
      .from('prod_production_orders')
      .select('*, prod_formula_config(formula_name, sku_internal)')
      .order('ordered_at', { ascending: false })
      .limit(100)

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// POST /api/production-planning/orders
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body: CreateOrderInput = await request.json()

    if (!body.order_type || !body.formula_id || !body.ordered_qty || !body.ordered_at) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    // Calculate expected_at from formula lead time
    const { data: cfg } = await supabase
      .from('prod_formula_config')
      .select('lead_time_fg_days, lead_time_production_max_days, lead_time_tubes_days, lead_time_oil_days')
      .eq('id', body.formula_id)
      .single()

    const leadDays = {
      call_fg: cfg?.lead_time_fg_days ?? 1,
      production: cfg?.lead_time_production_max_days ?? 30,
      tubes: cfg?.lead_time_tubes_days ?? 45,
      oil: cfg?.lead_time_oil_days ?? 45,
    }[body.order_type]

    const orderedDate = new Date(body.ordered_at)
    const expectedAt = new Date(orderedDate)
    expectedAt.setDate(expectedAt.getDate() + leadDays)

    const { data, error } = await supabase
      .from('prod_production_orders')
      .insert({
        order_type: body.order_type,
        formula_id: body.formula_id,
        ordered_qty: body.ordered_qty,
        ordered_at: body.ordered_at,
        expected_at: expectedAt.toISOString(),
        notes: body.notes ?? null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
