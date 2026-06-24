'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, Trash2, ChevronUp } from 'lucide-react'
import type { WithdrawalType, StockWithdrawal } from '@/app/api/inventory/withdrawals/route'

const TYPE_LABELS: Record<WithdrawalType, string> = {
  promotional:  'ส่งเสริมการขาย',
  sample:       'สินค้าตัวอย่าง',
  write_off:    'ตัดจำหน่าย',
  internal_use: 'ใช้ภายใน',
  other:        'อื่นๆ',
}

const TYPE_COLORS: Record<WithdrawalType, string> = {
  promotional:  'bg-blue-100 text-blue-800',
  sample:       'bg-purple-100 text-purple-800',
  write_off:    'bg-red-100 text-red-800',
  internal_use: 'bg-gray-100 text-gray-800',
  other:        'bg-yellow-100 text-yellow-800',
}

const SKU_OPTIONS = [
  { value: 'NEWONN001', label: 'NEWONN001 — Fresh Up' },
  { value: 'NEWONN002', label: 'NEWONN002 — Wind Down' },
]

function todayBkk() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

export function WithdrawalsTab() {
  const [rows, setRows] = useState<StockWithdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Form
  const [sku, setSku]           = useState('NEWONN001')
  const [docNo, setDocNo]       = useState('')
  const [docDate, setDocDate]   = useState(todayBkk())
  const [wType, setWType]       = useState<WithdrawalType>('promotional')
  const [qty, setQty]           = useState('')
  const [acctCode, setAcctCode] = useState('520213')
  const [acctName, setAcctName] = useState('ค่าส่งเสริมการขาย')
  const [desc, setDesc]         = useState('')
  const [notes, setNotes]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inventory/withdrawals')
      const json = await res.json()
      if (json.success) setRows(json.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/inventory/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_internal: sku,
          doc_number:   docNo,
          doc_date:     docDate,
          withdrawal_type: wType,
          qty:          parseFloat(qty),
          account_code: acctCode || undefined,
          account_name: acctName || undefined,
          description:  desc || undefined,
          notes:        notes || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSaved(true)
      setDocNo(''); setQty(''); setDesc(''); setNotes('')
      setShowForm(false)
      load()
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบรายการนี้?')) return
    setDeleting(id)
    try {
      await fetch(`/api/inventory/withdrawals?id=${id}`, { method: 'DELETE' })
      load()
    } finally {
      setDeleting(null)
    }
  }

  // Summary totals
  const totals = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.sku_internal] = (acc[r.sku_internal] ?? 0) + r.qty
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SKU_OPTIONS.map(s => (
          <Card key={s.value} className="py-3">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold font-mono mt-0.5">
                {(totals[s.value] ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">หลอด (รวมทุก type)</p>
            </CardContent>
          </Card>
        ))}
        <Card className="py-3">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">รายการทั้งหมด</p>
            <p className="text-xl font-bold font-mono mt-0.5">{rows.length}</p>
            <p className="text-xs text-muted-foreground">ใบเบิก</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">รวมทุก SKU</p>
            <p className="text-xl font-bold font-mono mt-0.5">
              {Object.values(totals).reduce((a, b) => a + b, 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">หลอด</p>
          </CardContent>
        </Card>
      </div>

      {/* Add form toggle */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium">รายการใบเบิก</h3>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? <ChevronUp className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          {showForm ? 'ซ่อนฟอร์ม' : 'เพิ่มรายการ'}
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-sm">บันทึกใบเบิกใหม่</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>SKU</Label>
                  <Select value={sku} onValueChange={setSku}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SKU_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>ประเภท</Label>
                  <Select value={wType} onValueChange={v => setWType(v as WithdrawalType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_LABELS) as WithdrawalType[]).map(t => (
                        <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>เลขที่เอกสาร</Label>
                  <Input value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="OUT-XXXXXXXXX" required />
                </div>
                <div className="space-y-1.5">
                  <Label>วันที่</Label>
                  <Input type="date" value={docDate} max={todayBkk()} onChange={e => setDocDate(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>จำนวน (หลอด)</Label>
                  <Input type="number" min="0.001" step="0.001" value={qty} onChange={e => setQty(e.target.value)}
                    placeholder="0" className="font-mono" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>รหัสบัญชี</Label>
                  <Input value={acctCode} onChange={e => setAcctCode(e.target.value)} placeholder="520213" />
                </div>
                <div className="space-y-1.5">
                  <Label>ชื่อบัญชี</Label>
                  <Input value={acctName} onChange={e => setAcctName(e.target.value)} placeholder="ค่าส่งเสริมการขาย" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>คำอธิบาย</Label>
                <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="รายละเอียดการเบิก..." />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {saved && <p className="text-sm text-green-600">บันทึกสำเร็จ</p>}
              <Button type="submit" disabled={saving} className="w-full">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}บันทึก
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />กำลังโหลด...
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">ยังไม่มีรายการ</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2.5 font-medium">วันที่</th>
                    <th className="text-left px-4 py-2.5 font-medium">เลขที่</th>
                    <th className="text-left px-4 py-2.5 font-medium">SKU</th>
                    <th className="text-left px-4 py-2.5 font-medium">ประเภท</th>
                    <th className="text-left px-4 py-2.5 font-medium">คำอธิบาย</th>
                    <th className="text-left px-4 py-2.5 font-medium">รหัสบัญชี</th>
                    <th className="text-right px-4 py-2.5 font-medium">จำนวน</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{r.doc_date}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{r.doc_number}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs">{r.sku_internal}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.withdrawal_type as WithdrawalType]}`}>
                          {TYPE_LABELS[r.withdrawal_type as WithdrawalType] ?? r.withdrawal_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">{r.description ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {r.account_code ? `${r.account_code} ${r.account_name ?? ''}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium text-red-600">
                        −{Number(r.qty).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(r.id)} disabled={deleting === r.id}>
                          {deleting === r.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td colSpan={6} className="px-4 py-2.5 text-right">รวม</td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600">
                      −{rows.reduce((s, r) => s + Number(r.qty), 0).toLocaleString()}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
