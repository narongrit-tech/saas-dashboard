'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, ArrowLeft, Trash2, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import Link from 'next/link'
import type { ProdFormulaConfig, ProdStockType } from '@/types/production-planning'
import { STOCK_TYPE_LABELS } from '@/types/production-planning'
import type { StockTransaction, TxEntryType } from '@/app/api/production-planning/stock-transactions/route'

const STOCK_TYPES: ProdStockType[] = [
  'fg_warehouse',
  'fg_factory',
  'tubes_factory',
  'tubes_warehouse',
  'oil_kg',
]

const ENTRY_TYPE_LABELS: Record<TxEntryType, string> = {
  opening:      'ยอดยกมา (Opening)',
  purchase_in:  'รับเข้า (Purchase)',
  transfer_in:  'โยกเข้า (Transfer In)',
  transfer_out: 'โยกออก (Transfer Out)',
  adjustment:   'แก้ไขยอด (Adjustment)',
}

const ENTRY_TYPE_SIGN: Record<TxEntryType, 1 | -1> = {
  opening:      1,
  purchase_in:  1,
  transfer_in:  1,
  transfer_out: -1,
  adjustment:   1,   // user enters signed value directly
}

function todayBkk() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

export default function StockEntryPage() {
  const [formulas, setFormulas] = useState<ProdFormulaConfig[]>([])
  const [recentSnapshots, setRecentSnapshots] = useState<any[]>([])
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Snapshot form state
  const [snapFormulaId, setSnapFormulaId] = useState('')
  const [snapStockType, setSnapStockType] = useState<ProdStockType>('fg_warehouse')
  const [snapQty, setSnapQty] = useState('')
  const [snapNotes, setSnapNotes] = useState('')

  // Transaction form state
  const [txFormulaId, setTxFormulaId] = useState('')
  const [txStockType, setTxStockType] = useState<ProdStockType>('fg_factory')
  const [txEntryType, setTxEntryType] = useState<TxEntryType>('opening')
  const [txQty, setTxQty] = useState('')
  const [txDate, setTxDate] = useState(todayBkk())
  const [txNotes, setTxNotes] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, stockRes, txRes] = await Promise.all([
        fetch('/api/production-planning/config').then(r => r.json()),
        fetch('/api/production-planning/stock?limit=10').then(r => r.json()),
        fetch('/api/production-planning/stock-transactions?limit=50').then(r => r.json()),
      ])
      if (cfgRes.success) {
        setFormulas(cfgRes.data)
        if (cfgRes.data.length > 0) {
          if (!snapFormulaId) setSnapFormulaId(cfgRes.data[0].id)
          if (!txFormulaId)   setTxFormulaId(cfgRes.data[0].id)
        }
      }
      if (stockRes.success) setRecentSnapshots(stockRes.data)
      if (txRes.success) setTransactions(txRes.data)
    } finally {
      setLoading(false)
    }
  }, [snapFormulaId, txFormulaId])

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snapshot submit ──────────────────────────────────────────────────────
  async function handleSnapshotSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!snapFormulaId || !snapQty) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/production-planning/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formula_id: snapFormulaId,
          stock_type: snapStockType,
          quantity: parseFloat(snapQty),
          snapshot_date: todayBkk(),
          notes: snapNotes || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSaved(true); setSnapQty(''); setSnapNotes('')
      loadData()
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  // ── Transaction submit ───────────────────────────────────────────────────
  async function handleTxSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!txFormulaId || !txQty || !txDate) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const rawQty  = parseFloat(txQty)
      const signedQty = txEntryType === 'transfer_out' ? -Math.abs(rawQty) : Math.abs(rawQty)

      const res = await fetch('/api/production-planning/stock-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formula_id: txFormulaId,
          stock_type: txStockType,
          entry_type: txEntryType,
          quantity_delta: signedQty,
          transaction_date: txDate,
          notes: txNotes || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSaved(true); setTxQty(''); setTxNotes('')
      loadData()
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete transaction ───────────────────────────────────────────────────
  async function handleDeleteTx(id: string) {
    if (!confirm('ลบรายการนี้?')) return
    setDeleting(id)
    try {
      await fetch(`/api/production-planning/stock-transactions?id=${id}`, { method: 'DELETE' })
      loadData()
    } finally {
      setDeleting(null)
    }
  }

  const snapFormula = formulas.find(f => f.id === snapFormulaId)
  const txFormula   = formulas.find(f => f.id === txFormulaId)

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/production-planning">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />กลับ</Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">จัดการ Stock</h1>
          <p className="text-sm text-muted-foreground">อัพเดต snapshot หรือบันทึก transaction ย้อนหลัง</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">{error}</p>}
      {saved && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle2 className="h-4 w-4" />บันทึกสำเร็จ
        </div>
      )}

      <Tabs defaultValue="transaction">
        <TabsList>
          <TabsTrigger value="transaction">บันทึก Transaction</TabsTrigger>
          <TabsTrigger value="snapshot">อัพเดต Snapshot</TabsTrigger>
        </TabsList>

        {/* ── TRANSACTION TAB ── */}
        <TabsContent value="transaction" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">เพิ่มรายการ</CardTitle>
              <p className="text-xs text-muted-foreground">
                ใส่ย้อนหลังได้ · FG โรงงาน+ขาย คำนวณอัตโนมัติจาก orders · หลอด/น้ำหอม ใส่ที่นี่
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTxSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>สูตร</Label>
                    <Select value={txFormulaId} onValueChange={setTxFormulaId} disabled={loading}>
                      <SelectTrigger><SelectValue placeholder="เลือกสูตร..." /></SelectTrigger>
                      <SelectContent>
                        {formulas.map(f => <SelectItem key={f.id} value={f.id}>{f.formula_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>ประเภท Stock</Label>
                    <Select value={txStockType} onValueChange={v => setTxStockType(v as ProdStockType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STOCK_TYPES
                          .filter(t => t !== 'oil_kg' || txFormula?.uses_oil)
                          .map(t => <SelectItem key={t} value={t}>{STOCK_TYPE_LABELS[t]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>ประเภทรายการ</Label>
                    <Select value={txEntryType} onValueChange={v => setTxEntryType(v as TxEntryType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ENTRY_TYPE_LABELS) as TxEntryType[]).map(t => (
                          <SelectItem key={t} value={t}>{ENTRY_TYPE_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>วันที่</Label>
                    <Input
                      type="date"
                      value={txDate}
                      max={todayBkk()}
                      onChange={e => setTxDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    จำนวน {txStockType === 'oil_kg' ? '(kg)' : '(หน่วย)'}
                    {txEntryType === 'transfer_out' && <span className="text-muted-foreground ml-1 text-xs">— ระบบจะแปลงเป็นตัวลบอัตโนมัติ</span>}
                  </Label>
                  <Input
                    type="number"
                    step={txStockType === 'oil_kg' ? '0.001' : '1'}
                    min="0"
                    value={txQty}
                    onChange={e => setTxQty(e.target.value)}
                    placeholder={txStockType === 'oil_kg' ? '0.000' : '0'}
                    className="font-mono text-lg"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>หมายเหตุ</Label>
                  <Textarea value={txNotes} onChange={e => setTxNotes(e.target.value)} placeholder="ล็อต, ใบส่งของ, หมายเหตุ..." rows={2} />
                </div>

                <Button type="submit" disabled={saving || !txFormulaId || !txQty} className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึก Transaction
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Transaction history */}
          {transactions.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Transaction ล่าสุด</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {transactions.map(tx => {
                    const isNeg = tx.quantity_delta < 0
                    return (
                      <div key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <div className="flex gap-3 items-center min-w-0">
                          <span className="text-muted-foreground w-20 shrink-0">{tx.transaction_date}</span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {ENTRY_TYPE_LABELS[tx.entry_type as TxEntryType] ?? tx.entry_type}
                          </Badge>
                          <span className="text-muted-foreground truncate">{STOCK_TYPE_LABELS[tx.stock_type as ProdStockType]}</span>
                          {tx.notes && <span className="text-muted-foreground/60 truncate text-xs">{tx.notes}</span>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`font-mono font-medium ${isNeg ? 'text-red-600' : 'text-green-700'}`}>
                            {isNeg ? '' : '+'}{tx.stock_type === 'oil_kg'
                              ? `${Number(tx.quantity_delta).toFixed(3)} kg`
                              : Number(tx.quantity_delta).toLocaleString()}
                          </span>
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteTx(tx.id)}
                            disabled={deleting === tx.id}
                          >
                            {deleting === tx.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── SNAPSHOT TAB ── */}
        <TabsContent value="snapshot" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">อัพเดต Snapshot (วันนี้)</CardTitle>
              <p className="text-xs text-muted-foreground">บันทึกยอด ณ วันนี้เป็น absolute value — ใช้เมื่อนับ stock จริง</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSnapshotSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>สูตร</Label>
                  <Select value={snapFormulaId} onValueChange={setSnapFormulaId} disabled={loading}>
                    <SelectTrigger><SelectValue placeholder="เลือกสูตร..." /></SelectTrigger>
                    <SelectContent>
                      {formulas.map(f => <SelectItem key={f.id} value={f.id}>{f.formula_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>ประเภท Stock</Label>
                  <Select value={snapStockType} onValueChange={v => setSnapStockType(v as ProdStockType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STOCK_TYPES
                        .filter(t => t !== 'oil_kg' || snapFormula?.uses_oil)
                        .map(t => <SelectItem key={t} value={t}>{STOCK_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>{snapStockType === 'oil_kg' ? 'จำนวน (kg)' : 'จำนวนหลอด'}</Label>
                  <Input
                    type="number"
                    step={snapStockType === 'oil_kg' ? '0.01' : '1'}
                    min="0"
                    value={snapQty}
                    onChange={e => setSnapQty(e.target.value)}
                    placeholder={snapStockType === 'oil_kg' ? '0.00' : '0'}
                    className="font-mono text-lg"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>หมายเหตุ (ไม่บังคับ)</Label>
                  <Textarea value={snapNotes} onChange={e => setSnapNotes(e.target.value)} placeholder="ระบุข้อมูลเพิ่มเติม..." rows={2} />
                </div>

                <Button type="submit" disabled={saving || !snapFormulaId || !snapQty} className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  บันทึก Snapshot
                </Button>
              </form>
            </CardContent>
          </Card>

          {recentSnapshots.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Snapshot ล่าสุด</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {recentSnapshots.map((entry: any) => (
                    <div key={entry.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div className="flex gap-2 items-center">
                        <span className="text-muted-foreground">{entry.prod_formula_config?.formula_name ?? '—'}</span>
                        <span>·</span>
                        <span>{STOCK_TYPE_LABELS[entry.stock_type as ProdStockType]}</span>
                      </div>
                      <div className="flex gap-3 items-center">
                        <span className="font-mono font-medium">
                          {entry.stock_type === 'oil_kg'
                            ? `${Number(entry.quantity).toFixed(1)} kg`
                            : Number(entry.quantity).toLocaleString()}
                        </span>
                        <span className="text-muted-foreground text-xs">{entry.snapshot_date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
