'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, PackageSearch, Calendar } from 'lucide-react'
import { QueueItem, OrderSearchResult } from '@/types/returns'
import { getReturnsQueue, searchOrdersForReturn } from '@/app/(dashboard)/returns/actions'

interface QueueTabProps {
  onSelectOrder: (order: OrderSearchResult) => void
}

export function QueueTab({ onSelectOrder }: QueueTabProps) {
  const [loading, setLoading] = useState(true)
  const [queueItems, setQueueItems] = useState<QueueItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  const fetchQueue = async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await getReturnsQueue({
      dateFrom,
      dateTo,
    })

    setLoading(false)

    if (fetchError) {
      setError(fetchError)
      setQueueItems([])
      return
    }

    setQueueItems(data || [])
  }

  useEffect(() => {
    fetchQueue()
  }, [dateFrom, dateTo])

  const handleOpenDrawer = async (item: QueueItem) => {
    // Use search action to get full order details with line items
    const searchQuery = item.external_order_id || item.tracking_number || item.order_id
    const { data, error } = await searchOrdersForReturn(searchQuery)

    if (error || !data || data.length === 0) {
      console.error('[QueueTab] Failed to fetch order details:', error)
      return
    }

    // Find matching order
    const order = data.find(
      (o) =>
        o.external_order_id === item.external_order_id ||
        o.tracking_number === item.tracking_number ||
        o.order_id === item.order_id
    )

    if (order) {
      onSelectOrder(order)
    }
  }

  // Filter queue items by search query
  const filteredItems = queueItems.filter((item) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      item.external_order_id?.toLowerCase().includes(query) ||
      item.tracking_number?.toLowerCase().includes(query) ||
      item.order_id.toLowerCase().includes(query)
    )
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5" />
            Queue Filters
          </CardTitle>
          <CardDescription>
            กรองรายการที่ต้องการตรวจสอบ
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Date Range */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                From Date
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                To Date
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            {/* Search in queue */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <Input
                type="text"
                placeholder="Order ID / Tracking..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={fetchQueue} disabled={loading} variant="outline">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังโหลด...
                </>
              ) : (
                'Refresh Queue'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Queue Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            รายการรอเช็ค ({filteredItems.length})
          </CardTitle>
          <CardDescription>
            Orders ที่อาจต้องรับของคืน (ตามสถานะและวันที่จัดส่ง)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
              {error}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              ไม่มีรายการในคิว (ลองปรับ filter หรือ refresh)
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Tracking</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Shipped</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Returned</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">
                          {item.external_order_id || item.order_id}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(item.order_date).toLocaleDateString('th-TH')}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.tracking_number ? (
                          <Badge variant="outline" className="text-xs">
                            {item.tracking_number}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {item.source_platform || item.marketplace || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {item.status_group || item.platform_status || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.shipped_at ? (
                          <span className="text-sm">
                            {new Date(item.shipped_at).toLocaleDateString('th-TH')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {item.sold_qty}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.returned_qty > 0 ? (
                          <Badge variant="secondary">{item.returned_qty}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="default">{item.remaining_qty}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => handleOpenDrawer(item)}
                        >
                          รับคืน
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
