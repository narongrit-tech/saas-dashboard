'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search, X, ArrowLeftCircle, Package } from 'lucide-react'
import { OrderSearchResult } from '@/types/returns'
import { searchOrdersForReturn } from './actions'
import { ReturnDrawer } from '@/components/returns/ReturnDrawer'

export default function ReturnsPage() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<OrderSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderSearchResult | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount and after actions
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Refocus after drawer closes
  useEffect(() => {
    if (!drawerOpen) {
      // Small delay to ensure drawer animation completes
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [drawerOpen])

  const handleSearch = async () => {
    if (!query.trim()) {
      setSearchResults([])
      setError(null)
      return
    }

    setSearching(true)
    setError(null)

    const { data, error } = await searchOrdersForReturn(query.trim())

    setSearching(false)

    if (error) {
      setError(error)
      setSearchResults([])
      return
    }

    if (!data || data.length === 0) {
      setError('ไม่พบ order ที่ค้นหา')
      setSearchResults([])
      return
    }

    setSearchResults(data)

    // If only 1 result, auto-open drawer
    if (data.length === 1) {
      setSelectedOrder(data[0])
      setDrawerOpen(true)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleClear = () => {
    setQuery('')
    setSearchResults([])
    setError(null)
    inputRef.current?.focus()
  }

  const handleSelectOrder = (order: OrderSearchResult) => {
    setSelectedOrder(order)
    setDrawerOpen(true)
  }

  const handleDrawerClose = () => {
    setDrawerOpen(false)
    setSelectedOrder(null)
    // Refocus handled by useEffect
  }

  const handleReturnSuccess = () => {
    // Clear search and refocus
    setQuery('')
    setSearchResults([])
    setError(null)
    setDrawerOpen(false)
    setSelectedOrder(null)
    // Refocus handled by useEffect
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Returns</h1>
        <p className="text-muted-foreground">
          ค้นหา order ด้วย Order ID หรือ Tracking Number เพื่อรับของคืน
        </p>
      </div>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftCircle className="h-5 w-5" />
            ค้นหา Order
          </CardTitle>
          <CardDescription>
            สแกนหรือพิมพ์ Order ID / Tracking Number (กด Enter เพื่อค้นหา)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                type="text"
                placeholder="Scan or type Order ID / Tracking Number..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={searching}
                className="h-14 text-lg pr-10"
                autoFocus
              />
              {query && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                  onClick={handleClear}
                  disabled={searching}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Button
              onClick={handleSearch}
              disabled={!query.trim() || searching}
              size="lg"
              className="h-14 px-8"
            >
              {searching ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  กำลังค้นหา...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-5 w-5" />
                  ค้นหา
                </>
              )}
            </Button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 p-4 bg-destructive/10 text-destructive rounded-lg">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>ผลการค้นหา ({searchResults.length} orders)</CardTitle>
            <CardDescription>เลือก order ที่ต้องการรับของคืน</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {searchResults.map((order) => (
                <Card
                  key={order.id}
                  className="cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => handleSelectOrder(order)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {order.external_order_id || order.order_id}
                          </span>
                          {order.tracking_number && (
                            <Badge variant="outline">
                              Tracking: {order.tracking_number}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {order.source_platform || order.marketplace} •{' '}
                          {order.status_group || order.platform_status} •{' '}
                          {order.line_items.length} SKU(s)
                        </div>
                        {order.shipped_at && (
                          <div className="text-xs text-muted-foreground">
                            Shipped: {new Date(order.shipped_at).toLocaleDateString('th-TH')}
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="sm">
                        เลือก
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Return Drawer */}
      {selectedOrder && (
        <ReturnDrawer
          open={drawerOpen}
          order={selectedOrder}
          onClose={handleDrawerClose}
          onSuccess={handleReturnSuccess}
        />
      )}
    </div>
  )
}
