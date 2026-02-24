'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SalesOrder, SalesOrderFilters, GroupedSalesOrder } from '@/types/sales'
import { endOfDayBangkok, formatBangkok, getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateRangePicker, DateRangeResult } from '@/components/shared/DateRangePicker'
import { GMVCards } from '@/components/sales/GMVCards'
import { getSalesOrdersGrouped, getSalesGMVSummary, GMVSummary, getMainSkuOutflowSummary, MainSkuOutflowRow } from '@/app/(dashboard)/sales/actions'
import { useLatestOnly } from '@/hooks/useLatestOnly'
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
import { ChevronLeft, ChevronRight, Download, FileUp, Plus, Pencil, Trash2, Eye, RotateCcw, Package, Link, ChevronDown, ChevronUp } from 'lucide-react'
import { AddOrderDialog } from '@/components/sales/AddOrderDialog'
import { EditOrderDialog } from '@/components/sales/EditOrderDialog'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { SalesImportDialog } from '@/components/sales/SalesImportDialog'
import { ShopeeOrdersImportDialog } from '@/components/sales/ShopeeOrdersImportDialog'
import { ResetTikTokDialog } from '@/components/sales/ResetTikTokDialog'
import { OrderDetailDrawer } from '@/components/sales/OrderDetailDrawer'
import { ApplyCOGSMTDModal } from '@/components/inventory/ApplyCOGSMTDModal'
import { AffiliateImportDialog } from '@/components/shared/AffiliateImportDialog'
import { AttributionBadge } from '@/components/sales/AttributionBadge'
import { batchFetchAttributions } from '@/app/(dashboard)/sales/attribution-actions'
import { OrderAttribution } from '@/types/profit-reports'
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

interface SalesPageClientProps {
  isAdmin: boolean
  debugInfo?: {
    userId?: string
    hasUser: boolean
    roleError?: string
    roleData?: string
    source: string
  }
}

export default function SalesPageClient({ isAdmin, debugInfo }: SalesPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Race condition guards (must be separate per data flow)
  // to avoid cross-cancelling orders vs GMV requests.
  const { runLatest: runLatestOrders } = useLatestOnly()
  const { runLatest: runLatestGmv } = useLatestOnly()
  const { runLatest: runLatestSkuOutflow } = useLatestOnly()

  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [groupedOrders, setGroupedOrders] = useState<GroupedSalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showShopeeImportDialog, setShowShopeeImportDialog] = useState(false)
  const [showAffiliateImportDialog, setShowAffiliateImportDialog] = useState(false)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [showCOGSMTDModal, setShowCOGSMTDModal] = useState(false)
  const [showDetailDrawer, setShowDetailDrawer] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  // GMV Summary state
  const [gmvSummary, setGmvSummary] = useState<GMVSummary | null>(null)
  const [gmvSummaryLoading, setGmvSummaryLoading] = useState(true)
  const [gmvSummaryError, setGmvSummaryError] = useState<string | null>(null)

  // Main SKU Outflow state
  const [mainSkuOutflow, setMainSkuOutflow] = useState<MainSkuOutflowRow[]>([])
  const [mainSkuOutflowLoading, setMainSkuOutflowLoading] = useState(false)
  const [mainSkuOutflowCollapsed, setMainSkuOutflowCollapsed] = useState(false)

  // Attribution data (batch fetched)
  const [attributions, setAttributions] = useState<Map<string, OrderAttribution>>(new Map())

  // View state (order or line)
  const [view, setView] = useState<'order' | 'line'>('order')

  // Date basis state (order or paid) - uses TikTok timestamps (created_time or paid_time)
  const [dateBasis, setDateBasis] = useState<'order' | 'paid'>('order')

  // Initial filters state (will be synced from URL)
  const [filters, setFilters] = useState<SalesOrderFilters>({
    page: 1,
    perPage: 20,
  })

  // Effect A: URL → State (read URL and update state, NO router calls)
  useEffect(() => {
    const statusParam = searchParams.get('status')
    const basisParam = searchParams.get('basis') // Can be 'order' | 'paid' | 'order_date' | 'paid_at' | null
    const viewParam = searchParams.get('view') as 'order' | 'line' | null

    // Default date range: Today (Bangkok timezone) if no params
    const hasDateParams = searchParams.get('startDate') || searchParams.get('endDate')
    const todayStart = hasDateParams ? undefined : formatBangkok(startOfDayBangkok(), 'yyyy-MM-dd')
    const todayEnd = hasDateParams ? undefined : formatBangkok(getBangkokNow(), 'yyyy-MM-dd')

    // Parse and clamp pagination params
    const pageRaw = parseInt(searchParams.get('page') || '1', 10)
    const perPageRaw = parseInt(searchParams.get('perPage') || '20', 10)

    // Clamp page: min 1
    const pageClamped = Math.max(1, pageRaw)

    // Clamp perPage: 1-200
    const perPageClamped = Math.max(1, Math.min(200, perPageRaw))

    const urlFilters: SalesOrderFilters = {
      sourcePlatform: searchParams.get('platform') || undefined,
      status: statusParam ? statusParam.split(',') : undefined,
      paymentStatus: searchParams.get('paymentStatus') || undefined,
      startDate: searchParams.get('startDate') || todayStart,
      endDate: searchParams.get('endDate') || todayEnd,
      search: searchParams.get('search') || undefined,
      page: pageClamped,
      perPage: perPageClamped,
      view: viewParam || 'order',
    }

    // Update view from URL (guarded)
    const newView = (viewParam === 'order' || viewParam === 'line') ? viewParam : 'order'
    setView(prev => prev !== newView ? newView : prev)

    // Update date basis from URL (guarded) - convert old values to new
    let newBasis: 'order' | 'paid' = 'order'
    if (basisParam === 'order' || basisParam === 'order_date') {
      newBasis = 'order'
    } else if (basisParam === 'paid' || basisParam === 'paid_at') {
      newBasis = 'paid'
    }
    setDateBasis(prev => prev !== newBasis ? newBasis : prev)

    // Update filters from URL (guarded)
    setFilters(prev => {
      const changed = (
        prev.sourcePlatform !== urlFilters.sourcePlatform ||
        JSON.stringify(prev.status) !== JSON.stringify(urlFilters.status) ||
        prev.paymentStatus !== urlFilters.paymentStatus ||
        prev.startDate !== urlFilters.startDate ||
        prev.endDate !== urlFilters.endDate ||
        prev.search !== urlFilters.search ||
        prev.page !== urlFilters.page ||
        prev.perPage !== urlFilters.perPage ||
        prev.view !== urlFilters.view
      )
      return changed ? urlFilters : prev
    })
  }, [searchParams])

  // Effect B: State → URL (read state and update URL if needed, NO setState calls)
  useEffect(() => {
    const params = new URLSearchParams()

    // Add view
    params.set('view', view)

    // Add date basis
    params.set('basis', dateBasis)

    if (filters.sourcePlatform && filters.sourcePlatform !== 'all') {
      params.set('platform', filters.sourcePlatform)
    }
    if (filters.status && filters.status.length > 0) {
      params.set('status', filters.status.join(','))
    }
    if (filters.paymentStatus && filters.paymentStatus !== 'all') {
      params.set('paymentStatus', filters.paymentStatus)
    }
    if (filters.startDate) {
      params.set('startDate', filters.startDate)
    }
    if (filters.endDate) {
      params.set('endDate', filters.endDate)
    }
    if (filters.search) {
      params.set('search', filters.search)
    }
    if (filters.page > 1) {
      params.set('page', filters.page.toString())
    }
    if (filters.perPage !== 20) {
      params.set('perPage', filters.perPage.toString())
    }

    const newQueryString = params.toString()
    const currentQueryString = searchParams.toString()

    // Only update URL if query string changed
    if (newQueryString !== currentQueryString) {
      router.replace(`/sales?${newQueryString}`, { scroll: false })
    }
  }, [view, dateBasis, filters.sourcePlatform, filters.status, filters.paymentStatus, filters.startDate, filters.endDate, filters.search, filters.page, filters.perPage])

  // FIX: Extract primitive dependencies to prevent infinite loop
  const {
    sourcePlatform,
    status,
    paymentStatus,
    startDate,
    endDate,
    search,
    page,
    perPage,
  } = filters

  // Convert array to string for stable comparison
  const statusString = status?.join(',') || ''

  useEffect(() => {
    fetchOrders()
    fetchGMVSummary()
    fetchMainSkuOutflow()
  }, [sourcePlatform, statusString, paymentStatus, startDate, endDate, search, page, perPage, dateBasis, view])

  const fetchGMVSummary = async () => {
    await runLatestGmv(async (signal) => {
      try {
        setGmvSummaryLoading(true)
        setGmvSummaryError(null)

        // Only fetch if we have a date range
        if (!filters.startDate || !filters.endDate) {
          setGmvSummary(null)
          setGmvSummaryLoading(false)
          return
        }

        const result = await getSalesGMVSummary(
          {
            sourcePlatform: filters.sourcePlatform,
            status: filters.status,
            paymentStatus: filters.paymentStatus,
            startDate: filters.startDate,
            endDate: filters.endDate,
            search: filters.search,
          },
          dateBasis
        )

        // Guard: discard stale responses
        if (signal.isStale) return

        if (!result.success) {
          setGmvSummaryError(result.error || 'เกิดข้อผิดพลาดในการโหลด GMV Summary')
          setGmvSummary(null)
          return
        }

        setGmvSummary(result.data || null)
      } catch (err) {
        // Guard: discard stale errors
        if (signal.isStale) return

        console.error('Error fetching GMV summary:', err)
        setGmvSummaryError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลด GMV Summary')
        setGmvSummary(null)
      } finally {
        // Only clear loading if this is still the latest request
        if (!signal.isStale) {
          setGmvSummaryLoading(false)
        }
      }
    })
  }

  const fetchMainSkuOutflow = async () => {
    await runLatestSkuOutflow(async (signal) => {
      setMainSkuOutflowLoading(true)
      try {
        const result = await getMainSkuOutflowSummary({
          sourcePlatform: filters.sourcePlatform,
          status: filters.status,
          paymentStatus: filters.paymentStatus,
          startDate: filters.startDate,
          endDate: filters.endDate,
          search: filters.search,
          dateBasis: dateBasis,
        })
        if (signal.isStale) return
        if (result.success) {
          setMainSkuOutflow(result.data || [])
        }
      } catch (err) {
        if (signal.isStale) return
        console.error('Error fetching main SKU outflow:', err)
      } finally {
        if (!signal.isStale) setMainSkuOutflowLoading(false)
      }
    })
  }

  const fetchOrders = async () => {
    await runLatestOrders(async (signal) => {
      try {
        setLoading(true)
        setError(null)

        console.log('[Sales Pagination Debug] Query params:', {
          view,
          page: filters.page,
          perPage: filters.perPage,
          basis: dateBasis,
          startDate: filters.startDate,
          endDate: filters.endDate,
          platform: filters.sourcePlatform,
          status: filters.status,
          paymentStatus: filters.paymentStatus,
          search: filters.search,
        })

        // Branch: Order View vs Line View
        if (view === 'order') {
          const result = await getSalesOrdersGrouped({
            sourcePlatform: filters.sourcePlatform,
            status: filters.status,
            paymentStatus: filters.paymentStatus,
            startDate: filters.startDate,
            endDate: filters.endDate,
            search: filters.search,
            dateBasis: dateBasis,
            page: filters.page,
            perPage: filters.perPage,
          })

          // Guard: discard stale responses
          if (signal.isStale) return

          if (!result.success) {
            setError(result.error || 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
            setGroupedOrders([])
            setTotalCount(0)
            return
          }

          setGroupedOrders(result.data || [])
          setTotalCount(result.count || 0)
          console.log('[Sales Pagination Debug] Order View results:', {
            orders: result.data?.length || 0,
            count: result.count,
          })

          // Batch fetch attributions for order view
          const orderIds = (result.data || []).map(o => o.order_id)
          if (orderIds.length > 0) {
            const attributionMap = await batchFetchAttributions(orderIds)

            // Guard: discard stale responses
            if (signal.isStale) return

            setAttributions(attributionMap)
          }
        } else {
          // Line View
          const offset = (filters.page - 1) * filters.perPage
          const from = offset
          const to = offset + filters.perPage - 1

          const supabase = createClient()

          let query = supabase
            .from('sales_orders')
            .select('*', { count: 'exact' })

          if (dateBasis === 'order') {
            query = query.order('created_time', { ascending: false })
          } else {
            query = query.order('paid_time', { ascending: false })
          }

          if (filters.sourcePlatform && filters.sourcePlatform !== 'all') {
            query = query.eq('source_platform', filters.sourcePlatform)
          }

          if (filters.status && filters.status.length > 0) {
            query = query.in('platform_status', filters.status)
          }

          if (filters.paymentStatus && filters.paymentStatus !== 'all') {
            query = query.eq('payment_status', filters.paymentStatus)
          }

          if (dateBasis === 'order') {
            if (filters.startDate) {
              query = query.gte('order_date', filters.startDate)
            }
            if (filters.endDate) {
              const endBangkok = endOfDayBangkok(filters.endDate)
              query = query.lte('order_date', endBangkok.toISOString())
            }
          } else {
            query = query.not('paid_time', 'is', null)
            if (filters.startDate) {
              query = query.gte('paid_time', filters.startDate)
            }
            if (filters.endDate) {
              const endBangkok = endOfDayBangkok(filters.endDate)
              query = query.lte('paid_time', endBangkok.toISOString())
            }
          }

          if (filters.search && filters.search.trim()) {
            query = query.or(
              `order_id.ilike.%${filters.search}%,product_name.ilike.%${filters.search}%,external_order_id.ilike.%${filters.search}%`
            )
          }

          query = query.range(from, to)

          const { data, error: fetchError, count } = await query

          // Guard: discard stale responses
          if (signal.isStale) return

          console.log('[Sales Pagination Debug] Line View results:', {
            rows: data?.length || 0,
            count,
            error: fetchError?.message || null,
          })

          if (fetchError) throw fetchError

          setOrders(data || [])
          setTotalCount(count || 0)

          // Batch fetch attributions for line view
          const orderIds = (data || []).map(o => o.order_id)
          if (orderIds.length > 0) {
            const attributionMap = await batchFetchAttributions(orderIds)

            // Guard: discard stale responses
            if (signal.isStale) return

            setAttributions(attributionMap)
          }
        }
      } catch (err) {
        // Guard: discard stale errors
        if (signal.isStale) return

        console.error('[Sales Pagination Error]:', err)
        const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล'
        setError(`เกิดข้อผิดพลาด: ${errorMessage}`)
      } finally {
        // Only clear loading if this is still the latest request
        if (!signal.isStale) {
          setLoading(false)
        }
      }
    })
  }

  const handleFilterChange = (key: keyof SalesOrderFilters, value: string | string[] | number | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }))
  }

  const handleDateRangeChange = (range: DateRangeResult) => {
    setFilters(prev => ({
      ...prev,
      startDate: formatBangkok(range.startDate, 'yyyy-MM-dd'),
      endDate: formatBangkok(range.endDate, 'yyyy-MM-dd'),
      page: 1
    }))
  }

  const handleStatusToggle = (status: string) => {
    setFilters(prev => {
      const currentStatuses = prev.status || []
      const newStatuses = currentStatuses.includes(status)
        ? currentStatuses.filter((s) => s !== status)
        : [...currentStatuses, status]
      return { ...prev, status: newStatuses, page: 1 }
    })
  }

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }))
  }

  const handlePageSizeChange = (newPageSize: number) => {
    const clamped = Math.max(1, Math.min(200, newPageSize))
    setFilters(prev => ({ ...prev, perPage: clamped, page: 1 }))
  }

  const handleJumpToPage = (pageInput: string) => {
    const pageNum = parseInt(pageInput, 10)
    const totalPages = Math.ceil(totalCount / filters.perPage)
    if (pageNum >= 1 && pageNum <= totalPages) {
      handlePageChange(pageNum)
    }
  }

  const handleDateBasisChange = (newBasis: 'order' | 'paid') => {
    setDateBasis(newBasis)
  }

  const handleViewChange = (newView: 'order' | 'line') => {
    setView(newView)
    setFilters(prev => ({ ...prev, page: 1 }))
  }

  const handleViewOrderDetail = (orderId: string) => {
    setSelectedOrderId(orderId)
    setShowDetailDrawer(true)
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
    const statusLower = platformStatus.toLowerCase()

    if (statusLower.includes('ยกเลิก')) {
      return (
        <Badge className="bg-red-500 hover:bg-red-600 text-white text-xs">
          {platformStatus}
        </Badge>
      )
    }

    if (statusLower.includes('จัดส่งแล้ว') || statusLower.includes('ส่งสำเร็จ') || statusLower.includes('สำเร็จ')) {
      return (
        <Badge className="bg-green-500 hover:bg-green-600 text-white text-xs">
          {platformStatus}
        </Badge>
      )
    }

    return (
      <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs">
        {platformStatus}
      </Badge>
    )
  }

  const getStatusGroupBadge = (statusGroup?: string | null) => {
    if (!statusGroup) return <span className="text-muted-foreground text-xs">-</span>
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

  const handleExport = async (exportView: 'order' | 'line') => {
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
        view: exportView,
        dateBasis: dateBasis,
      })

      if (!result.success || !result.csv || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการ export')
        return
      }

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

      <GMVCards
        data={gmvSummary}
        loading={gmvSummaryLoading}
        error={gmvSummaryError}
        dateBasis={dateBasis}
      />

      {/* DEBUG CHIP (Dev Only) */}
      {process.env.NODE_ENV !== 'production' && debugInfo && (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-xs dark:bg-blue-950">
          <div className="font-bold text-blue-900 dark:text-blue-100 mb-1">
            🔍 Admin Debug Info (Dev Only)
          </div>
          <div className="grid grid-cols-2 gap-2 text-blue-800 dark:text-blue-200">
            <div>
              <span className="font-medium">isAdmin:</span>{' '}
              <code className={isAdmin ? 'text-green-600 dark:text-green-400 font-bold' : 'text-red-600 dark:text-red-400 font-bold'}>
                {isAdmin ? 'true ✅' : 'false ❌'}
              </code>
            </div>
            <div>
              <span className="font-medium">Source:</span> <code>{debugInfo.source}</code>
            </div>
            <div>
              <span className="font-medium">User ID:</span>{' '}
              <code>{debugInfo.userId || 'N/A'}</code>
            </div>
            <div>
              <span className="font-medium">Has User:</span>{' '}
              <code>{debugInfo.hasUser ? 'Yes' : 'No'}</code>
            </div>
            <div>
              <span className="font-medium">Role Data:</span>{' '}
              <code>{debugInfo.roleData || 'N/A'}</code>
            </div>
            <div>
              <span className="font-medium">Role Error:</span>{' '}
              <code className="text-red-600 dark:text-red-400">
                {debugInfo.roleError || 'None'}
              </code>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* View Toggle */}
        <div className="flex items-center gap-4 p-3 border rounded-lg bg-purple-50 dark:bg-purple-950">
          <label className="text-sm font-medium">มุมมอง:</label>
          <div className="flex items-center gap-2">
            <Button
              variant={view === 'order' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleViewChange('order')}
            >
              Order View (1 row per order)
            </Button>
            <Button
              variant={view === 'line' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleViewChange('line')}
            >
              Line View (raw lines)
            </Button>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {view === 'order' ? 'แสดง 1 แถวต่อออเดอร์ (รวม SKU หลายตัว)' : 'แสดงทุก line items (1 แถวต่อ SKU)'}
          </span>
        </div>

        {/* Date Basis Selector */}
        <div className="flex items-center gap-4 p-3 border rounded-lg bg-blue-50 dark:bg-blue-950">
          <label className="text-sm font-medium">กรองวันที่ตาม:</label>
          <div className="flex items-center gap-2">
            <Button
              variant={dateBasis === 'order' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleDateBasisChange('order')}
            >
              วันสั่งซื้อ (Order Date)
            </Button>
            <Button
              variant={dateBasis === 'paid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleDateBasisChange('paid')}
            >
              วันชำระเงิน (Paid Date)
            </Button>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {dateBasis === 'order' ? 'แสดงทุกออเดอร์ตามวันที่สั่ง' : 'แสดงเฉพาะออเดอร์ที่ชำระเงินแล้ว'}
          </span>
        </div>

        {/* Filters Row 1 */}
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

        {/* Filters Row 2 */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">ช่วงวันที่</label>
            <DateRangePicker
              value={{
                startDate: filters.startDate ? new Date(filters.startDate) : startOfDayBangkok(),
                endDate: filters.endDate ? new Date(filters.endDate) : endOfDayBangkok(),
              }}
              onChange={handleDateRangeChange}
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
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Order
        </Button>
        <Button variant="outline" onClick={() => setShowImportDialog(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Import TikTok
        </Button>
        <Button variant="outline" onClick={() => setShowShopeeImportDialog(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Import Shopee
        </Button>
        <Button variant="outline" onClick={() => setShowAffiliateImportDialog(true)}>
          <Link className="mr-2 h-4 w-4" />
          Attach Affiliate
        </Button>
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => setShowResetDialog(true)}
            className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset TikTok (OrderSKUList)
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => setShowCOGSMTDModal(true)}
            className="border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            <Package className="mr-2 h-4 w-4" />
            Apply COGS (MTD)
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleExport('line')}
            disabled={exportLoading || loading || orders.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportLoading ? 'Exporting...' : 'Export Lines CSV'}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport('order')}
            disabled={exportLoading || loading || (view === 'order' ? groupedOrders.length === 0 : orders.length === 0)}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportLoading ? 'Exporting...' : 'Export Orders CSV'}
          </Button>
        </div>
      </div>

      {/* Main SKU Outflow Summary */}
      <div className="rounded-md border bg-white dark:bg-gray-900">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
          onClick={() => setMainSkuOutflowCollapsed((v) => !v)}
        >
          <div>
            <span className="font-semibold text-sm">Main SKU Outflow (Filtered)</span>
            <span className="ml-2 text-xs text-muted-foreground">
              รวมจำนวนสินค้า Main SKU ที่ออกไป (รวมแตก bundle เป็น component) — Top 20
            </span>
          </div>
          {mainSkuOutflowCollapsed ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {!mainSkuOutflowCollapsed && (
          <div className="border-t px-4 py-3">
            {mainSkuOutflowLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-12 animate-pulse rounded bg-gray-200" />
                  </div>
                ))}
              </div>
            ) : mainSkuOutflow.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">ไม่พบข้อมูล (ตาม filter ที่เลือก)</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">#</th>
                      <th className="pb-2 pr-6 font-medium">SKU</th>
                      <th className="pb-2 pr-4 text-right font-medium">Qty Out</th>
                      <th className="pb-2 text-right font-medium">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mainSkuOutflow.map((row, idx) => (
                      <tr key={row.sku} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="py-1.5 pr-4 text-muted-foreground">{idx + 1}</td>
                        <td className="py-1.5 pr-6 font-mono font-medium">{row.sku}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{row.qty_out.toLocaleString()}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{row.orders_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-white z-10">
            {view === 'order' ? (
              <TableRow>
                <TableHead className="min-w-[140px]">Order ID</TableHead>
                <TableHead className="min-w-[100px]">Platform</TableHead>
                <TableHead className="min-w-[150px]">Source / Affiliate</TableHead>
                <TableHead className="min-w-[140px]">Status</TableHead>
                <TableHead className="min-w-[80px]">Payment</TableHead>
                <TableHead className="text-right min-w-[80px]">Total Units</TableHead>
                <TableHead className="text-right min-w-[120px]">Order Amount</TableHead>
                <TableHead className="min-w-[100px]">Paid Date</TableHead>
                <TableHead className="min-w-[110px]">Shipped Date</TableHead>
                <TableHead className="min-w-[120px]">Order Date</TableHead>
                <TableHead className="text-right min-w-[80px]">Actions</TableHead>
              </TableRow>
            ) : (
              <TableRow>
                <TableHead className="min-w-[140px]">Order ID</TableHead>
                <TableHead className="min-w-[100px]">Platform</TableHead>
                <TableHead className="min-w-[150px]">Source / Affiliate</TableHead>
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
            )}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-16 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-32 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="ml-auto h-4 w-8 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="ml-auto h-4 w-20 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-16 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></TableCell>
                  <TableCell><div className="h-4 w-16 animate-pulse rounded bg-gray-200" /></TableCell>
                </TableRow>
              ))
            ) : view === 'order' && groupedOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                    <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                    <p className="text-sm">No orders found</p>
                    {dateBasis === 'paid' && (
                      <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        <p>💡 ถ้าไฟล์ import ไม่มี Paid Date ให้ลอง</p>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => handleDateBasisChange('order')}
                          className="text-amber-600 dark:text-amber-400 underline"
                        >
                          สลับไปดู "วันสั่งซื้อ (Order Date)"
                        </Button>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : view === 'line' && orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground space-y-2">
                    <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                    <p className="text-sm">No orders found</p>
                    {dateBasis === 'paid' && (
                      <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        <p>💡 ถ้าไฟล์ import ไม่มี Paid Date ให้ลอง</p>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => handleDateBasisChange('order')}
                          className="text-amber-600 dark:text-amber-400 underline"
                        >
                          สลับไปดู "วันสั่งซื้อ (Order Date)"
                        </Button>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : view === 'order' ? (
              groupedOrders.map((order) => (
                <TableRow key={order.order_id}>
                  <TableCell className="font-medium" title={order.external_order_id || order.order_id}>
                    <div className="max-w-[140px] truncate">
                      {order.external_order_id || order.order_id}
                    </div>
                  </TableCell>
                  <TableCell>{getPlatformLabel(order.source_platform || order.marketplace)}</TableCell>
                  <TableCell>
                    <AttributionBadge attribution={attributions.get(order.order_id)} />
                  </TableCell>
                  <TableCell>{getPlatformStatusBadge(order.platform_status)}</TableCell>
                  <TableCell>{getPaymentStatusBadge(order.payment_status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{order.total_units}</span>
                      <span className="text-xs text-muted-foreground">({order.sku_count} SKUs)</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ฿{formatCurrency(order.order_amount)}
                  </TableCell>
                  <TableCell>
                    {order.paid_at ? formatDate(order.paid_at) : '-'}
                  </TableCell>
                  <TableCell>
                    {order.shipped_at ? formatDate(order.shipped_at) : '-'}
                  </TableCell>
                  <TableCell>{formatDate(order.order_date)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewOrderDetail(order.order_id)}
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium" title={order.external_order_id || order.order_id}>
                    <div className="max-w-[140px] truncate">
                      {order.external_order_id || order.order_id}
                    </div>
                  </TableCell>
                  <TableCell>{getPlatformLabel(order.source_platform || order.marketplace)}</TableCell>
                  <TableCell>
                    <AttributionBadge attribution={attributions.get(order.order_id)} />
                  </TableCell>
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

      {/* Pagination */}
      {!loading && totalCount > 0 && (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            แสดง {(filters.page - 1) * filters.perPage + 1} ถึง{' '}
            {Math.min(filters.page * filters.perPage, totalCount)} จากทั้งหมด {totalCount}{' '}
            รายการ
          </p>

          <div className="flex items-center gap-4">
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

      {/* Dialogs */}
      <AddOrderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={fetchOrders}
      />

      <EditOrderDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={fetchOrders}
        order={selectedOrder}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title="ยืนยันการลบ Order"
        description={`คุณต้องการลบ order ${selectedOrder?.order_id} ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้`}
      />

      <SalesImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={fetchOrders}
      />

      <ShopeeOrdersImportDialog
        open={showShopeeImportDialog}
        onOpenChange={setShowShopeeImportDialog}
        onSuccess={fetchOrders}
      />

      <AffiliateImportDialog
        open={showAffiliateImportDialog}
        onOpenChange={setShowAffiliateImportDialog}
        onSuccess={fetchOrders}
      />

      {isAdmin && (
        <ResetTikTokDialog
          open={showResetDialog}
          onOpenChange={setShowResetDialog}
          onSuccess={() => {
            fetchOrders()
            fetchGMVSummary()
          }}
        />
      )}

      {isAdmin && (
        <ApplyCOGSMTDModal
          open={showCOGSMTDModal}
          onOpenChange={setShowCOGSMTDModal}
          onSuccess={() => {
            fetchOrders()
          }}
        />
      )}

      <OrderDetailDrawer
        orderId={selectedOrderId}
        open={showDetailDrawer}
        onOpenChange={setShowDetailDrawer}
      />
    </div>
  )
}
