import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type TxEntryType = 'opening' | 'purchase_in' | 'transfer_in' | 'transfer_out' | 'adjustment'
export type TxStockType = 'fg_warehouse' | 'fg_factory' | 'tubes_warehouse' | 'tubes_factory' | 'oil_kg'

export interface StockTransaction {
  id: string
  formula_id: string
  stock_type: TxStockType
  entry_type: TxEntryType
  quantity_delta: number
  transaction_date: string
  notes: string | null
  created_by: string | null
  created_at: string
}

// GET /api/production-planning/stock-transactions?formula_id=xxx&stock_type=fg_factory
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const formulaId  = searchParams.get('formula_id')
    const stockType  = searchParams.get('stock_type')
    const asOf       = searchParams.get('as_of')   // YYYY-MM-DD

    let q = supabase
      .from('prod_stock_transactions')
      .select('*')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)

    if (formulaId) q = q.eq('formula_id', formulaId)
    if (stockType)  q = q.eq('stock_type', stockType)
    if (asOf)       q = q.lte('transaction_date', asOf)

    const { data, error } = await q
    if (error) throw error

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// POST /api/production-planning/stock-transactions
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { formula_id, stock_type, entry_type, quantity_delta, transaction_date, notes } = body

    if (!formula_id || !stock_type || !entry_type || quantity_delta == null || !transaction_date) {
      return NextResponse.json({ success: false, error: 'ข้อมูลไม่ครบ' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('prod_stock_transactions')
      .insert({
        formula_id,
        stock_type,
        entry_type,
        quantity_delta: Number(quantity_delta),
        transaction_date,
        notes: notes || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/production-planning/stock-transactions?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

    const { error } = await supabase.from('prod_stock_transactions').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
