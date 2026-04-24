'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Package, Pencil, Search, Sliders, Wrench, X } from 'lucide-react'
import { formatBangkok } from '@/lib/bangkok-time'
import { getTodayBangkokString, getFirstDayOfMonthBangkokString } from '@/lib/bangkok-date-range'
import { getReceiptLayers, getCOGSAllocations, checkIsInventoryAdmin, getAdjustments, updateStockInLayerCost } from '@/app/(dashboard)/inventory/actions'
import { ApplyCOGSMTDModal } from '@/components/inventory/ApplyCOGSMTDModal'
import { COGSCoveragePanel } from '@/components/inventory/COGSCoveragePanel'
import { RunHistorySection } from '@/components/inventory/RunHistorySection'
import { RunDetailsModal } from '@/components/inventory/RunDetailsModal'
import { FixMissingSkuDialog } from '@/components/inventory/FixMissingSkuDialog'
import { AdjustStockDialog } from '@/components/inventory/AdjustStockDialog'

interface ReceiptLayer {
  id: string
  sku_internal: string
  received_at: string
  qty_received: number
  qty_remaining: number
  unit_cost: number
  ref_type: string
}

interface COGSAllocation {
  id: string
  order_id: string
  sku_internal: string
  shipped_at: string
  method: string
  qty: number
  unit_cost_used: number
  amount: number
  is_reversal: boolean
}

export function MovementsTab() {
  const [layers, setLayers] = useState<ReceiptLayer[]>([])
  const [allocations, setAllocations] = useState<COGSAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showCOGSMTDModal, setShowCOGSMTDModal] = useState(false)
  const [showFixMissingSkuDialog, setShowFixMissingSkuDialog] = useState(false)

  // Date filter for Coverage Panel (default to MTD)
  const [startDate, setStartDate] = useState(getFirstDayOfMonthBangkokString())
  const [endDate, setEndDate] = useState(getTodayBangkokString())

  // Order ID search
  const [orderIdSearch, setOrderIdSearch] = useState('')

  // Run Details Modal
  const [showRunDetailsModal, setShowRunDetailsModal] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRunSummary, setSelectedRunSummary] = useState<any>(null)

  // Refresh trigger for run history
  const [runHistoryRefresh, setRunHistoryRefresh] = useState(0)

  // Adjust Stock dialog
  const [showAdjustStockDialog, setShowAdjustStockDialog] = useState(false)

  // Edit STOCK_IN unit cost (inline)
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [editingCost, setEditingCost] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Adjustments tab data
  const [adjustments, setAdjustments] = useState<Awaited<ReturnType<typeof getAdjustments>>['data']>([])
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false)

  // Inventory items for AdjustStockDialog SKU select
  const [inventoryItemsForAdj, setInventoryItemsForAdj] = useState<Array<{ sku_internal: string; product_name: string; is_bundle: boolean }>>([])

  // Prefill dates for "Continue failed run" flow
  const [prefillStartDate, setPrefillStartDate] = useState<string | undefined>(undefined)
  const [prefillEndDate, setPrefillEndDate] = useState<string | undefined>(undefined)

  useEffect(() => {
    loadData()
    checkAdmin()
  }, [])

  async function loadData() {
    setLoading(true)
    setAdjustmentsLoading(true)
    const [layersResult, allocationsResult, adjResult] = await Promise.all([
      getReceiptLayers(),
      getCOGSAllocations(),
      getAdjustments(),
    ])

    if (layersResult.success) {
      setLayers(layersResult.data)
    }
    if (allocationsResult.success) {
      setAllocations(allocationsResult.data)
    }
    if (adjResult.success) {
      setAdjustments(adjResult.data)
    }
    setLoading(false)
    setAdjustmentsLoading(false)
  }

  async function checkAdmin() {
    const result = await checkIsInventoryAdmin()
    if (result.success) {
      setIsAdmin(result.isAdmin)
      if (result.isAdmin) {
        // Pre-fetch inventory items for the Adjust Stock dialog SKU dropdown
        // Import lazily to avoid circular deps
        const { getInventoryItems } = await import('@/app/(dashboard)/inventory/actions')
        const itemsResult = await getInventoryItems()
        if (itemsResult.success) {
          setInventoryItemsForAdj(
            (itemsResult.data ?? []).map((i: any) => ({
              sku_internal: i.sku_internal,
              product_name: i.product_name,
              is_bundle: i.is_bundle ?? false,
            }))
          )
        }
      }
    }
  }

  function handleViewRunDetails(runId: string, summary: any) {
    setSelectedRunId(runId)
    setSelectedRunSummary(summary)
    setShowRunDetailsModal(true)
  }

  function handleCOGSSuccess() {
    loadData()
    setRunHistoryRefresh(prev => prev + 1)
  }

  function handleContinueRun(dateFrom: string, dateTo: string) {
    setPrefillStartDate(dateFrom)
    setPrefillEndDate(dateTo)
    setShowCOGSMTDModal(true)
  }

  function handleCOGSModalClose(open: boolean) {
    setShowCOGSMTDModal(open)
    if (!open) {
      // Clear prefill when modal closes
      setPrefillStartDate(undefined)
      setPrefillEndDate(undefined)
    }
  }

  function startEditCost(layer: ReceiptLayer) {
    setEditingLayerId(layer.id)
    setEditingCost(layer.unit_cost.toString())
    setEditError(null)
  }

  function cancelEditCost() {
    setEditingLayerId(null)
    setEditingCost('')
    setEditError(null)
  }

  async function saveEditCost(layerId: string) {
    const cost = parseFloat(editingCost)
    if (isNaN(cost) || cost <= 0) {
      setEditError('กรุณาใส่ต้นทุนที่ถูกต้อง (> 0)')
      return
    }
    setEditSaving(true)
    setEditError(null)
    const result = await updateStockInLayerCost(layerId, cost)
    setEditSaving(false)
    if (result.success) {
      setEditingLayerId(null)
      setEditingCost('')
      await loadData()
    } else {
      setEditError(result.error ?? 'เกิดข้อผิดพลาด')
    }
  }

  // Filter allocations by Order ID search
  const filteredAllocations = orderIdSearch.trim()
    ? allocations.filter(alloc =>
        alloc.order_id.toLowerCase().includes(orderIdSearch.toLowerCase().trim())
      )
    : allocations

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        ดูรายการ Receipt Layers (FIFO) และ COGS Allocations (Audit View)
      </p>

      <Tabs defaultValue="coverage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="coverage">Coverage Check</TabsTrigger>
          <TabsTrigger value="layers">Receipt Layers</TabsTrigger>
          <TabsTrigger value="allocations">COGS Allocations</TabsTrigger>
          <TabsTrigger value="runhistory">Run History</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        </TabsList>

        <TabsContent value="coverage" className="space-y-4">
          {/* Date Range Filter */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-md bg-muted/30">
            <div>
              <Label htmlFor="startDate">Start Date (shipped_at)</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="endDate">End Date (shipped_at)</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Coverage Panel */}
          <COGSCoveragePanel startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="layers">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
          ) : layers.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              ยังไม่มี Receipt Layers ในระบบ
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Received At</TableHead>
                    <TableHead className="text-right">Qty Received</TableHead>
                    <TableHead className="text-right">Qty Remaining</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                    <TableHead>Ref Type</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {layers.map((layer) => {
                    const isEditing = editingLayerId === layer.id
                    const canEdit =
                      layer.ref_type === 'STOCK_IN' &&
                      layer.qty_remaining === layer.qty_received
                    return (
                      <TableRow key={layer.id}>
                        <TableCell className="font-mono">{layer.sku_internal}</TableCell>
                        <TableCell>
                          {formatBangkok(new Date(layer.received_at), 'dd/MM/yyyy HH:mm')}
                        </TableCell>
                        <TableCell className="text-right">
                          {layer.qty_received.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              layer.qty_remaining === 0
                                ? 'text-muted-foreground'
                                : 'font-semibold'
                            }
                          >
                            {layer.qty_remaining.toFixed(4)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={editingCost}
                                onChange={(e) => setEditingCost(e.target.value)}
                                className="w-28 h-7 text-right text-sm"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditCost(layer.id)
                                  if (e.key === 'Escape') cancelEditCost()
                                }}
                              />
                              {editError && editingLayerId === layer.id && (
                                <p className="text-xs text-destructive">{editError}</p>
                              )}
                            </div>
                          ) : (
                            layer.unit_cost.toFixed(2)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {(layer.qty_remaining * layer.unit_cost).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{layer.ref_type}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-green-600 hover:text-green-700"
                                disabled={editSaving}
                                onClick={() => saveEditCost(layer.id)}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={editSaving}
                                onClick={cancelEditCost}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : canEdit ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 opacity-50 hover:opacity-100"
                              onClick={() => startEditCost(layer)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="allocations">
          {/* Order ID Search */}
          <div className="mb-4">
            <Label htmlFor="orderIdSearch">Search by Order ID</Label>
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
            {orderIdSearch.trim() && (
              <p className="text-xs text-muted-foreground mt-1">
                Found {filteredAllocations.length} of {allocations.length} allocations
              </p>
            )}
          </div>

          {loading ? (
            <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
          ) : allocations.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              ยังไม่มี COGS Allocations ในระบบ
            </p>
          ) : filteredAllocations.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              ไม่พบ Order ID ที่ค้นหา
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Shipped At</TableHead>
                    <TableHead className="text-center">Method</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center">Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAllocations.map((alloc) => (
                    <TableRow key={alloc.id}>
                      <TableCell className="font-mono">{alloc.order_id}</TableCell>
                      <TableCell className="font-mono">{alloc.sku_internal}</TableCell>
                      <TableCell>
                        {formatBangkok(new Date(alloc.shipped_at), 'dd/MM/yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{alloc.method}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            alloc.is_reversal ? 'text-destructive' : ''
                          }
                        >
                          {alloc.qty.toFixed(4)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {alloc.unit_cost_used.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            alloc.is_reversal ? 'text-destructive' : ''
                          }
                        >
                          {alloc.amount.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {alloc.is_reversal ? (
                          <Badge variant="destructive">Return</Badge>
                        ) : (
                          <Badge>Sale</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="runhistory">
          <RunHistorySection
            onViewDetails={handleViewRunDetails}
            onContinueRun={handleContinueRun}
            refreshTrigger={runHistoryRefresh}
          />
        </TabsContent>

        <TabsContent value="adjustments">
          {adjustmentsLoading ? (
            <p className="text-center py-8 text-muted-foreground">กำลังโหลด...</p>
          ) : adjustments.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">ยังไม่มีการปรับสต็อก</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-center">ประเภท</TableHead>
                    <TableHead className="text-right">ปริมาณ</TableHead>
                    <TableHead>เหตุผล</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.map((adj) => (
                    <TableRow key={adj.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatBangkok(new Date(adj.adjusted_at), 'dd/MM/yyyy')}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{adj.sku_internal}</TableCell>
                      <TableCell className="text-center">
                        {adj.adjustment_type === 'ADJUST_IN' ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                            + IN
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">
                            − OUT
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {Number(adj.quantity).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {adj.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => setShowAdjustStockDialog(true)}
            className="border-purple-300 text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-950"
          >
            <Sliders className="mr-2 h-4 w-4" />
            Adjust Stock
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => setShowFixMissingSkuDialog(true)}
            className="border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950"
          >
            <Wrench className="mr-2 h-4 w-4" />
            Fix Missing SKU
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
        <Button variant="outline" onClick={loadData}>
          Refresh
        </Button>
      </div>

      {isAdmin && (
        <ApplyCOGSMTDModal
          open={showCOGSMTDModal}
          onOpenChange={handleCOGSModalClose}
          isAdmin={isAdmin}
          onSuccess={handleCOGSSuccess}
          onViewRunDetails={handleViewRunDetails}
          initialStartDate={prefillStartDate}
          initialEndDate={prefillEndDate}
        />
      )}

      <RunDetailsModal
        open={showRunDetailsModal}
        onOpenChange={setShowRunDetailsModal}
        runId={selectedRunId}
        runSummary={selectedRunSummary}
        isAdmin={isAdmin}
      />

      {isAdmin && (
        <FixMissingSkuDialog
          open={showFixMissingSkuDialog}
          onOpenChange={setShowFixMissingSkuDialog}
          startDate={startDate}
          endDate={endDate}
          onSuccess={handleCOGSSuccess}
          onViewRunDetails={handleViewRunDetails}
        />
      )}

      {isAdmin && (
        <AdjustStockDialog
          open={showAdjustStockDialog}
          onOpenChange={setShowAdjustStockDialog}
          onSuccess={handleCOGSSuccess}
          inventoryItems={inventoryItemsForAdj}
        />
      )}
    </div>
  )
}
