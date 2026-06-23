'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, CheckCircle2, ArrowLeft, Plus, X } from 'lucide-react'
import Link from 'next/link'
import type {
  ProdFormulaConfig,
  ProdOrderType,
  ProdOrderStatus,
  ProdProductionOrder,
} from '@/types/production-planning'
import { ORDER_TYPE_LABELS, ORDER_STATUS_LABELS } from '@/types/production-planning'

const ORDER_TYPES: ProdOrderType[] = ['call_fg', 'production', 'tubes', 'oil']

export default function OrdersPage() {
  const [formulas, setFormulas] = useState<ProdFormulaConfig[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, ordRes] = await Promise.all([
        fetch('/api/production-planning/config').then(r => r.json()),
        fetch('/api/production-planning/orders').then(r => r.json()),
      ])
      if (cfgRes.success) setFormulas(cfgRes.data)
      if (ordRes.success) setOrders(ordRes.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [])

  const pending = orders.filter((o: any) => o.status === 'pending')
  const history = orders.filter((o: any) => o.status !== 'pending')

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/production-planning">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />กลับ</Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">คำสั่งซื้อ / สั่งผลิต</h1>
            <p className="text-sm text-muted-foreground">ติดตาม FG, production, หลอดเปล่า, Essential Oil</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus className="h-4 w-4 mr-2" />สร้างใหม่
        </Button>
      </div>

      {showForm && (
        <CreateOrderForm
          formulas={formulas}
          onSaved={() => { setShowForm(false); loadData() }}
          onClose={() => setShowForm(false)}
        />
      )}

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">รอรับของ ({pending.length})</TabsTrigger>
          <TabsTrigger value="history">ประวัติ ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />กำลังโหลด...
            </div>
          ) : pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">ไม่มีคำสั่งที่รอรับของ</p>
          ) : (
            <div className="space-y-3">
              {pending.map((order: any) => (
                <OrderCard key={order.id} order={order} onUpdate={loadData} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="space-y-3">
            {history.map((order: any) => (
              <OrderCard key={order.id} order={order} onUpdate={loadData} readonly />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CreateOrderForm({
  formulas,
  onSaved,
  onClose,
}: {
  formulas: ProdFormulaConfig[]
  onSaved: () => void
  onClose: () => void
}) {
  const [orderType, setOrderType] = useState<ProdOrderType>('call_fg')
  const [formulaId, setFormulaId] = useState(formulas[0]?.id ?? '')
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Asia/Bangkok' })
  const selectedCfg = formulas.find(f => f.id === formulaId)
  const isOil = orderType === 'oil'

  const leadDays = {
    call_fg: selectedCfg?.lead_time_fg_days ?? 1,
    production: selectedCfg?.lead_time_production_max_days ?? 30,
    tubes: selectedCfg?.lead_time_tubes_days ?? 45,
    oil: selectedCfg?.lead_time_oil_days ?? 45,
  }[orderType]

  const expectedDate = new Date()
  expectedDate.setDate(expectedDate.getDate() + leadDays)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formulaId || !qty) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/production-planning/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_type: orderType,
          formula_id: formulaId,
          ordered_qty: parseFloat(qty),
          ordered_at: new Date().toISOString(),
          notes: notes || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">สร้างคำสั่งใหม่</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>ประเภท</Label>
              <Select value={orderType} onValueChange={v => setOrderType(v as ProdOrderType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{ORDER_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>สูตร</Label>
              <Select value={formulaId} onValueChange={setFormulaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {formulas
                    .filter(f => orderType !== 'oil' || f.uses_oil)
                    .map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.formula_name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{isOil ? 'จำนวน (kg)' : 'จำนวนหลอด'}</Label>
            <Input
              type="number"
              step={isOil ? '0.1' : '1'}
              min="0"
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder={isOil ? '10.0' : '5000'}
              className="font-mono"
              required
            />
            <p className="text-xs text-muted-foreground">
              คาดรับของ: {expectedDate.toLocaleDateString('th-TH')} (lead time {leadDays} วัน)
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>หมายเหตุ</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={saving || !formulaId || !qty} className="w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            บันทึกคำสั่ง
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function OrderCard({
  order,
  onUpdate,
  readonly = false,
}: {
  order: any
  onUpdate: () => void
  readonly?: boolean
}) {
  const [receiving, setReceiving] = useState(false)
  const [receivedQty, setReceivedQty] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOil = order.order_type === 'oil'

  async function handleReceive() {
    if (!receivedQty) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/production-planning/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received_qty: parseFloat(receivedQty),
          received_at: new Date().toISOString(),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setReceiving(false)
      onUpdate()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel() {
    if (!confirm('ยืนยันยกเลิกคำสั่งนี้?')) return
    await fetch(`/api/production-planning/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    onUpdate()
  }

  const variance = order.received_qty !== null && order.ordered_qty
    ? (((order.received_qty - order.ordered_qty) / order.ordered_qty) * 100).toFixed(1)
    : null

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{ORDER_TYPE_LABELS[order.order_type as ProdOrderType]}</Badge>
              <span className="font-medium">{order.prod_formula_config?.formula_name ?? '—'}</span>
              <StatusBadge status={order.status} />
            </div>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>
                สั่ง: <span className="font-mono text-foreground font-medium">
                  {isOil ? `${Number(order.ordered_qty).toFixed(1)} kg` : Number(order.ordered_qty).toLocaleString()}
                </span>
                {order.received_qty !== null && (
                  <span className="ml-2">
                    รับจริง: <span className="font-mono text-foreground font-medium">
                      {isOil ? `${Number(order.received_qty).toFixed(1)} kg` : Number(order.received_qty).toLocaleString()}
                    </span>
                    {variance !== null && (
                      <span className={`ml-1 text-xs ${parseFloat(variance) < 0 ? 'text-red-500' : 'text-green-500'}`}>
                        ({variance}%)
                      </span>
                    )}
                  </span>
                )}
              </p>
              <p>
                สั่งวันที่: {new Date(order.ordered_at).toLocaleDateString('th-TH')}
                {order.expected_at && ` · คาดรับ: ${new Date(order.expected_at).toLocaleDateString('th-TH')}`}
              </p>
              {order.notes && <p className="text-xs">{order.notes}</p>}
            </div>
          </div>

          {!readonly && order.status === 'pending' && !receiving && (
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setReceiving(true)}>รับของ</Button>
              <Button size="sm" variant="ghost" onClick={handleCancel} className="text-destructive">ยกเลิก</Button>
            </div>
          )}
        </div>

        {receiving && (
          <div className="mt-3 pt-3 border-t space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">จำนวนที่รับได้จริง {isOil ? '(kg)' : '(หลอด)'}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step={isOil ? '0.01' : '1'}
                  min="0"
                  value={receivedQty}
                  onChange={e => setReceivedQty(e.target.value)}
                  placeholder={isOil
                    ? `${Number(order.ordered_qty).toFixed(1)}`
                    : `${Math.round(order.ordered_qty * 0.95).toLocaleString()} (95%)`
                  }
                  className="font-mono"
                />
                <Button size="sm" onClick={handleReceive} disabled={saving || !receivedQty}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยัน'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReceiving(false)}>ยกเลิก</Button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ProdOrderStatus }) {
  const styles: Record<ProdOrderStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    received: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  )
}
