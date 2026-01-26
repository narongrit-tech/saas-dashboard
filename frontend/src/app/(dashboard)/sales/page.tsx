'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SalesOrder, SalesOrderFilters } from '@/types/sales'
import { endOfDayBangkok, formatBangkok } from '@/lib/bangkok-time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UnifiedDateRangePicker, DateRangeValue } from '@/components/shared/UnifiedDateRangePicker';
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, Download, FileUp, Plus, Pencil, Trash2 } from 'lucide-react'
import { AddOrderDialog } from '@/components/sales/AddOrderDialog'
import { EditOrderDialog } from '@/components/sales/EditOrderDialog'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { SalesImportDialog } from '@/components/sales/SalesImportDialog'
import { deleteOrder, exportSalesOrders } from '@/app/(dashboard)/sales/actions'

const PLATFORMS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'tiktok_shop', label: 'TikTok' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
  { value: 'line', label: 'Line' },
  { value: 'facebook', label: 'Facebook' },
]

// FIX: Platform Status values from TikTok Order Substatus (Thai)
const STATUSES = [
  { value: 'รอจัดส่ง', label: 'รอจัดส่ง' },
  { value: 'อยู่ระหว่างงานขนส่ง', label: 'อยู่ระหว่างงานขนส่ง' },
  { value: 'จัดส่งสำเร็จ', label: 'จัดส่งสำเร็จ' },
  { value: 'ยกเลิกคำสั่งซื้อ', label: 'ยกเลิกคำสั่งซื้อ' },
]

const PAYMENT_STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'unpaid', label: 'Unpaid' },
]

const PAGE_SIZES = [20, 50, 100]

export default function SalesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  // Parse filters from URL params
  const getFiltersFromURL = (): SalesOrderFilters => {
    const statusParam = searchParams.get('status')
    return {
      sourcePlatform: searchParams.get('platform') || undefined,
      status: statusParam ? statusParam.split(',') : undefined,
      paymentStatus: searchParams.get('paymentStatus') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      search: searchParams.get('search') || undefined,
      page: parseInt(searchParams.get('page') || '1', 10),
      perPage: parseInt(searchParams.get('perPage') || '20', 10),
    }
  }

  const [filters, setFilters] = useState<SalesOrderFilters>(getFiltersFromURL())

  // Update URL when filters change
  const updateURL = (newFilters: SalesOrderFilters) => {
    const params = new URLSearchParams()

    if (newFilters.sourcePlatform && newFilters.sourcePlatform !== 'all') {
      params.set('platform', newFilters.sourcePlatform)
    }
    if (newFilters.status && newFilters.status.length > 0) {
      params.set('status', newFilters.status.join(','))
    }
    if (newFilters.paymentStatus && newFilters.paymentStatus !== 'all') {
      params.set('paymentStatus', newFilters.paymentStatus)
    }
    if (newFilters.startDate) {
      params.set('startDate', newFilters.startDate)
    }
    if (newFilters.endDate) {
      params.set('endDate', newFilters.endDate)
    }
    if (newFilters.search) {
      params.set('search', newFilters.search)
    }
    if (newFilters.page > 1) {
      params.set('page', newFilters.page.toString())
    }
    if (newFilters.perPage !== 20) {
      params.set('perPage', newFilters.perPage.toString())
    }

    router.push(`/sales?${params.toString()}`, { scroll: false })
  }

  // Sync URL params to state
  useEffect(() => {
    const urlFilters = getFiltersFromURL()
    setFilters(urlFilters)
  }, [searchParams])

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

      // Platform filter (UX v2)
      if (filters.sourcePlatform && filters.sourcePlatform !== 'all') {
        query = query.eq('source_platform', filters.sourcePlatform)
      }

      // Status filter (multi-select, UX v2) - now filters by platform_status (Thai values)
      if (filters.status && filters.status.length > 0) {
        query = query.in('platform_status', filters.status)
      }

      // Payment status filter (UX v2)
      if (filters.paymentStatus && filters.paymentStatus !== 'all') {
        query = query.eq('payment_status', filters.paymentStatus)
      }

      // Date range filters
      if (filters.startDate) {
        query = query.gte('order_date', filters.startDate)
      }

      if (filters.endDate) {
        // Use Bangkok timezone for end of day
        const endBangkok = endOfDayBangkok(filters.endDate)
        query = query.lte('order_date', endBangkok.toISOString())
      }

      // Search filter (order_id, product_name, external_order_id)
      if (filters.search && filters.search.trim()) {
        query = query.or(
          `order_id.ilike.%${filters.search}%,product_name.ilike.%${filters.search}%,external_order_id.ilike.%${filters.search}%`
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

  const handleFilterChange = (key: keyof SalesOrderFilters, value: string | string[] | number | undefined) => {
    const newFilters = { ...filters, [key]: value, page: 1 }
    setFilters(newFilters)
    updateURL(newFilters)
  }

  const handleDateRangeChange = (range: DateRangeValue) => {
    const newFilters = {
      ...filters,
      startDate: formatBangkok(range.from, 'yyyy-MM-dd'),
      endDate: formatBangkok(range.to, 'yyyy-MM-dd'),
      page: 1
    }
    setFilters(newFilters)
    updateURL(newFilters)
  }

  const handleStatusToggle = (status: string) => {
    const currentStatuses = filters.status || []
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter((s) => s !== status)
      : [...currentStatuses, status]

    const newFilters = { ...filters, status: newStatuses, page: 1 }
    setFilters(newFilters)
    updateURL(newFilters)
  }

  const handlePageChange = (newPage: number) => {
    const newFilters = { ...filters, page: newPage }
    setFilters(newFilters)
    updateURL(newFilters)
  }

  const handlePageSizeChange = (newPageSize: number) => {
    const newFilters = { ...filters, perPage: newPageSize, page: 1 }
    setFilters(newFilters)
    updateURL(newFilters)
  }

  const handleJumpToPage = (pageInput: string) => {
    const pageNum = parseInt(pageInput, 10)
    const totalPages = Math.ceil(totalCount / filters.perPage)
    if (pageNum >= 1 && pageNum <= totalPages) {
      handlePageChange(pageNum)
    }
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

  const getPlatformLabel = (platform?: string | null) => {
    if (!platform) return '-'
    const found = PLATFORMS.find((p) => p.value === platform)
    return found ? found.label : platform
  }

  const getPlatformStatusBadge = (platformStatus?: string | null) => {
    if (!platformStatus) return <span className="text-muted-foreground text-xs">-</span>
    // Platform Status = Order Substatus (รอจัดส่ง, อยู่ระหว่างงานขนส่ง, ยกเลิกคำสั่งซื้อ)
    const statusLower = platformStatus.toLowerCase()

    // Cancelled orders - red
    if (statusLower.includes('ยกเลิก')) {
      return (
        <Badge className="bg-red-500 hover:bg-red-600 text-white text-xs">
          {platformStatus}
        </Badge>
      )
    }

    // Delivered/Completed orders - green
    if (statusLower.includes('จัดส่งแล้ว') || statusLower.includes('ส่งสำเร็จ') || statusLower.includes('สำเร็จ')) {
      return (
        <Badge className="bg-green-500 hover:bg-green-600 text-white text-xs">
          {platformStatus}
        </Badge>
      )
    }

    // Pending orders (รอจัดส่ง, อยู่ระหว่าง) - yellow/orange
    return (
      <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs">
        {platformStatus}
      </Badge>
    )
  }

  const getStatusGroupBadge = (statusGroup?: string | null) => {
    if (!statusGroup) return <span className="text-muted-foreground text-xs">-</span>
    // Status Group = Order Status (ที่จัดส่ง, ชำระเงินแล้ว, ยกเลิกแล้ว)
    return (
      <Badge variant="outline" className="text-xs">
        {statusGroup}
      </Badge>
    )
  }

  const getPaymentStatusBadge = (paymentStatus?: string | null) => {
    if (!paymentStatus) return null
    if (paymentStatus === 'paid') {
      return (
        <Badge className="bg-blue-500 hover:bg-blue-600 text-white text-xs">
          Paid
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-xs">
        {paymentStatus}
      </Badge>
    )
  }

  const handleEdit = (order: SalesOrder) => {
    setSelectedOrder(order)
    setShowEditDialog(true)
  }

  const handleDeleteClick = (order: SalesOrder) => {
    setSelectedOrder(order)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    if (!selectedOrder) return

    setDeleteLoading(true)
    setError(null)

    try {
      const result = await deleteOrder(selectedOrder.id)

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการลบข้อมูล')
        setShowDeleteDialog(false)
        return
      }

      // Success - close dialog and refresh
      setShowDeleteDialog(false)
      setSelectedOrder(null)
      fetchOrders()
    } catch (err) {
      console.error('Error deleting order:', err)
      setError('เกิดข้อผิดพลาดในการลบข้อมูล')
      setShowDeleteDialog(false)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleExport = async () => {
    setExportLoading(true)
    setError(null)

    try {
      const result = await exportSalesOrders({
        sourcePlatform: filters.sourcePlatform,
        status: filters.status,
        paymentStatus: filters.paymentStatus,
        startDate: filters.startDate,
        endDate: filters.endDate,
        search: filters.search,
      })

      if (!result.success || !result.csv || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการ export')
        return
      }

      // Create blob and download
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Error exporting orders:', err)
      setError('เกิดข้อผิดพลาดในการ export')
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sales Orders</h1>
      </div>

      {/* Filters - UX v2 */}
      <div className="space-y-4">
        {/* Row 1: Platform, Status Multi-Select, Payment Status */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Platform</label>
            <Select
              value={filters.sourcePlatform || 'all'}
              onValueChange={(value) =>
                handleFilterChange('sourcePlatform', value === 'all' ? undefined : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All Platforms" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((platform) => (
                  <SelectItem key={platform.value} value={platform.value}>
                    {platform.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Status</label>
            <div className="flex items-center gap-4 border rounded-md p-2.5 bg-white">
              {STATUSES.map((status) => (
                <div key={status.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`status-${status.value}`}
                    checked={filters.status?.includes(status.value)}
                    onCheckedChange={() => handleStatusToggle(status.value)}
                  />
                  <Label
                    htmlFor={`status-${status.value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {status.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Payment</label>
            <Select
              value={filters.paymentStatus || 'all'}
              onValueChange={(value) =>
                handleFilterChange('paymentStatus', value === 'all' ? undefined : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUSES.map((ps) => (
                  <SelectItem key={ps.value} value={ps.value}>
                    {ps.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: Date Range, Search */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">ช่วงวันที่</label>
            <UnifiedDateRangePicker
              value={
                filters.startDate && filters.endDate
                  ? {
                      from: new Date(filters.startDate),
                      to: new Date(filters.endDate)
                    }
                  : undefined
              }
              onChange={handleDateRangeChange}
              defaultPreset="last7"
            />
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">ค้นหา</label>
            <Input
              placeholder="Order ID, สินค้า, External Order ID..."
              value={filters.search || ''}
              onChange={(e) => handleFilterChange('search', e.target.value || undefined)}
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Order
        </Button>
        <Button variant="outline" onClick={() => setShowImportDialog(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Import
        </Button>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exportLoading || loading || orders.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          {exportLoading ? 'Exporting...' : 'Export CSV'}
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Table - UX v2 with Platform Status & Payment */}
      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-white z-10">
            <TableRow>
              <TableHead className="min-w-[140px]">Order ID</TableHead>
              <TableHead className="min-w-[100px]">Platform</TableHead>
              <TableHead className="min-w-[200px]">Product Name</TableHead>
              <TableHead className="text-right min-w-[60px]">Qty</TableHead>
              <TableHead className="text-right min-w-[120px]">Amount</TableHead>
              <TableHead className="min-w-[140px]">Status</TableHead>
              <TableHead className="min-w-[120px]">Status Group</TableHead>
              <TableHead className="min-w-[80px]">Payment</TableHead>
              <TableHead className="min-w-[100px]">Paid Date</TableHead>
              <TableHead className="min-w-[120px]">Order Date</TableHead>
              <TableHead className="text-right min-w-[100px]">Actions</TableHead>
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
                  <TableCell>
                    <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              // Empty state
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                    <p className="text-sm">No orders found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              // Data rows - UX v2 with platform status & payment
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium" title={order.external_order_id || order.order_id}>
                    <div className="max-w-[140px] truncate">
                      {order.external_order_id || order.order_id}
                    </div>
                  </TableCell>
                  <TableCell>{getPlatformLabel(order.source_platform || order.marketplace)}</TableCell>
                  <TableCell title={order.product_name}>
                    <div className="max-w-[200px] truncate">
                      {order.product_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{order.quantity}</TableCell>
                  <TableCell className="text-right">
                    ฿{formatCurrency(order.total_amount)}
                  </TableCell>
                  <TableCell>{getPlatformStatusBadge(order.platform_status)}</TableCell>
                  <TableCell>{getStatusGroupBadge(order.status_group)}</TableCell>
                  <TableCell>{getPaymentStatusBadge(order.payment_status)}</TableCell>
                  <TableCell>
                    {order.paid_at ? formatDate(order.paid_at) : '-'}
                  </TableCell>
                  <TableCell>{formatDate(order.order_date)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(order)}
                        title="แก้ไข"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(order)}
                        title="ลบ"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination - UX v2 with Page Size & Jump Controls */}
      {!loading && totalCount > 0 && (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Left: Record count */}
          <p className="text-sm text-muted-foreground">
            แสดง {(filters.page - 1) * filters.perPage + 1} ถึง{' '}
            {Math.min(filters.page * filters.perPage, totalCount)} จากทั้งหมด {totalCount}{' '}
            รายการ
          </p>

          {/* Right: Page Size, Jump, Prev/Next */}
          <div className="flex items-center gap-4">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show:</span>
              <Select
                value={filters.perPage.toString()}
                onValueChange={(value) => handlePageSizeChange(parseInt(value, 10))}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Jump to Page */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Page:</span>
              <Input
                type="number"
                min={1}
                max={Math.ceil(totalCount / filters.perPage)}
                value={filters.page}
                onChange={(e) => handleJumpToPage(e.target.value)}
                className="w-16 text-center"
              />
              <span className="text-sm text-muted-foreground">
                / {Math.ceil(totalCount / filters.perPage)}
              </span>
            </div>

            {/* Prev/Next Buttons */}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(filters.page + 1)}
                disabled={filters.page >= Math.ceil(totalCount / filters.perPage)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Order Dialog */}
      <AddOrderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={fetchOrders}
      />

      {/* Edit Order Dialog */}
      <EditOrderDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={fetchOrders}
        order={selectedOrder}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title="ยืนยันการลบ Order"
        description={`คุณต้องการลบ order ${selectedOrder?.order_id} ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้`}
      />

      {/* Import Dialog */}
      <SalesImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={fetchOrders}
      />
    </div>
  )
}
