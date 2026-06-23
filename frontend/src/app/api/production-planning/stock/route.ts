import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { StockEntryInput } from '@/types/production-planning'

// GET /api/production-planning/stock?formula_id=&limit=50
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const formulaId = searchParams.get('formula_id')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)

    let query = supabase
      .from('prod_stock_ledger')
      .select('*, prod_formula_config(formula_name, sku_internal)')
      .order('recorded_at', { ascending: false })
      .limit(limit)

    if (formulaId) query = query.eq('formula_id', formulaId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// POST /api/production-planning/stock
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body: StockEntryInput = await request.json()

    if (!body.formula_id || !body.stock_type || body.quantity === undefined || !body.snapshot_date) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }
    if (body.quantity < 0) {
      return NextResponse.json({ success: false, error: 'Quantity must be >= 0' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('prod_stock_ledger')
      .insert({
        formula_id: body.formula_id,
        stock_type: body.stock_type,
        quantity: body.quantity,
        snapshot_date: body.snapshot_date,
        notes: body.notes ?? null,
        recorded_by: user.id,
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
