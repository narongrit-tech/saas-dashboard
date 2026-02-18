'use client'

import { useState, useEffect } from 'react'
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
import { Loader2, Eye } from 'lucide-react'
import { getCogsApplyRuns } from '@/app/(dashboard)/inventory/actions'
import { formatBangkok } from '@/lib/bangkok-time'

interface Run {
  id: string
  start_date: string
  end_date: string
  method: string
  total: number
  eligible: number
  successful: number
  skipped: number
  failed: number
  created_at: string
}

interface RunHistorySectionProps {
  onViewDetails: (runId: string, summary: any) => void
  refreshTrigger?: number
}

export function RunHistorySection({ onViewDetails, refreshTrigger }: RunHistorySectionProps) {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRuns()
  }, [refreshTrigger])

  async function loadRuns() {
    setLoading(true)
    try {
      const result = await getCogsApplyRuns(20)
      if (result.success) {
        setRuns(result.data)
      }
    } catch (err) {
      console.error('Failed to load runs:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        ยังไม่มีประวัติการรัน Apply COGS
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          แสดง {runs.length} รายการล่าสุด
        </p>
        <Button variant="outline" size="sm" onClick={loadRuns}>
          Refresh
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run Date</TableHead>
              <TableHead>Date Range</TableHead>
              <TableHead className="text-center">Method</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Skipped</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="text-sm">
                  {formatBangkok(new Date(run.created_at), 'dd/MM/yyyy HH:mm')}
                </TableCell>
                <TableCell className="text-sm">
                  {run.start_date} to {run.end_date}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline">{run.method}</Badge>
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {run.total}
                </TableCell>
                <TableCell className="text-right text-green-600">
                  {run.successful}
                </TableCell>
                <TableCell className="text-right text-yellow-600">
                  {run.skipped}
                </TableCell>
                <TableCell className="text-right text-red-600">
                  {run.failed}
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewDetails(run.id, {
                      start_date: run.start_date,
                      end_date: run.end_date,
                      method: run.method,
                      total: run.total,
                      successful: run.successful,
                      skipped: run.skipped,
                      failed: run.failed,
                    })}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
