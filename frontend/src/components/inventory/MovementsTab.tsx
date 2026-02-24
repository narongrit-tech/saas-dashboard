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
import { Package, Search, Wrench } from 'lucide-react'
import { formatBangkok } from '@/lib/bangkok-time'
import { getTodayBangkokString, getFirstDayOfMonthBangkokString } from '@/lib/bangkok-date-range'
import { getReceiptLayers, getCOGSAllocations, checkIsInventoryAdmin } from '@/app/(dashboard)/inventory/actions'
import { ApplyCOGSMTDModal } from '@/components/inventory/ApplyCOGSMTDModal'
import { COGSCoveragePanel } from '@/components/inventory/COGSCoveragePanel'
import { RunHistorySection } from '@/components/inventory/RunHistorySection'
import { RunDetailsModal } from '@/components/inventory/RunDetailsModal'
import { FixMissingSkuDialog } from '@/components/inventory/FixMissingSkuDialog'

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

  useEffect(() => {
    loadData()
    checkAdmin()
  }, [])

  async function loadData() {
    setLoading(true)
    const [layersResult, allocationsResult] = await Promise.all([
      getReceiptLayers(),
      getCOGSAllocations(),
    ])

    if (layersResult.success) {
      setLayers(layersResult.data)
    }
    if (allocationsResult.success) {
      setAllocations(allocationsResult.data)
    }
    setLoading(false)
  }

  async function checkAdmin() {
    const result = await checkIsInventoryAdmin()
    if (result.success) {
      setIsAdmin(result.isAdmin)
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {layers.map((layer) => (
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
                        {layer.unit_cost.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(layer.qty_remaining * layer.unit_cost).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{layer.ref_type}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
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
            refreshTrigger={runHistoryRefresh}
          />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
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
          onOpenChange={setShowCOGSMTDModal}
          onSuccess={handleCOGSSuccess}
          onViewRunDetails={handleViewRunDetails}
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
    </div>
  )
}
