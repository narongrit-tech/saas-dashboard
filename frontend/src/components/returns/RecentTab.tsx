'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, History, Undo2, Database } from 'lucide-react'
import { RecentReturn } from '@/types/returns'
import { getRecentReturns, backfillMissingReturnStock } from '@/app/(dashboard)/returns/actions'
import { UndoConfirmModal } from './UndoConfirmModal'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { RETURN_TYPE_LABELS } from '@/types/returns'

interface RecentTabProps {
  onRefresh?: () => void
}

export function RecentTab({ onRefresh }: RecentTabProps) {
  const [loading, setLoading] = useState(true)
  const [recentReturns, setRecentReturns] = useState<RecentReturn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedReturn, setSelectedReturn] = useState<RecentReturn | null>(null)
  const [undoModalOpen, setUndoModalOpen] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{
    processed: number; skipped: number; failed: number; warnings: string[]
  } | null>(null)
  const [backfillError, setBackfillError] = useState<string | null>(null)

  const fetchRecent = async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await getRecentReturns()

    setLoading(false)

    if (fetchError) {
      setError(fetchError)
      setRecentReturns([])
      return
    }

    setRecentReturns(data || [])
  }

  useEffect(() => {
    fetchRecent()
  }, [])

  const handleUndoClick = (returnRecord: RecentReturn) => {
    setSelectedReturn(returnRecord)
    setUndoModalOpen(true)
  }

  const handleUndoSuccess = () => {
    setUndoModalOpen(false)
    setSelectedReturn(null)
    fetchRecent()
    onRefresh?.()
  }

  const handleUndoCancel = () => {
    setUndoModalOpen(false)
    setSelectedReturn(null)
  }

  const handleBackfill = async () => {
    setBackfilling(true)
    setBackfillResult(null)
    setBackfillError(null)
    const result = await backfillMissingReturnStock()
    setBackfilling(false)
    if (!result.success) {
      setBackfillError(result.error || 'เกิดข้อผิดพลาด')
    } else if (result.data) {
      setBackfillResult(result.data)
      fetchRecent()
    }
  }

  // Check if a return can be undone
  const canUndo = (ret: RecentReturn) => {
    return ret.action_type === 'RETURN' && !ret.reversed_return_id
  }

  // Check if a return has been undone
  const isUndone = (ret: RecentReturn) => {
    return recentReturns.some((r) => r.reversed_return_id === ret.id)
  }

  return (
    <div className="space-y-4">
      {/* Recent Returns Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                คืนล่าสุด (20 รายการ)
              </CardTitle>
              <CardDescription>
                รายการรับคืนล่าสุด สามารถ Undo ได้
              </CardDescription>
            </div>
            <Button onClick={fetchRecent} disabled={loading} variant="outline" size="sm">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังโหลด...
                </>
              ) : (
                'Refresh'
              )}
            </Button>
          </div>
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
          ) : recentReturns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              ยังไม่มีรายการรับคืน
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Return Type</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentReturns.map((ret) => (
                    <TableRow key={ret.id}>
                      <TableCell>
                        <div className="text-sm">
                          {new Date(ret.returned_at).toLocaleString('th-TH', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {ret.external_order_id || '-'}
                        </div>
                        {ret.tracking_number && (
                          <div className="text-xs text-muted-foreground">
                            {ret.tracking_number}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm">{ret.sku}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={ret.action_type === 'UNDO' ? 'outline' : 'default'}
                        >
                          {ret.action_type === 'UNDO' ? '-' : ''}
                          {ret.qty}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {RETURN_TYPE_LABELS[ret.return_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={ret.action_type === 'RETURN' ? 'default' : 'destructive'}
                        >
                          {ret.action_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {ret.note || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {canUndo(ret) && !isUndone(ret) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUndoClick(ret)}
                          >
                            <Undo2 className="mr-1 h-3 w-3" />
                            Undo
                          </Button>
                        ) : isUndone(ret) ? (
                          <Badge variant="outline" className="text-xs">
                            Undone
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    {/* Admin: Backfill Missing Return Stock */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4" />
          Backfill Missing Return Stock (Admin)
        </CardTitle>
        <CardDescription className="text-xs">
          สร้าง receipt layer + COGS reversal สำหรับ RETURN_RECEIVED ที่ยังไม่มี inventory layer
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {backfillError && (
          <Alert variant="destructive">
            <AlertDescription>{backfillError}</AlertDescription>
          </Alert>
        )}
        {backfillResult && (
          <Alert>
            <AlertDescription>
              เสร็จสิ้น: ประมวลผล {backfillResult.processed} รายการ,
              ข้าม {backfillResult.skipped} รายการ (ทำแล้ว),
              ล้มเหลว {backfillResult.failed} รายการ
              {backfillResult.warnings.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  คำเตือน: {backfillResult.warnings.slice(0, 3).join(' | ')}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleBackfill}
          disabled={backfilling}
          className="border-orange-300 text-orange-600 hover:bg-orange-50"
        >
          {backfilling ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              กำลัง Backfill...
            </>
          ) : (
            <>
              <Database className="mr-2 h-4 w-4" />
              Backfill Missing Return Stock
            </>
          )}
        </Button>
      </CardContent>
    </Card>

      {/* Undo Confirmation Modal */}
      {selectedReturn && (
        <UndoConfirmModal
          open={undoModalOpen}
          returnRecord={selectedReturn}
          onConfirm={handleUndoSuccess}
          onCancel={handleUndoCancel}
        />
      )}
    </div>
  )
}
