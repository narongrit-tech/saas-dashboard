'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  Pencil,
  Check,
  X,
  ChevronDown,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  getCashflowPlannerData,
  updateOpeningBalance,
  CashflowPlannerData,
  CashflowPlannerRow,
} from '@/app/(dashboard)/company-cashflow/planner-actions'

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function balanceColor(balance: number): string {
  if (balance < 0) return 'text-red-600'
  if (balance < 20000) return 'text-orange-500'
  return 'text-green-600'
}

function balanceBg(balance: number): string {
  if (balance < 0) return 'bg-red-50'
  if (balance < 20000) return 'bg-orange-50'
  return ''
}

function SummaryCard({
  title,
  value,
  sub,
  icon,
  color,
  edit,
}: {
  title: string
  value: string
  sub: string
  icon: React.ReactNode
  color: string
  edit?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={`rounded-lg p-2 ${color}`}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <div className={`text-xl font-bold sm:text-2xl ${color.replace('bg-', 'text-').replace('-50', '-600')}`}>
            {value}
          </div>
          {edit}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  )
}

function OutflowCell({ items }: { items: CashflowPlannerRow['outflow_items'] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return <span className="text-muted-foreground">—</span>

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1 text-red-600 hover:underline">
          <span className="font-mono">฿{fmt(items.reduce((s, x) => s + x.amount, 0))}</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-0.5 rounded border bg-background p-2 text-left shadow-sm">
          {items.map((item, i) => (
            <div key={i} className="flex justify-between gap-4 text-xs">
              <span className="truncate text-muted-foreground">
                {item.description || item.vendor || item.category}
              </span>
              <span className="font-mono font-medium shrink-0">฿{fmt(item.amount)}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function CashflowPlanner() {
  const [data, setData] = useState<CashflowPlannerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAllDays, setShowAllDays] = useState(false)

  // Opening balance edit state
  const [editingBalance, setEditingBalance] = useState(false)
  const [balanceInput, setBalanceInput] = useState('')
  const [savingBalance, setSavingBalance] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await getCashflowPlannerData(30)
    if (!result.success || !result.data) {
      setError(result.error ?? 'เกิดข้อผิดพลาด')
    } else {
      setData(result.data)
      setBalanceInput(String(result.data.opening_balance))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSaveBalance = async () => {
    const parsed = parseFloat(balanceInput.replace(/,/g, ''))
    if (isNaN(parsed)) return
    setSavingBalance(true)
    const result = await updateOpeningBalance(parsed)
    if (result.success) {
      setEditingBalance(false)
      fetchData()
    } else {
      setError(result.error ?? 'บันทึกไม่สำเร็จ')
    }
    setSavingBalance(false)
  }

  const visibleRows =
    data?.rows.filter((r) => showAllDays || r.inflow > 0 || r.outflow > 0) ?? []

  const closingPositive = (data?.closing_balance ?? 0) >= 0

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
              </CardHeader>
              <CardContent>
                <div className="h-7 w-28 animate-pulse rounded bg-gray-200" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Subheader */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          คาดการณ์กระแสเงินสด 30 วันข้างหน้า — เงินเข้าจาก TikTok settlement · เงินออกจาก Expenses (DRAFT)
        </p>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Warning if min balance goes negative */}
      {data && data.min_balance < 0 && data.min_balance_date && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>คำเตือน:</strong> ยอดเงินอาจติดลบในวันที่{' '}
            <strong>{fmtDate(data.min_balance_date)}</strong> ประมาณ{' '}
            <strong>฿{fmt(Math.abs(data.min_balance))}</strong> — ควรวางแผนหาเงินเสริม
          </AlertDescription>
        </Alert>
      )}

      {data && data.min_balance >= 0 && data.min_balance < 30000 && data.min_balance_date && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <AlertDescription className="text-orange-800">
            <strong>ระวัง:</strong> ยอดเงินจะเหลือต่ำสุดที่{' '}
            <strong>฿{fmt(data.min_balance)}</strong> ในวันที่{' '}
            <strong>{fmtDate(data.min_balance_date)}</strong>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ยอดเงินสดตอนนี้</CardTitle>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <Wallet className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              {editingBalance ? (
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 w-28 font-mono text-sm"
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveBalance()
                      if (e.key === 'Escape') setEditingBalance(false)
                    }}
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleSaveBalance}
                    disabled={savingBalance}
                  >
                    <Check className="h-3 w-3 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditingBalance(false)}
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-blue-600 sm:text-2xl">
                    ฿{fmt(data.opening_balance)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      setBalanceInput(String(data.opening_balance))
                      setEditingBalance(true)
                    }}
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">กดแก้ไขเพื่ออัปเดต</p>
            </CardContent>
          </Card>

          <SummaryCard
            title="เงินเข้าที่รอรับ 30 วัน"
            value={`฿${fmt(data.total_inflow)}`}
            sub={`จาก TikTok ${data.rows.reduce((s, r) => s + r.inflow_orders, 0)} orders`}
            icon={<TrendingUp className="h-4 w-4" />}
            color="bg-green-50"
          />

          <SummaryCard
            title="ค่าใช้จ่ายที่วางแผน 30 วัน"
            value={`฿${fmt(data.total_outflow)}`}
            sub={`จาก Expenses (DRAFT) ${data.rows.reduce((s, r) => s + r.outflow_items.length, 0)} รายการ`}
            icon={<TrendingDown className="h-4 w-4" />}
            color="bg-red-50"
          />

          <Card className={closingPositive ? 'border-green-200' : 'border-red-200'}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Balance สุทธิ (วันที่ 30)</CardTitle>
              <div
                className={`rounded-lg p-2 ${
                  closingPositive ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                }`}
              >
                <Wallet className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div
                className={`text-xl font-bold sm:text-2xl ${
                  closingPositive ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {!closingPositive && '-'}฿{fmt(Math.abs(data.closing_balance))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">ยอดคาดการณ์สิ้นเดือน</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Timeline Table */}
      {data && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Timeline 30 วัน</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAllDays((p) => !p)}
              className="gap-1"
            >
              {showAllDays ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" /> ซ่อนวันว่าง
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" /> แสดงทุกวัน
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {/* Mobile */}
            <div className="divide-y sm:hidden">
              {visibleRows.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  ไม่มีรายการที่คาดการณ์ใน 30 วัน
                </p>
              )}
              {visibleRows.map((row) => (
                <div key={row.date} className={`px-4 py-3 space-y-1 ${balanceBg(row.running_balance)}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{fmtDate(row.date)}</span>
                    <span className={`font-mono font-bold text-sm ${balanceColor(row.running_balance)}`}>
                      ฿{fmt(row.running_balance)}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    {row.inflow > 0 && (
                      <span className="text-green-600">
                        ↑ ฿{fmt(row.inflow)}
                        {row.inflow_orders > 0 && (
                          <span className="ml-1 text-muted-foreground">({row.inflow_orders} orders)</span>
                        )}
                      </span>
                    )}
                    {row.outflow > 0 && (
                      <span className="text-red-600">↓ ฿{fmt(row.outflow)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">วันที่</TableHead>
                    <TableHead className="text-right">เงินเข้า (TikTok)</TableHead>
                    <TableHead className="text-right">จ่าย (Expenses)</TableHead>
                    <TableHead className="text-right">Running Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Opening row */}
                  <TableRow className="bg-blue-50/50 font-medium">
                    <TableCell className="text-blue-700">ยอดเริ่มต้น</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono font-bold text-blue-700">
                      ฿{fmt(data.opening_balance)}
                    </TableCell>
                  </TableRow>

                  {visibleRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        ไม่มีรายการที่คาดการณ์ใน 30 วัน
                        <br />
                        <span className="text-xs">
                          เพิ่ม Expenses แบบ DRAFT ล่วงหน้าเพื่อให้เห็นรายจ่าย
                        </span>
                      </TableCell>
                    </TableRow>
                  )}

                  {visibleRows.map((row) => (
                    <TableRow key={row.date} className={balanceBg(row.running_balance)}>
                      <TableCell className="font-medium">
                        {fmtDate(row.date)}
                        {row.running_balance < 0 && (
                          <Badge variant="destructive" className="ml-2 text-xs">
                            ติดลบ
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.inflow > 0 ? (
                          <div className="text-green-600">
                            <div className="font-mono">฿{fmt(row.inflow)}</div>
                            {row.inflow_orders > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {row.inflow_orders} orders
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <OutflowCell items={row.outflow_items} />
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-bold ${balanceColor(row.running_balance)}`}
                      >
                        {row.running_balance < 0 && '-'}฿{fmt(Math.abs(row.running_balance))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-green-100 border border-green-300" />
          <span>Balance &gt; 20,000 — ปลอดภัย</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-orange-100 border border-orange-300" />
          <span>Balance &lt; 20,000 — ระวัง</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-red-100 border border-red-300" />
          <span>Balance ติดลบ — ต้องจัดการ</span>
        </div>
      </div>
    </div>
  )
}
