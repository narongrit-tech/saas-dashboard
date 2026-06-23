import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ReceiveOrderInput } from '@/types/production-planning'

// PATCH /api/production-planning/orders/[id]  — receive or cancel an order
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body: Partial<ReceiveOrderInput> & { status?: 'cancelled' } = await request.json()
    const { id } = params

    // Fetch current order
    const { data: existing, error: fetchErr } = await supabase
      .from('prod_production_orders')
      .select('status')
      .eq('id', id)
      .single()
    if (fetchErr || !existing) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })
    }
    if (existing.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Order is already finalized' }, { status: 400 })
    }

    let updatePayload: Record<string, unknown>

    if (body.status === 'cancelled') {
      updatePayload = { status: 'cancelled' }
    } else if (body.received_qty !== undefined && body.received_at) {
      if (body.received_qty < 0) {
        return NextResponse.json({ success: false, error: 'received_qty must be >= 0' }, { status: 400 })
      }
      updatePayload = {
        status: 'received',
        received_qty: body.received_qty,
        received_at: body.received_at,
        notes: body.notes ?? null,
      }
    } else {
      return NextResponse.json({ success: false, error: 'Provide received_qty+received_at or status=cancelled' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('prod_production_orders')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
