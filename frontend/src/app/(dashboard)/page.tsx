import { StatCard } from '@/components/dashboard/stat-card'
import { SalesTrendChart } from '@/components/dashboard/SalesTrendChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Plus,
  FileText,
  Package,
} from 'lucide-react'
import {
  dashboardStats,
  recentOrders,
  statusColors,
  formatCurrencyShort,
} from '@/lib/mock-data'
import { getDashboardStats } from './actions'

export default async function DashboardPage() {
  const result = await getDashboardStats()

  // Handle error case
  if (!result.success || !result.data) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600">เกิดข้อผิดพลาด</p>
          <p className="text-sm text-muted-foreground">{result.error || 'ไม่สามารถโหลดข้อมูลได้'}</p>
        </div>
      </div>
    )
  }

  const { todayStats, trends } = result.data
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Sales Today"
          value={formatCurrencyShort(todayStats.totalSales)}
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          title="Total Expenses Today"
          value={formatCurrencyShort(todayStats.totalExpenses)}
          icon={TrendingDown}
          color="red"
        />
        <StatCard
          title="Net Profit Today"
          value={formatCurrencyShort(todayStats.netProfit)}
          icon={DollarSign}
          color="blue"
        />
        <StatCard
          title="Cash on Hand"
          value={formatCurrencyShort(dashboardStats.cashOnHand.value)}
          icon={Wallet}
          color="gray"
        />
      </div>

      {/* Sales Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Sales & Expenses Trend (Last 7 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesTrendChart data={trends} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Orders */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{order.id}</p>
                      <Badge
                        variant="secondary"
                        className={statusColors[order.status as keyof typeof statusColors]}
                      >
                        {order.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{order.customer}</p>
                    <p className="text-xs text-muted-foreground">{order.date}</p>
                  </div>
                  <p className="text-lg font-semibold">฿{order.amount.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full justify-start" variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              New Sale Order
            </Button>
            <Button className="w-full justify-start" variant="outline">
              <FileText className="mr-2 h-4 w-4" />
              Record Expense
            </Button>
            <Button className="w-full justify-start" variant="outline">
              <Package className="mr-2 h-4 w-4" />
              Add Inventory
            </Button>
            <Button className="w-full justify-start" variant="outline">
              <DollarSign className="mr-2 h-4 w-4" />
              Record Payment
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
