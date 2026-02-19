'use client'

/**
 * ShopeeFinanceClient
 * Interactive UI for Finance > Shopee page
 * - 4 summary cards
 * - 2 tabs: Settlements | Wallet Transactions
 * - Import buttons + dialogs
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Upload, TrendingUp, ArrowDownUp, ShoppingBag, Wallet } from 'lucide-react'
import { ShopeeBalanceImportDialog } from '@/components/finance/ShopeeBalanceImportDialog'
import { ShopeeSettlementImportDialog } from '@/components/finance/ShopeeSettlementImportDialog'
import type {
  ShopeeFinanceSummary,
  ShopeeFinanceSettlementRow,
  ShopeeFinanceWalletRow,
} from '@/app/(dashboard)/finance/shopee/shopee-finance-actions'

interface Props {
  summary: ShopeeFinanceSummary
  settlements: ShopeeFinanceSettlementRow[]
  walletTxns: ShopeeFinanceWalletRow[]
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ShopeeFinanceClient({ summary, settlements, walletTxns }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showBalanceDialog, setShowBalanceDialog] = useState(false)
  const [showSettlementDialog, setShowSettlementDialog] = useState(false)

  function refresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Title + Import Buttons */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShoppingBag className="h-8 w-8 text-orange-500" />
            Shopee Finance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Settlement & Wallet Transaction Summary</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => setShowSettlementDialog(true)}
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Settlement (โอนเงิน)
          </Button>
          <Button
            variant="secondary"
            className="bg-orange-100 hover:bg-orange-200 text-orange-700"
            onClick={() => setShowBalanceDialog(true)}
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Wallet Balance
          </Button>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Net Payout</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ฿{fmt(summary.totalNetPayout)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">จาก Settlement Report</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Wallet Movement</CardTitle>
            <ArrowDownUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.totalWalletMovement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {summary.totalWalletMovement >= 0 ? '+' : ''}฿{fmt(summary.totalWalletMovement)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Net จาก Balance Report</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Settled Orders</CardTitle>
            <ShoppingBag className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.settledOrderCount.toLocaleString('th-TH')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">คำสั่งซื้อที่โอนแล้ว</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wallet Transactions</CardTitle>
            <Wallet className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.walletTxnCount.toLocaleString('th-TH')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">รายการใน Wallet</p>
          </CardContent>
        </Card>
      </div>

      {/* 2-Tab Table */}
      <Tabs defaultValue="settlements">
        <TabsList>
          <TabsTrigger value="settlements">Settlements ({summary.settledOrderCount})</TabsTrigger>
          <TabsTrigger value="wallet">Wallet Transactions ({summary.walletTxnCount})</TabsTrigger>
        </TabsList>

        {/* Tab 1: Settlements */}
        <TabsContent value="settlements">
          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>วันที่สั่งซื้อ</TableHead>
                  <TableHead>วันที่โอน</TableHead>
                  <TableHead className="text-right">Net Payout</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Service Fee</TableHead>
                  <TableHead className="text-right">Refunds</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      ยังไม่มีข้อมูล — กด &quot;Import Settlement&quot; เพื่อนำเข้าข้อมูล
                    </TableCell>
                  </TableRow>
                ) : (
                  settlements.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.external_order_id}</TableCell>
                      <TableCell className="text-sm">{fmtDate(s.order_date)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(s.paid_out_date)}</TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        ฿{fmt(s.net_payout ?? 0)}
                      </TableCell>
                      <TableCell className="text-right text-red-500 text-sm">
                        {s.commission !== 0 ? `-฿${fmt(Math.abs(s.commission))}` : '-'}
                      </TableCell>
                      <TableCell className="text-right text-red-500 text-sm">
                        {s.service_fee !== 0 ? `-฿${fmt(Math.abs(s.service_fee))}` : '-'}
                      </TableCell>
                      <TableCell className="text-right text-orange-500 text-sm">
                        {s.refunds !== 0 ? `฿${fmt(Math.abs(s.refunds))}` : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {settlements.length === 200 && (
            <p className="text-xs text-muted-foreground mt-2">แสดงล่าสุด 200 รายการ</p>
          )}
        </TabsContent>

        {/* Tab 2: Wallet Transactions */}
        <TabsContent value="wallet">
          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่ทำธุรกรรม</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead>รูปแบบ</TableHead>
                  <TableHead>หมายเลขอ้างอิง</TableHead>
                  <TableHead className="text-right">จำนวนเงิน</TableHead>
                  <TableHead className="text-right">คงเหลือ</TableHead>
                  <TableHead>สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {walletTxns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      ยังไม่มีข้อมูล — กด &quot;Import Wallet Balance&quot; เพื่อนำเข้าข้อมูล
                    </TableCell>
                  </TableRow>
                ) : (
                  walletTxns.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm">{fmtDate(tx.occurred_at)}</TableCell>
                      <TableCell className="text-sm max-w-[160px] truncate">{tx.transaction_type}</TableCell>
                      <TableCell className="text-sm">
                        {tx.transaction_mode ? (
                          <Badge
                            variant="outline"
                            className={tx.transaction_mode.includes('เข้า') ? 'border-green-500 text-green-700' : 'border-red-400 text-red-600'}
                          >
                            {tx.transaction_mode}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{tx.ref_no ?? '-'}</TableCell>
                      <TableCell className={`text-right font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.amount >= 0 ? '+' : ''}฿{fmt(tx.amount)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {tx.balance != null ? `฿${fmt(tx.balance)}` : '-'}
                      </TableCell>
                      <TableCell>
                        {tx.status ? (
                          <Badge variant="secondary" className="text-xs">{tx.status}</Badge>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {walletTxns.length === 200 && (
            <p className="text-xs text-muted-foreground mt-2">แสดงล่าสุด 200 รายการ</p>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ShopeeBalanceImportDialog
        open={showBalanceDialog}
        onOpenChange={setShowBalanceDialog}
        onSuccess={refresh}
      />
      <ShopeeSettlementImportDialog
        open={showSettlementDialog}
        onOpenChange={setShowSettlementDialog}
        onSuccess={refresh}
      />
    </div>
  )
}
