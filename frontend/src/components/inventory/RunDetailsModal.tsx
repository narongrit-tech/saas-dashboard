'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Download, Search, AlertTriangle, Trash2 } from 'lucide-react'
import {
  getCogsApplyRunDetails,
  exportCogsApplyRunCSV,
  clearPartialCOGSAllocations,
} from '@/app/(dashboard)/inventory/actions'

interface RunDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string | null
  runSummary?: {
    start_date: string
    end_date: string
    method: string
    total: number
    successful: number
    partial?: number
    skipped: number
    failed: number
  }
  isAdmin?: boolean
}

interface RunItem {
  id: string
  order_id: string
  sku: string | null
  qty: number | null
  status: 'successful' | 'skipped' | 'failed' | 'partial'
  reason: string | null
  missing_skus: string[]
  allocated_skus: string[]
  created_at: string
}

export function RunDetailsModal({
  open,
  onOpenChange,
  runId,
  runSummary,
  isAdmin = false,
}: RunDetailsModalProps) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<RunItem[]>([])
  const [filteredItems, setFilteredItems] = useState<RunItem[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [orderIdSearch, setOrderIdSearch] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [clearingOrderId, setClearingOrderId] = useState<string | null>(null)
  const [clearResult, setClearResult] = useState<{ order_id: string; message: string } | null>(null)

  useEffect(() => {
    if (open && runId) {
      loadItems()
    } else {
      setItems([])
      setFilteredItems([])
      setStatusFilter('all')
      setOrderIdSearch('')
      setClearResult(null)
    }
  }, [open, runId])

  useEffect(() => {
    let filtered = items

    if (statusFilter !== 'all') {
      filtered = filtered.filter((item) => item.status === statusFilter)
    }

    if (orderIdSearch.trim()) {
      const searchLower = orderIdSearch.toLowerCase().trim()
      filtered = filtered.filter((item) =>
        item.order_id.toLowerCase().includes(searchLower)
      )
    }

    setFilteredItems(filtered)
  }, [items, statusFilter, orderIdSearch])

  async function loadItems() {
    if (!runId) return

    setLoading(true)
    try {
      const result = await getCogsApplyRunDetails(runId, {})
      if (result.success) {
        setItems(result.data as RunItem[])
      }
    } catch (err) {
      console.error('Failed to load run items:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    if (!runId) return

    setExportLoading(true)
    try {
      const filters: any = {}
      if (statusFilter !== 'all') {
        filters.status = statusFilter
      }
      if (orderIdSearch.trim()) {
        filters.orderIdSearch = orderIdSearch.trim()
      }

      const result = await exportCogsApplyRunCSV(runId, filters)
      if (result.success && result.csv) {
        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename || 'cogs-run.csv'
        link.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('Failed to export:', err)
    } finally {
      setExportLoading(false)
    }
  }

  async function handleClearPartial(order_id: string) {
    if (!isAdmin) return
    if (!confirm(`ล้าง partial allocations สำหรับ order ${order_id}?\n\nการกระทำนี้จะสร้าง reversal records และ restore stock layers กลับ\norder นี้สามารถรัน Apply COGS ใหม่ได้หลังจากนี้`)) return

    setClearingOrderId(order_id)
    setClearResult(null)
    try {
      const result = await clearPartialCOGSAllocations(order_id)
      if (result.success) {
        setClearResult({ order_id, message: `ล้างแล้ว ${result.cleared} allocations` })
        // Reload to reflect new state
        await loadItems()
      } else {
        setClearResult({ order_id, message: `Error: ${result.error}` })
      }
    } catch (err) {
      console.error('Failed to clear partial:', err)
    } finally {
      setClearingOrderId(null)
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'successful':
        return <Badge className="bg-green-600 text-white">Success</Badge>
      case 'skipped':
        return <Badge variant="secondary">Skipped</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'partial':
        return <Badge className="bg-orange-500 text-white">Partial</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const partialCount = items.filter((i) => i.status === 'partial').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const failedOrPartialCount = partialCount + failedCount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Run Details</DialogTitle>
          {runSummary && (
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Date Range: <strong>{runSummary.start_date}</strong> to{' '}
                <strong>{runSummary.end_date}</strong>
              </p>
              <p>
                Method: <Badge variant="outline">{runSummary.method}</Badge>
              </p>
              <p className="flex items-center gap-3 flex-wrap">
                <span>Total: {runSummary.total}</span>
                <span className="text-green-600">Success: {runSummary.successful}</span>
                {(runSummary.partial ?? 0) > 0 && (
                  <span className="text-orange-500 font-medium">Partial: {runSummary.partial}</span>
                )}
                <span className="text-yellow-600">Skipped: {runSummary.skipped}</span>
                <span className="text-red-600">Failed: {runSummary.failed}</span>
              </p>
            </div>
          )}
        </DialogHeader>

        {/* Quick filter: Failed/Partial */}
        {failedOrPartialCount > 0 && (
          <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
            <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
            <span className="text-sm text-orange-700 dark:text-orange-300">
              มี {failedOrPartialCount} orders ที่ยังไม่ครบ ({partialCount} partial, {failedCount} failed)
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto border-orange-300 text-orange-600 hover:bg-orange-100"
              onClick={() => setStatusFilter(partialCount > 0 ? 'partial' : 'failed')}
            >
              ดู Failed/Partial
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-2 gap-4 py-2 border-t border-b">
          <div className="space-y-1">
            <Label htmlFor="statusFilter">Status Filter</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="statusFilter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ({items.length})</SelectItem>
                <SelectItem value="successful">
                  Successful ({items.filter((i) => i.status === 'successful').length})
                </SelectItem>
                <SelectItem value="partial">
                  <span className="text-orange-500">Partial ({partialCount})</span>
                </SelectItem>
                <SelectItem value="failed">
                  Failed ({failedCount})
                </SelectItem>
                <SelectItem value="skipped">
                  Skipped ({items.filter((i) => i.status === 'skipped').length})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="orderIdSearch">Order ID Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="orderIdSearch"
                placeholder="ค้นหา Order ID..."
                value={orderIdSearch}
                onChange={(e) => setOrderIdSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </div>

        {/* Clear result message */}
        {clearResult && (
          <div className="text-sm p-2 rounded bg-muted text-muted-foreground">
            {clearResult.order_id}: {clearResult.message}
          </div>
        )}

        {/* Results count */}
        <div className="text-sm text-muted-foreground">
          Showing {filteredItems.length} of {items.length} items
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {items.length === 0 ? 'No items in this run' : 'No items match your filters'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Missing SKUs</TableHead>
                  <TableHead>Reason</TableHead>
                  {isAdmin && <TableHead className="text-center">Admin</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow
                    key={item.id}
                    className={
                      item.status === 'partial'
                        ? 'bg-orange-50/50 dark:bg-orange-950/20'
                        : item.status === 'failed'
                        ? 'bg-red-50/50 dark:bg-red-950/20'
                        : undefined
                    }
                  >
                    <TableCell className="font-mono text-sm">{item.order_id}</TableCell>
                    <TableCell className="font-mono text-sm">{item.sku || '-'}</TableCell>
                    <TableCell className="text-right">
                      {item.qty !== null ? item.qty.toFixed(4) : '-'}
                    </TableCell>
                    <TableCell>{getStatusBadge(item.status)}</TableCell>
                    <TableCell>
                      {item.missing_skus && item.missing_skus.length > 0 ? (
                        <div className="space-y-1">
                          {item.missing_skus.map((sku) => (
                            <div key={sku} className="flex items-center gap-1">
                              <span className="font-mono text-xs text-red-600 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
                                {sku}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                      {item.reason || '-'}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-center">
                        {(item.status === 'partial' || item.status === 'failed') &&
                          item.allocated_skus && item.allocated_skus.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              disabled={clearingOrderId === item.order_id}
                              onClick={() => handleClearPartial(item.order_id)}
                              title="Clear partial allocations (admin)"
                            >
                              {clearingOrderId === item.order_id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Fix suggestions for partial/failed items */}
        {filteredItems.some((i) => i.missing_skus && i.missing_skus.length > 0) && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-sm space-y-1">
            <p className="font-medium text-blue-700 dark:text-blue-300">Fix Suggestions:</p>
            <ul className="list-disc list-inside text-blue-600 dark:text-blue-400 space-y-0.5">
              {Array.from(
                new Set(
                  filteredItems.flatMap((i) => i.missing_skus || [])
                )
              ).map((sku) => (
                <li key={sku}>
                  เติม Stock Layer สำหรับ SKU{' '}
                  <span className="font-mono font-semibold">{sku}</span>{' '}
                  <span className="text-muted-foreground">(ไปที่ Inventory → Stock In)</span>
                </li>
              ))}
              <li className="text-muted-foreground">
                หลังเติม Stock แล้ว รัน Apply COGS ใหม่ด้วย date range เดิม — orders ที่ partial จะถูก retry อัตโนมัติ
              </li>
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportLoading || items.length === 0}
          >
            {exportLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
