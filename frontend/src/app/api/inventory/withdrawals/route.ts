import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type WithdrawalType = 'promotional' | 'sample' | 'write_off' | 'internal_use' | 'other'

export interface StockWithdrawal {
  id: string
  sku_internal: string
  doc_number: string
  doc_date: string
  withdrawal_type: WithdrawalType
  qty: number
  account_code: string | null
  account_name: string | null
  description: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const TYPE_LABELS: Record<WithdrawalType, string> = {
  promotional:   'ส่งเสริมการขาย',
  sample:        'สินค้าตัวอย่าง',
  write_off:     'ตัดจำหน่าย',
  internal_use:  'ใช้ภายใน',
  other:         'อื่นๆ',
}

// GET /api/inventory/withdrawals?sku_internal=NEWONN001&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const sku  = searchParams.get('sku_internal')
    const from = searchParams.get('from')
    const to   = searchParams.get('to')

    let q = supabase
      .from('inventory_stock_withdrawals')
      .select('*')
      .order('doc_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)

    if (sku)  q = q.eq('sku_internal', sku)
    if (from) q = q.gte('doc_date', from)
    if (to)   q = q.lte('doc_date', to)

    const { data, error } = await q
    if (error) throw error

    return NextResponse.json({ success: true, data: data ?? [], type_labels: TYPE_LABELS })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// POST /api/inventory/withdrawals
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { sku_internal, doc_number, doc_date, withdrawal_type, qty, account_code, account_name, description, notes } = body

    if (!sku_internal || !doc_number || !doc_date || !withdrawal_type || !qty) {
      return NextResponse.json({ success: false, error: 'ข้อมูลไม่ครบ' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('inventory_stock_withdrawals')
      .insert({
        sku_internal,
        doc_number,
        doc_date,
        withdrawal_type,
        qty:          Number(qty),
        account_code: account_code || null,
        account_name: account_name || null,
        description:  description || null,
        notes:        notes || null,
        created_by:   user.id,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/inventory/withdrawals?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

    const { error } = await supabase.from('inventory_stock_withdrawals').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
