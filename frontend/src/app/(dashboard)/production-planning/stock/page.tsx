'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, CheckCircle2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { ProdFormulaConfig, ProdStockType } from '@/types/production-planning'
import { STOCK_TYPE_LABELS } from '@/types/production-planning'

const STOCK_TYPES: ProdStockType[] = [
  'fg_warehouse',
  'fg_factory',
  'tubes_factory',
  'tubes_warehouse',
  'oil_kg',
]

export default function StockEntryPage() {
  const [formulas, setFormulas] = useState<ProdFormulaConfig[]>([])
  const [recentEntries, setRecentEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formulaId, setFormulaId] = useState('')
  const [stockType, setStockType] = useState<ProdStockType>('fg_warehouse')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Asia/Bangkok' }) // YYYY-MM-DD

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, stockRes] = await Promise.all([
        fetch('/api/production-planning/config').then(r => r.json()),
        fetch('/api/production-planning/stock?limit=20').then(r => r.json()),
      ])
      if (cfgRes.success) {
        setFormulas(cfgRes.data)
        if (cfgRes.data.length > 0 && !formulaId) setFormulaId(cfgRes.data[0].id)
      }
      if (stockRes.success) setRecentEntries(stockRes.data)
    } finally {
      setLoading(false)
    }
  }, [formulaId])

  useEffect(() => { loadData() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formulaId || !quantity) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/production-planning/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formula_id: formulaId,
          stock_type: stockType,
          quantity: parseFloat(quantity),
          snapshot_date: today,
          notes: notes || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSaved(true)
      setQuantity('')
      setNotes('')
      loadData()
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  const selectedFormula = formulas.find(f => f.id === formulaId)
  const showOil = stockType === 'oil_kg'

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/production-planning">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />กลับ</Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">อัพเดต Stock</h1>
          <p className="text-sm text-muted-foreground">บันทึกจำนวน stock ต่อ layer — {today}</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">กรอกตัวเลข</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Formula */}
            <div className="space-y-1.5">
              <Label>สูตร</Label>
              <Select value={formulaId} onValueChange={setFormulaId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกสูตร..." />
                </SelectTrigger>
                <SelectContent>
                  {formulas.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.formula_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stock Type */}
            <div className="space-y-1.5">
              <Label>ประเภท Stock</Label>
              <Select value={stockType} onValueChange={v => setStockType(v as ProdStockType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_TYPES
                    .filter(t => t !== 'oil_kg' || selectedFormula?.uses_oil)
                    .map(t => (
                      <SelectItem key={t} value={t}>{STOCK_TYPE_LABELS[t]}</SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <Label>{showOil ? 'จำนวน (kg)' : 'จำนวนหลอด'}</Label>
              <Input
                type="number"
                step={showOil ? '0.01' : '1'}
                min="0"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder={showOil ? '0.00' : '0'}
                className="font-mono text-lg"
                required
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>หมายเหตุ (ไม่บังคับ)</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="ระบุข้อมูลเพิ่มเติม..."
                rows={2}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle2 className="h-4 w-4" />บันทึกสำเร็จ
              </div>
            )}

            <Button type="submit" disabled={saving || !formulaId || !quantity} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              บันทึก
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Recent entries */}
      {recentEntries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">บันทึกล่าสุด</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentEntries.map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                  <div className="flex gap-2 items-center">
                    <span className="text-muted-foreground">{entry.prod_formula_config?.formula_name ?? '—'}</span>
                    <span>·</span>
                    <span>{STOCK_TYPE_LABELS[entry.stock_type as ProdStockType]}</span>
                  </div>
                  <div className="flex gap-3 items-center">
                    <span className="font-mono font-medium">
                      {entry.stock_type === 'oil_kg'
                        ? `${Number(entry.quantity).toFixed(1)} kg`
                        : Number(entry.quantity).toLocaleString()
                      }
                    </span>
                    <span className="text-muted-foreground text-xs">{entry.snapshot_date}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
