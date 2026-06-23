'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import Link from 'next/link'
import type { ProdProductionOrder, ProdOrderType } from '@/types/production-planning'
import { ORDER_TYPE_LABELS } from '@/types/production-planning'

type OrderRow = ProdProductionOrder & { formula_name: string | null }

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function ReceiveInline({
  order,
  onDone,
}: {
  order: OrderRow
  onDone: () => void
}) {
  const isOil = order.order_type === 'oil'
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(String(order.ordered_qty))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function receive() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/production-planning/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received_qty: parseFloat(qty),
          received_at: new Date().toISOString(),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setOpen(false)
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  async function cancel() {
    if (!confirm('ยืนยันยกเลิกคำสั่งนี้?')) return
    await fetch(`/api/production-planning/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    onDone()
  }

  if (!open) {
    return (
      <div className="flex gap-1.5 shrink-0">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="h-7 text-xs px-2">
          ✓ รับของ
        </Button>
        <Button size="sm" variant="ghost" onClick={cancel} className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive">
          ยกเลิก
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      <Input
        type="number"
        step={isOil ? '0.01' : '1'}
        min="0"
        value={qty}
        onChange={e => setQty(e.target.value)}
        className="h-7 text-xs w-24 font-mono"
        autoFocus
      />
      <span className="text-xs text-muted-foreground">{isOil ? 'kg' : 'หลอด'}</span>
      <Button size="sm" onClick={receive} disabled={saving || !qty} className="h-7 text-xs px-2">
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
        ยืนยัน
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 text-xs px-2">
        <XCircle className="h-3 w-3" />
      </Button>
      {error && <span className="text-xs text-destructive w-full">{error}</span>}
    </div>
  )
}

export function PendingOrdersWidget({ initialOrders }: { initialOrders: OrderRow[] }) {
  const router = useRouter()
  const [orders, setOrders] = useState<OrderRow[]>(initialOrders)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/production-planning/orders?status=pending')
      const json = await res.json()
      if (json.success) {
        setOrders(json.data.map((o: any) => ({
          ...o,
          formula_name: o.prod_formula_config?.formula_name ?? o.formula_name ?? null,
          prod_formula_config: undefined,
        })))
      }
      router.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [router])

  if (orders.length === 0) return null

  const daysDue = (expectedAt: string | null) => {
    if (!expectedAt) return null
    const diff = Math.round((new Date(expectedAt).getTime() - Date.now()) / 86400000)
    return diff
  }

  return (
    <div className="space-y-2">
      {refreshing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />อัปเดต...
        </div>
      )}
      {orders.slice(0, 8).map(order => {
        const due = daysDue(order.expected_at)
        const isOverdue = due !== null && due < 0
        const isOil = order.order_type === 'oil'

        return (
          <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-2 border-b last:border-0">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className="text-xs shrink-0">
                {ORDER_TYPE_LABELS[order.order_type as ProdOrderType]}
              </Badge>
              <span className="text-muted-foreground truncate">{order.formula_name ?? '—'}</span>
              <span className="font-mono font-medium">
                {isOil ? `${Number(order.ordered_qty).toFixed(1)} kg` : Number(order.ordered_qty).toLocaleString()}
              </span>
              {order.expected_at && (
                <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
                  {isOverdue ? `⚠️ เลย ${Math.abs(due!)} วัน` : `รับ ${thaiDate(order.expected_at)}`}
                </span>
              )}
            </div>
            <ReceiveInline order={order} onDone={refresh} />
          </div>
        )
      })}
      {orders.length > 8 && (
        <Link href="/production-planning/orders" className="text-xs text-muted-foreground hover:text-foreground">
          + อีก {orders.length - 8} รายการ →
        </Link>
      )}
    </div>
  )
}
