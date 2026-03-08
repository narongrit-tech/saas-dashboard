import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowDownToLine, ArrowUpFromLine, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import { getCashPL } from './actions'

export const dynamic = 'force-dynamic'

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (d: string) => {
    const [, m, day] = d.split('-')
    return `${parseInt(day)}/${parseInt(m)}`
  }
  return `${fmt(startDate)} – ${fmt(endDate)}`
}

export default async function CashPLPage() {
  const result = await getCashPL()

  if (!result.success || !result.data) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <p className="text-lg font-semibold">เกิดข้อผิดพลาด</p>
          </div>
          <p className="text-sm text-muted-foreground">{result.error || 'ไม่สามารถโหลดข้อมูลได้'}</p>
        </div>
      </div>
    )
  }

  const { summary, daily } = result.data
  const isPositive = summary.netChange >= 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold leading-tight sm:text-2xl">Cash P&L</h1>
        <p className="text-sm text-muted-foreground">
          เงินสดเข้า-ออกจริง · 7 วันที่ผ่านมา ({formatDateRange(summary.startDate, summary.endDate)}) · Asia/Bangkok
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {/* Cash In */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cash In (7 วัน)</CardTitle>
            <div className="rounded-lg bg-green-50 p-2 text-green-600">
              <ArrowDownToLine className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ฿{formatCurrency(summary.cashIn)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ฝากเข้าธนาคาร + Director Loan
            </p>
          </CardContent>
        </Card>

        {/* Cash Out */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cash Out (7 วัน)</CardTitle>
            <div className="rounded-lg bg-red-50 p-2 text-red-600">
              <ArrowUpFromLine className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ฿{formatCurrency(summary.cashOut)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ถอน/โอนออกธนาคาร + Top-up กระเป๋า
            </p>
          </CardContent>
        </Card>

        {/* Net Change */}
        <Card className={`col-span-2 md:col-span-1 ${isPositive ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Cash Change (7 วัน)</CardTitle>
            <div className={`rounded-lg p-2 ${isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isPositive ? 'text-green-700' : 'text-red-700'}`}>
              {isPositive ? '+' : '-'}฿{formatCurrency(Math.abs(summary.netChange))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Cash In - Cash Out</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Cash Movement</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          {/* Mobile: card list */}
          <div className="divide-y sm:hidden">
            {daily.map((row) => {
              const rowPositive = row.net >= 0
              return (
                <div key={row.date} className="px-4 py-3 space-y-2">
                  <div className="font-medium text-sm">{row.dateLabel}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cash In</span>
                      <span className="font-mono text-green-600">
                        {row.cashIn > 0 ? `฿${formatCurrency(row.cashIn)}` : '–'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cash Out</span>
                      <span className="font-mono text-red-600">
                        {row.cashOut > 0 ? `฿${formatCurrency(row.cashOut)}` : '–'}
                      </span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span className="text-muted-foreground">Net</span>
                      <span className={`font-mono font-semibold ${rowPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {row.net === 0
                          ? '฿0.00'
                          : `${rowPositive ? '+' : '-'}฿${formatCurrency(Math.abs(row.net))}`}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
            {/* Mobile total row */}
            <div className="px-4 py-3 space-y-2 bg-muted/30">
              <div className="font-bold text-sm">รวม</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cash In</span>
                  <span className="font-mono font-bold text-green-600">฿{formatCurrency(summary.cashIn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cash Out</span>
                  <span className="font-mono font-bold text-red-600">฿{formatCurrency(summary.cashOut)}</span>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-muted-foreground">Net</span>
                  <span className={`font-mono font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                    {isPositive ? '+' : '-'}฿{formatCurrency(Math.abs(summary.netChange))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">วันที่</th>
                  <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">Cash In</th>
                  <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">Cash Out</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Net</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((row) => {
                  const rowPositive = row.net >= 0
                  return (
                    <tr key={row.date} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{row.dateLabel}</td>
                      <td className="py-2 pr-4 text-right font-mono text-green-600">
                        {row.cashIn > 0 ? `฿${formatCurrency(row.cashIn)}` : '–'}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-red-600">
                        {row.cashOut > 0 ? `฿${formatCurrency(row.cashOut)}` : '–'}
                      </td>
                      <td className={`py-2 text-right font-mono font-medium ${rowPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {row.net === 0
                          ? '฿0.00'
                          : `${rowPositive ? '+' : '-'}฿${formatCurrency(Math.abs(row.net))}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td className="pt-3 font-bold">รวม</td>
                  <td className="pt-3 text-right font-mono font-bold text-green-600">
                    ฿{formatCurrency(summary.cashIn)}
                  </td>
                  <td className="pt-3 text-right font-mono font-bold text-red-600">
                    ฿{formatCurrency(summary.cashOut)}
                  </td>
                  <td className={`pt-3 text-right font-mono font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                    {isPositive ? '+' : '-'}฿{formatCurrency(Math.abs(summary.netChange))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Note */}
      <p className="text-xs text-muted-foreground">
        * Cash In/Out มาจาก bank_transactions (deposit/withdrawal) และ wallet_ledger (TOP_UP).
        Top-up กระเป๋าโฆษณา = Cash Out แต่ไม่นับเป็นค่าใช้จ่ายใน Performance P&L
      </p>
    </div>
  )
}
