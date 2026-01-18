'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SalesOrder, SalesOrderFilters } from '@/types/sales'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Download, FileUp, Plus } from 'lucide-react'
import { AddOrderDialog } from '@/components/sales/AddOrderDialog'

const MARKETPLACES = ['All', 'TikTok', 'Shopee', 'Lazada', 'Line', 'Facebook']
const PER_PAGE = 20

export default function SalesPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const [filters, setFilters] = useState<SalesOrderFilters>({
    marketplace: undefined,
    startDate: undefined,
    endDate: undefined,
    search: undefined,
    page: 1,
    perPage: PER_PAGE,
  })

  useEffect(() => {
    fetchOrders()
  }, [filters])

  const fetchOrders = async () => {
    try {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      let query = supabase
        .from('sales_orders')
        .select('*', { count: 'exact' })
        .order('order_date', { ascending: false })

      // Apply filters
      if (filters.marketplace && filters.marketplace !== 'All') {
        query = query.eq('marketplace', filters.marketplace)
      }

      if (filters.startDate) {
        query = query.gte('order_date', filters.startDate)
      }

      if (filters.endDate) {
        const endOfDay = new Date(filters.endDate)
        endOfDay.setHours(23, 59, 59, 999)
        query = query.lte('order_date', endOfDay.toISOString())
      }

      if (filters.search && filters.search.trim()) {
        query = query.or(
          `order_id.ilike.%${filters.search}%,product_name.ilike.%${filters.search}%`
        )
      }

      // Pagination
      const from = (filters.page - 1) * filters.perPage
      const to = from + filters.perPage - 1
      query = query.range(from, to)

      const { data, error: fetchError, count } = await query

      if (fetchError) throw fetchError

      setOrders(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching orders:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: keyof SalesOrderFilters, value: any) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }))
  }

  const getStatusBadge = (status: string) => {
    const statusLower = status.toLowerCase()
    if (statusLower === 'completed') {
      return (
        <Badge className="bg-green-500 hover:bg-green-600 text-white">
          Completed
        </Badge>
      )
    }
    if (statusLower === 'pending') {
      return (
        <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">
          Pending
        </Badge>
      )
    }
    if (statusLower === 'cancelled') {
      return (
        <Badge className="bg-red-500 hover:bg-red-600 text-white">
          Cancelled
        </Badge>
      )
    }
    return <Badge>{status}</Badge>
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const totalPages = Math.ceil(totalCount / PER_PAGE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sales Orders</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">Marketplace</label>
          <Select
            value={filters.marketplace || 'All'}
            onValueChange={(value) =>
              handleFilterChange('marketplace', value === 'All' ? undefined : value)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="เลือก marketplace" />
            </SelectTrigger>
            <SelectContent>
              {MARKETPLACES.map((marketplace) => (
                <SelectItem key={marketplace} value={marketplace}>
                  {marketplace}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">วันที่เริ่มต้น</label>
          <Input
            type="date"
            value={filters.startDate || ''}
            onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
          />
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">วันที่สิ้นสุด</label>
          <Input
            type="date"
            value={filters.endDate || ''}
            onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
          />
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">ค้นหา</label>
          <Input
            placeholder="ค้นหา order id หรือสินค้า..."
            value={filters.search || ''}
            onChange={(e) => handleFilterChange('search', e.target.value || undefined)}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Order
        </Button>
        <Button variant="outline" disabled>
          <FileUp className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
        <Button variant="outline" disabled>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Marketplace</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Order Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="ml-auto h-4 w-8 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="ml-auto h-4 w-20 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              // Empty state
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                    <p className="text-sm">No orders found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              // Data rows
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.order_id}</TableCell>
                  <TableCell>{order.marketplace}</TableCell>
                  <TableCell>{order.product_name}</TableCell>
                  <TableCell className="text-right">{order.quantity}</TableCell>
                  <TableCell className="text-right">
                    ฿{formatCurrency(order.total_amount)}
                  </TableCell>
                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                  <TableCell>{formatDate(order.order_date)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {!loading && orders.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            แสดง {(filters.page - 1) * PER_PAGE + 1} ถึง{' '}
            {Math.min(filters.page * PER_PAGE, totalCount)} จากทั้งหมด {totalCount}{' '}
            รายการ
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(filters.page - 1)}
              disabled={filters.page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm">
              หน้า {filters.page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(filters.page + 1)}
              disabled={filters.page >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Add Order Dialog */}
      <AddOrderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={fetchOrders}
      />
    </div>
  )
}
