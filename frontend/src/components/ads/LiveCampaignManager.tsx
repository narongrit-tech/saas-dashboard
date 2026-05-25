'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Tag, RefreshCw } from 'lucide-react'
import {
  getLiveCampaigns,
  upsertCampaignConfig,
  type LiveCampaignRow,
} from '@/app/(dashboard)/ads/campaign-config-actions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ─── Row component ────────────────────────────────────────────────────────────

function CampaignRow({
  row,
  onSave,
}: {
  row: LiveCampaignRow
  onSave: (campaign_id: string, include_in_pnl: boolean, label: string) => Promise<void>
}) {
  const [included, setIncluded]   = useState(row.include_in_pnl)
  const [label, setLabel]         = useState(row.label ?? '')
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  const isDirty = included !== row.include_in_pnl || label !== (row.label ?? '')

  const handleSave = async () => {
    setSaving(true)
    await onSave(row.campaign_id, included, label)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <tr className="hover:bg-muted/20 transition-colors border-b last:border-b-0">
      {/* Campaign name + ID */}
      <td className="px-3 py-3">
        <p className="text-sm font-medium leading-tight">
          {row.campaign_name ?? <span className="text-muted-foreground italic">ไม่มีชื่อ</span>}
        </p>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">{row.campaign_id}</p>
      </td>

      {/* Last seen */}
      <td className="px-3 py-3 text-xs text-muted-foreground text-right whitespace-nowrap">
        {row.last_seen_date}
      </td>

      {/* Total spend */}
      <td className="px-3 py-3 text-xs text-right font-mono text-purple-600 whitespace-nowrap">
        ฿{fmt(row.total_spend)}
      </td>

      {/* Label */}
      <td className="px-3 py-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="เช่น นายหน้า, ยาสีฟัน"
          className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>

      {/* Include in P&L toggle */}
      <td className="px-3 py-3 text-center">
        <button
          type="button"
          role="switch"
          aria-checked={included}
          onClick={() => setIncluded((p) => !p)}
          className={[
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
            included ? 'bg-green-500' : 'bg-muted',
          ].join(' ')}
        >
          <span
            className={[
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
              included ? 'translate-x-4' : 'translate-x-0',
            ].join(' ')}
          />
        </button>
      </td>

      {/* Save button */}
      <td className="px-3 py-3 text-right">
        {saved ? (
          <span className="flex items-center justify-end gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" />บันทึกแล้ว
          </span>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="text-xs px-2.5 py-1 rounded border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'บันทึก'}
          </button>
        )}
      </td>
    </tr>
  )
}

// ─── LiveCampaignManager ──────────────────────────────────────────────────────

export function LiveCampaignManager() {
  const [campaigns, setCampaigns] = useState<LiveCampaignRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [saving, setSaving]       = useState<string | null>(null) // campaign_id being saved

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await getLiveCampaigns()
    if (result.success && result.data) {
      setCampaigns(result.data)
    } else {
      setError(result.error ?? 'ไม่สามารถโหลดข้อมูลได้')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (campaign_id: string, include_in_pnl: boolean, label: string) => {
    setSaving(campaign_id)
    const row = campaigns.find((c) => c.campaign_id === campaign_id)
    await upsertCampaignConfig({
      campaign_id,
      campaign_name: row?.campaign_name ?? null,
      campaign_type: 'live',
      label: label.trim() || null,
      include_in_pnl,
    })
    // Update local state to reflect saved values
    setCampaigns((prev) =>
      prev.map((c) =>
        c.campaign_id === campaign_id
          ? { ...c, include_in_pnl, label: label.trim() || null, config_id: c.config_id ?? 'saved' }
          : c
      )
    )
    setSaving(null)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        กำลังโหลด campaigns...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-600 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (campaigns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        ยังไม่มีข้อมูล Live campaign — import ข้อมูล ads ก่อน
      </p>
    )
  }

  const unclassifiedCount = campaigns.filter((c) => c.config_id === null).length
  const includedCount     = campaigns.filter((c) => c.include_in_pnl).length

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">จัดการ Live Campaigns</span>
          <span className="text-xs text-muted-foreground">
            ({includedCount}/{campaigns.length} รวมใน P&amp;L)
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
          รีเฟรช
        </button>
      </div>

      {/* Warning: unclassified campaigns */}
      {unclassifiedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          มี {unclassifiedCount} campaign ที่ยังไม่ได้ classify — บันทึกค่าแต่ละ campaign เพื่อให้ P&amp;L แสดงถูกต้อง
        </div>
      )}

      {/* Note about P&L behavior */}
      <div className="text-xs text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
        <strong>หมายเหตุ:</strong> เมื่อ classify แล้ว P&amp;L จะนับเฉพาะ campaign ที่เปิด &quot;Include P&amp;L&quot; เท่านั้น
        Campaign ของ COS/นายหน้าให้ปิด toggle ไว้
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Campaign</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">ล่าสุด</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Spend รวม</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Label</th>
              <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Include P&amp;L</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {campaigns.map((row) => (
              <CampaignRow
                key={row.campaign_id}
                row={row}
                onSave={handleSave}
              />
            ))}
          </tbody>
        </table>
      </div>

      {saving && (
        <p className="text-xs text-muted-foreground text-right">
          กำลังบันทึก campaign {saving}...
        </p>
      )}
    </div>
  )
}
