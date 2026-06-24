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
import { Loader2, Plus, X, Trash2, ChevronDown, ChevronRight, ArrowLeft, Pencil } from 'lucide-react'
import Link from 'next/link'
import type { ProcurementDoc, ProcurementDocItem } from '@/app/api/production-planning/procurement/route'
import type { ProdFormulaConfig } from '@/types/production-planning'

// ── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'quotation', label: 'QT ใบเสนอราคา' },
  { value: 'invoice',   label: 'IV ใบแจ้งหนี้ / ใบกำกับภาษี' },
  { value: 'receipt',   label: 'Receipt ใบเสร็จ' },
] as const

const DOC_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  quotation: { label: 'QT',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  invoice:   { label: 'IV',      cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  receipt:   { label: 'Receipt', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

const PAYMENT_BADGE: Record<string, { label: string; cls: string }> = {
  unpaid:  { label: 'ยังไม่จ่าย', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  partial: { label: 'จ่ายบางส่วน', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  paid:    { label: 'จ่ายแล้ว',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

function thaiDate(s: string) {
  return new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayBkk() {
  return new Date().toLocaleDateString('fr-CA', { timeZone: 'Asia/Bangkok' })
}

// ── Empty item factory ────────────────────────────────────────────────────────

function emptyItem(): ProcurementDocItem & { _key: string } {
  return { _key: Math.random().toString(36).slice(2), description: '', qty: 1, unit: 'หน่วย', unit_price: 0 }
}

// ── DocForm ───────────────────────────────────────────────────────────────────

function DocForm({
  formulas,
  initial,
  onSaved,
  onClose,
}: {
  formulas: ProdFormulaConfig[]
  initial?: ProcurementDoc
  onSaved: () => void
  onClose: () => void
}) {
  const isEdit = !!initial

  const [docType,  setDocType]  = useState<string>(initial?.doc_type  ?? 'invoice')
  const [docNum,   setDocNum]   = useState(initial?.doc_number ?? '')
  const [supplier, setSupplier] = useState(initial?.supplier   ?? '')
  const [docDate,  setDocDate]  = useState(initial?.doc_date   ?? todayBkk())
  const [formulaId, setFormulaId] = useState(initial?.formula_id ?? 'none')
  const [vatRate,  setVatRate]  = useState(String(initial?.vat_rate ?? 7))
  const [notes,    setNotes]    = useState(initial?.notes ?? '')
  const [payStatus, setPayStatus] = useState<string>(initial?.payment_status ?? 'unpaid')
  const [paidAmt,  setPaidAmt]  = useState(initial?.paid_amount != null ? String(initial.paid_amount) : '')
  const [paidAt,   setPaidAt]   = useState(initial?.paid_at ? initial.paid_at.slice(0, 10) : '')

  type ItemRow = ProcurementDocItem & { _key: string }
  const [items, setItems] = useState<ItemRow[]>(() =>
    initial?.items?.length
      ? initial.items.map(it => ({ ...it, _key: it.id ?? Math.random().toString(36).slice(2) }))
      : [emptyItem()]
  )

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  function updateItem(key: string, field: keyof ProcurementDocItem, val: string | number) {
    setItems(prev => prev.map(it => it._key === key ? { ...it, [field]: val } : it))
  }

  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0)
  const vat      = subtotal * (Number(vatRate) / 100)
  const total    = subtotal + vat

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!docNum.trim() || !supplier.trim()) { setError('กรอกเลขที่เอกสารและผู้ขายด้วย'); return }
    setSaving(true)
    setError(null)
    try {
      const body = {
        doc_type:        docType,
        doc_number:      docNum.trim(),
        supplier:        supplier.trim(),
        doc_date:        docDate,
        formula_id:      formulaId === 'none' ? null : formulaId,
        subtotal_amount: subtotal,
        vat_rate:        Number(vatRate),
        vat_amount:      vat,
        total_amount:    total,
        payment_status:  payStatus,
        paid_amount:     paidAmt ? Number(paidAmt) : null,
        paid_at:         paidAt ? new Date(paidAt).toISOString() : null,
        notes:           notes.trim() || null,
        items:           items.filter(it => it.description.trim()),
      }

      const url    = isEdit ? `/api/production-planning/procurement/${initial!.id}` : '/api/production-planning/procurement'
      const method = isEdit ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!json.success) throw new Error(json.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{isEdit ? 'แก้ไขเอกสาร' : 'บันทึกเอกสารใหม่'}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Row 1: type + number + supplier */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">ประเภทเอกสาร</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">เลขที่เอกสาร</Label>
              <Input value={docNum} onChange={e => setDocNum(e.target.value)} placeholder="QT-2026-001" className="h-8 text-xs font-mono" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ผู้ขาย / Supplier</Label>
              <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="บริษัท..." className="h-8 text-xs" required />
            </div>
          </div>

          {/* Row 2: date + formula + VAT */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">วันที่เอกสาร</Label>
              <Input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} className="h-8 text-xs" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">สูตร (ถ้ามี)</Label>
              <Select value={formulaId} onValueChange={setFormulaId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— ไม่ระบุ —</SelectItem>
                  {formulas.map(f => <SelectItem key={f.id} value={f.id}>{f.formula_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">VAT (%)</Label>
              <Select value={vatRate} onValueChange={setVatRate}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0% (ไม่มี VAT)</SelectItem>
                  <SelectItem value="7">7% (มาตรฐาน)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <Label className="text-xs">รายการสินค้า</Label>
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_80px_100px_32px] bg-muted/50 text-xs px-2 py-1.5 gap-2 font-medium text-muted-foreground">
                <div>รายการ</div><div className="text-right">จำนวน</div><div>หน่วย</div><div className="text-right">ราคา/หน่วย</div><div />
              </div>
              {items.map((it, idx) => (
                <div key={it._key} className="grid grid-cols-[1fr_80px_80px_100px_32px] gap-2 px-2 py-1.5 border-t items-center">
                  <Input value={it.description} onChange={e => updateItem(it._key, 'description', e.target.value)} placeholder={`รายการที่ ${idx + 1}`} className="h-7 text-xs" />
                  <Input type="number" min="0" step="0.001" value={it.qty} onChange={e => updateItem(it._key, 'qty', e.target.value)} className="h-7 text-xs font-mono text-right" />
                  <Input value={it.unit} onChange={e => updateItem(it._key, 'unit', e.target.value)} placeholder="หน่วย" className="h-7 text-xs" />
                  <Input type="number" min="0" step="0.01" value={it.unit_price} onChange={e => updateItem(it._key, 'unit_price', e.target.value)} className="h-7 text-xs font-mono text-right" />
                  <button type="button" onClick={() => setItems(prev => prev.filter(r => r._key !== it._key))} className="text-muted-foreground hover:text-destructive flex items-center justify-center">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setItems(prev => [...prev, emptyItem()])} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" /> เพิ่มรายการ
            </button>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="text-xs space-y-1 text-right min-w-48">
              <div className="flex justify-between gap-8 text-muted-foreground">
                <span>ยอดก่อน VAT</span><span className="font-mono">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between gap-8 text-muted-foreground">
                <span>VAT {vatRate}%</span><span className="font-mono">{fmt(vat)}</span>
              </div>
              <div className="flex justify-between gap-8 font-semibold border-t pt-1">
                <span>ยอดรวม</span><span className="font-mono">{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Payment status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs">สถานะการจ่าย</Label>
              <Select value={payStatus} onValueChange={setPayStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">ยังไม่จ่าย</SelectItem>
                  <SelectItem value="partial">จ่ายบางส่วน</SelectItem>
                  <SelectItem value="paid">จ่ายแล้ว</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payStatus !== 'unpaid' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">จำนวนที่จ่าย (฿)</Label>
                  <Input type="number" min="0" step="0.01" value={paidAmt} onChange={e => setPaidAmt(e.target.value)} placeholder="0.00" className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">วันที่จ่าย</Label>
                  <Input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="h-8 text-xs" />
                </div>
              </>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">หมายเหตุ</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="text-xs" />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving} size="sm" className="flex-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
              {isEdit ? 'บันทึกการแก้ไข' : 'บันทึกเอกสาร'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>ยกเลิก</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── DocRow ────────────────────────────────────────────────────────────────────

function DocRow({
  doc,
  onUpdate,
  onEdit,
}: {
  doc: ProcurementDoc
  onUpdate: () => void
  onEdit: (doc: ProcurementDoc) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payStatus, setPayStatus] = useState<'unpaid' | 'partial' | 'paid'>(doc.payment_status)
  const [paidAmt, setPaidAmt] = useState(doc.paid_amount != null ? String(doc.paid_amount) : '')
  const [paidAt, setPaidAt] = useState(doc.paid_at ? doc.paid_at.slice(0, 10) : todayBkk())
  const [saving, setSaving] = useState(false)

  async function savePayment() {
    setSaving(true)
    try {
      await fetch(`/api/production-planning/procurement/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _action: 'pay',
          payment_status: payStatus,
          paid_amount: paidAmt ? Number(paidAmt) : null,
          paid_at: paidAt ? new Date(paidAt).toISOString() : null,
        }),
      })
      setPaying(false)
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  async function deleteDoc() {
    if (!confirm('ลบเอกสารนี้?')) return
    await fetch(`/api/production-planning/procurement/${doc.id}`, { method: 'DELETE' })
    onUpdate()
  }

  const typeBadge = DOC_TYPE_BADGE[doc.doc_type] ?? { label: doc.doc_type, cls: '' }
  const payBadge  = PAYMENT_BADGE[doc.payment_status] ?? { label: doc.payment_status, cls: '' }
  const hasItems  = (doc.items ?? []).length > 0

  return (
    <div className="border rounded-lg bg-background text-sm">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap">
        <button type="button" onClick={() => setExpanded(p => !p)} className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${typeBadge.cls}`}>{typeBadge.label}</span>
        <span className="font-mono font-medium">{doc.doc_number}</span>
        <span className="text-muted-foreground truncate max-w-[160px]">{doc.supplier}</span>
        {doc.formula_name && <Badge variant="outline" className="text-xs">{doc.formula_name}</Badge>}
        <span className="text-muted-foreground text-xs">{thaiDate(doc.doc_date)}</span>
        <span className="ml-auto font-mono font-semibold text-right shrink-0">฿{fmt(doc.total_amount)}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${payBadge.cls}`}>{payBadge.label}</span>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onEdit(doc)} className="text-muted-foreground hover:text-foreground p-1"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={deleteDoc} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-3">
          {/* Line items table */}
          {hasItems && (
            <div className="rounded border overflow-hidden text-xs">
              <div className="grid grid-cols-[1fr_80px_80px_100px_100px] bg-muted/40 px-2 py-1.5 gap-2 text-muted-foreground font-medium">
                <div>รายการ</div><div className="text-right">จำนวน</div><div>หน่วย</div><div className="text-right">ราคา/หน่วย</div><div className="text-right">รวม</div>
              </div>
              {doc.items!.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_80px_100px_100px] px-2 py-1.5 border-t gap-2">
                  <div>{it.description}</div>
                  <div className="text-right font-mono">{Number(it.qty).toLocaleString()}</div>
                  <div>{it.unit}</div>
                  <div className="text-right font-mono">{fmt(Number(it.unit_price))}</div>
                  <div className="text-right font-mono">{fmt(Number(it.qty) * Number(it.unit_price))}</div>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_100px] border-t px-2 py-1.5 bg-muted/20 gap-2">
                <div className="text-right text-muted-foreground col-start-1 text-right" style={{gridColumn: '1 / 5'}}>ยอดก่อน VAT</div>
                <div className="text-right font-mono font-medium">{fmt(doc.subtotal_amount)}</div>
              </div>
              {doc.vat_rate > 0 && (
                <div className="grid grid-cols-[1fr_100px] border-t px-2 py-1.5 gap-2">
                  <div className="text-right text-muted-foreground" style={{gridColumn: '1 / 5'}}>VAT {doc.vat_rate}%</div>
                  <div className="text-right font-mono">{fmt(doc.vat_amount)}</div>
                </div>
              )}
              <div className="grid grid-cols-[1fr_100px] border-t px-2 py-2 bg-muted/30 gap-2 font-semibold">
                <div className="text-right" style={{gridColumn: '1 / 5'}}>ยอดรวม</div>
                <div className="text-right font-mono">฿{fmt(doc.total_amount)}</div>
              </div>
            </div>
          )}

          {/* Amounts summary when no items */}
          {!hasItems && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>ยอดก่อน VAT: <span className="font-mono text-foreground">{fmt(doc.subtotal_amount)}</span></div>
              {doc.vat_rate > 0 && <div>VAT {doc.vat_rate}%: <span className="font-mono text-foreground">{fmt(doc.vat_amount)}</span></div>}
              <div className="font-semibold">ยอดรวม: <span className="font-mono text-foreground">฿{fmt(doc.total_amount)}</span></div>
            </div>
          )}

          {/* Payment section */}
          <div className="border-t pt-2 space-y-2">
            {!paying ? (
              <div className="flex items-center gap-3 text-xs">
                <span className={`px-1.5 py-0.5 rounded font-medium ${payBadge.cls}`}>{payBadge.label}</span>
                {doc.paid_amount != null && <span>จ่ายแล้ว <span className="font-mono">฿{fmt(doc.paid_amount)}</span></span>}
                {doc.paid_at && <span className="text-muted-foreground">วันที่ {thaiDate(doc.paid_at)}</span>}
                {doc.payment_status !== 'paid' && (
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setPaying(true)}>บันทึกการจ่าย</Button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <div className="space-y-1">
                  <Label className="text-[10px]">สถานะ</Label>
                  <Select value={payStatus} onValueChange={v => setPayStatus(v as 'unpaid' | 'partial' | 'paid')}>
                    <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">ยังไม่จ่าย</SelectItem>
                      <SelectItem value="partial">บางส่วน</SelectItem>
                      <SelectItem value="paid">จ่ายครบ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {payStatus !== 'unpaid' && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-[10px]">จำนวน (฿)</Label>
                      <Input type="number" min="0" step="0.01" value={paidAmt} onChange={e => setPaidAmt(e.target.value)} className="h-7 text-xs w-28 font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">วันที่จ่าย</Label>
                      <Input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="h-7 text-xs" />
                    </div>
                  </>
                )}
                <Button size="sm" className="h-7 text-xs" onClick={savePayment} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'บันทึก'}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPaying(false)}>ยกเลิก</Button>
              </div>
            )}
          </div>

          {doc.notes && <p className="text-xs text-muted-foreground border-t pt-2">{doc.notes}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const [docs,     setDocs]     = useState<ProcurementDoc[]>([])
  const [formulas, setFormulas] = useState<ProdFormulaConfig[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing,  setEditing]  = useState<ProcurementDoc | null>(null)
  const [tab,      setTab]      = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [docsRes, cfgRes] = await Promise.all([
        fetch('/api/production-planning/procurement').then(r => r.json()),
        fetch('/api/production-planning/config').then(r => r.json()),
      ])
      if (docsRes.success) setDocs(docsRes.data)
      if (cfgRes.success)  setFormulas(cfgRes.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSaved() { setShowForm(false); setEditing(null); load() }
  function handleEdit(doc: ProcurementDoc) { setEditing(doc); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const filtered = tab === 'all' ? docs : docs.filter(d => d.doc_type === tab)

  const unpaidTotal = docs
    .filter(d => d.payment_status !== 'paid' && d.doc_type === 'invoice')
    .reduce((s, d) => s + d.total_amount - (d.paid_amount ?? 0), 0)

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/production-planning">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />กลับ</Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">เอกสารวัตถุดิบ</h1>
            <p className="text-sm text-muted-foreground">QT · Invoice · Receipt — บันทึกตามหลักบัญชีเพื่อตรวจสอบ</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {unpaidTotal > 0 && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Invoice ค้างชำระ</div>
              <div className="font-mono font-semibold text-orange-600 dark:text-orange-400">฿{fmt(unpaidTotal)}</div>
            </div>
          )}
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(v => !v) }}>
            <Plus className="h-4 w-4 mr-1" />บันทึกเอกสาร
          </Button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <DocForm
          formulas={formulas}
          initial={editing ?? undefined}
          onSaved={handleSaved}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">ทั้งหมด ({docs.length})</TabsTrigger>
          <TabsTrigger value="quotation">QT ({docs.filter(d => d.doc_type === 'quotation').length})</TabsTrigger>
          <TabsTrigger value="invoice">Invoice ({docs.filter(d => d.doc_type === 'invoice').length})</TabsTrigger>
          <TabsTrigger value="receipt">Receipt ({docs.filter(d => d.doc_type === 'receipt').length})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />กำลังโหลด...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              ยังไม่มีเอกสาร — กด "บันทึกเอกสาร" เพื่อเริ่มต้น
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(doc => (
                <DocRow key={doc.id} doc={doc} onUpdate={load} onEdit={handleEdit} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
