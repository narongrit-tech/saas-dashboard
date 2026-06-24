import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ProcurementDocItem } from '../route'

// PATCH /api/production-planning/procurement/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { id } = params

    // Payment-only update shortcut
    if (body._action === 'pay') {
      const { payment_status, paid_amount, paid_at } = body
      const { data, error } = await supabase
        .from('prod_procurement_docs')
        .update({ payment_status, paid_amount: paid_amount ?? null, paid_at: paid_at ?? null })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ success: true, data })
    }

    // Full update
    const {
      formula_id, ref_order_id, doc_type, doc_number, supplier, doc_date,
      subtotal_amount, vat_rate, vat_amount, total_amount,
      payment_status, paid_amount, paid_at, notes,
      items,
    } = body

    const { data: doc, error: docErr } = await supabase
      .from('prod_procurement_docs')
      .update({
        formula_id:      formula_id ?? null,
        ref_order_id:    ref_order_id ?? null,
        doc_type, doc_number, supplier, doc_date,
        subtotal_amount: Number(subtotal_amount) || 0,
        vat_rate:        Number(vat_rate) ?? 7,
        vat_amount:      Number(vat_amount) || 0,
        total_amount:    Number(total_amount) || 0,
        payment_status,
        paid_amount:     paid_amount != null ? Number(paid_amount) : null,
        paid_at:         paid_at ?? null,
        notes:           notes ?? null,
      })
      .eq('id', id)
      .select()
      .single()

    if (docErr) throw docErr

    // Replace items if provided
    if (Array.isArray(items)) {
      await supabase.from('prod_procurement_doc_items').delete().eq('doc_id', id)
      if (items.length > 0) {
        const itemRows = items.map((it: ProcurementDocItem) => ({
          doc_id:      id,
          description: it.description,
          qty:         Number(it.qty),
          unit:        it.unit || 'หน่วย',
          unit_price:  Number(it.unit_price),
        }))
        await supabase.from('prod_procurement_doc_items').insert(itemRows)
      }
    }

    return NextResponse.json({ success: true, data: doc })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/production-planning/procurement/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    const { error } = await supabase.from('prod_procurement_docs').delete().eq('id', params.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
