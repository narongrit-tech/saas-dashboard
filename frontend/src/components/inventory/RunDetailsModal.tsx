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
import { Loader2, Download, Search } from 'lucide-react'
import { getCogsApplyRunDetails, exportCogsApplyRunCSV } from '@/app/(dashboard)/inventory/actions'

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
    skipped: number
    failed: number
  }
}

interface RunItem {
  id: string
  order_id: string
  sku: string | null
  qty: number | null
  status: 'successful' | 'skipped' | 'failed'
  reason: string | null
  created_at: string
}

export function RunDetailsModal({
  open,
  onOpenChange,
  runId,
  runSummary,
}: RunDetailsModalProps) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<RunItem[]>([])
  const [filteredItems, setFilteredItems] = useState<RunItem[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [orderIdSearch, setOrderIdSearch] = useState('')
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    if (open && runId) {
      loadItems()
    } else {
      // Reset state when closing
      setItems([])
      setFilteredItems([])
      setStatusFilter('all')
      setOrderIdSearch('')
    }
  }, [open, runId])

  useEffect(() => {
    // Apply filters
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
        setItems(result.data)
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
      if (result.success) {
        // Create download link
        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename
        link.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('Failed to export:', err)
    } finally {
      setExportLoading(false)
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'successful':
        return <Badge className="bg-green-600">Success</Badge>
      case 'skipped':
        return <Badge variant="secondary">Skipped</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
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
              <p className="flex items-center gap-2">
                <span>Total: {runSummary.total}</span>
                <span className="text-green-600">Success: {runSummary.successful}</span>
                <span className="text-yellow-600">Skipped: {runSummary.skipped}</span>
                <span className="text-red-600">Failed: {runSummary.failed}</span>
              </p>
            </div>
          )}
        </DialogHeader>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-4 py-4 border-t border-b">
          <div className="space-y-2">
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
                <SelectItem value="skipped">
                  Skipped ({items.filter((i) => i.status === 'skipped').length})
                </SelectItem>
                <SelectItem value="failed">
                  Failed ({items.filter((i) => i.status === 'failed').length})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
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
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono">{item.order_id}</TableCell>
                    <TableCell className="font-mono">{item.sku || '-'}</TableCell>
                    <TableCell className="text-right">
                      {item.qty !== null ? item.qty.toFixed(4) : '-'}
                    </TableCell>
                    <TableCell>{getStatusBadge(item.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.reason || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

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
