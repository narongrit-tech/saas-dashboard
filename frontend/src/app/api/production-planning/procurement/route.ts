import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface ProcurementDocItem {
  id?: string
  description: string
  qty: number
  unit: string
  unit_price: number
  amount?: number
}

export interface ProcurementDoc {
  id: string
  formula_id: string | null
  ref_order_id: string | null
  doc_type: 'quotation' | 'invoice' | 'receipt'
  doc_number: string
  supplier: string
  doc_date: string
  subtotal_amount: number
  vat_rate: number
  vat_amount: number
  total_amount: number
  payment_status: 'unpaid' | 'partial' | 'paid'
  paid_amount: number | null
  paid_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  items?: ProcurementDocItem[]
  formula_name?: string | null
}

// GET /api/production-planning/procurement?type=invoice&status=unpaid&formula_id=xxx
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const docType    = searchParams.get('type')
    const status     = searchParams.get('status')
    const formulaId  = searchParams.get('formula_id')

    let query = supabase
      .from('prod_procurement_docs')
      .select('*, prod_formula_config(formula_name), prod_procurement_doc_items(*)')
      .order('doc_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)

    if (docType)   query = query.eq('doc_type', docType)
    if (status)    query = query.eq('payment_status', status)
    if (formulaId) query = query.eq('formula_id', formulaId)

    const { data, error } = await query
    if (error) throw error

    const docs = (data ?? []).map((d: any) => ({
      ...d,
      formula_name: d.prod_formula_config?.formula_name ?? null,
      prod_formula_config: undefined,
      items: d.prod_procurement_doc_items ?? [],
      prod_procurement_doc_items: undefined,
    }))

    return NextResponse.json({ success: true, data: docs })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// POST /api/production-planning/procurement
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      formula_id, ref_order_id, doc_type, doc_number, supplier, doc_date,
      subtotal_amount, vat_rate, vat_amount, total_amount,
      payment_status, paid_amount, paid_at, notes,
      items = [],
    } = body

    if (!doc_type || !doc_number || !supplier || !doc_date) {
      return NextResponse.json({ success: false, error: 'doc_type, doc_number, supplier, doc_date required' }, { status: 400 })
    }

    const { data: doc, error: docErr } = await supabase
      .from('prod_procurement_docs')
      .insert({
        formula_id:      formula_id ?? null,
        ref_order_id:    ref_order_id ?? null,
        doc_type,
        doc_number,
        supplier,
        doc_date,
        subtotal_amount: Number(subtotal_amount) || 0,
        vat_rate:        Number(vat_rate) ?? 7,
        vat_amount:      Number(vat_amount) || 0,
        total_amount:    Number(total_amount) || 0,
        payment_status:  payment_status ?? 'unpaid',
        paid_amount:     paid_amount != null ? Number(paid_amount) : null,
        paid_at:         paid_at ?? null,
        notes:           notes ?? null,
        created_by:      user.id,
      })
      .select()
      .single()

    if (docErr) throw docErr

    if (items.length > 0) {
      const itemRows = items.map((it: ProcurementDocItem) => ({
        doc_id:      doc.id,
        description: it.description,
        qty:         Number(it.qty),
        unit:        it.unit || 'หน่วย',
        unit_price:  Number(it.unit_price),
      }))
      const { error: itemErr } = await supabase.from('prod_procurement_doc_items').insert(itemRows)
      if (itemErr) throw itemErr
    }

    return NextResponse.json({ success: true, data: doc })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
