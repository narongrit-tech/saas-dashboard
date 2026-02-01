'use client'

import { useState, useEffect } from 'react'
import { BankStatementImportBatch } from '@/types/bank'
import { getBankImportHistory, rollbackBankImport } from '@/app/(dashboard)/bank/import-actions'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { RotateCcw, CheckCircle, XCircle, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

interface BankImportHistoryProps {
  bankAccountId: string
}

export default function BankImportHistory({ bankAccountId }: BankImportHistoryProps) {
  const [imports, setImports] = useState<BankStatementImportBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [rolling, setRolling] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadHistory()
  }, [bankAccountId])

  async function loadHistory() {
    setLoading(true)
    const result = await getBankImportHistory(bankAccountId)
    if (result.success && result.data) {
      setImports(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load import history',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  async function handleRollback(batchId: string) {
    setRolling(batchId)
    const result = await rollbackBankImport(batchId)

    if (result.success) {
      toast({
        title: 'Rollback Successful',
        description: result.message || `Deleted ${result.deleted_count} transactions`,
      })
      loadHistory() // Refresh list
    } else {
      toast({
        title: 'Rollback Failed',
        description: result.error || 'Failed to rollback import',
        variant: 'destructive',
      })
    }

    setRolling(null)
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-800 text-xs">
            <CheckCircle className="h-3 w-3" />
            Completed
          </span>
        )
      case 'rolled_back':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-800 text-xs">
            <RotateCcw className="h-3 w-3" />
            Rolled Back
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-800 text-xs">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        )
    }
  }

  function getModeBadge(mode: string) {
    const labels = {
      append: 'Append',
      replace_range: 'Replace Range',
      replace_all: 'Replace All',
    }
    return (
      <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs">
        {labels[mode as keyof typeof labels] || mode}
      </span>
    )
  }

  function formatBangkokDate(dateStr: string): string {
    try {
      const utcDate = new Date(dateStr)
      const bangkokDate = toZonedTime(utcDate, 'Asia/Bangkok')
      return format(bangkokDate, 'dd MMM yyyy HH:mm')
    } catch (error) {
      return dateStr
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading import history...</div>
  }

  if (imports.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No import history found for this bank account.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium">Date & Time</th>
              <th className="px-4 py-3 text-left text-sm font-medium">File Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Mode</th>
              <th className="px-4 py-3 text-right text-sm font-medium">Rows</th>
              <th className="px-4 py-3 text-right text-sm font-medium">Inserted</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((imp) => {
              const metadata = imp.metadata as any
              const dateRange = metadata?.date_range
              const deletedBefore = metadata?.deleted_before_import || 0

              return (
                <tr key={imp.id} className="border-t">
                  <td className="px-4 py-3 text-sm">
                    {formatBangkokDate(imp.imported_at)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="max-w-xs truncate" title={imp.file_name}>
                      {imp.file_name}
                    </div>
                    {dateRange && (
                      <div className="text-xs text-muted-foreground">
                        {dateRange.start} to {dateRange.end}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {getModeBadge(imp.import_mode)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {imp.row_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <div>{imp.inserted_count.toLocaleString()}</div>
                    {deletedBefore > 0 && (
                      <div className="text-xs text-muted-foreground">
                        (deleted {deletedBefore})
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {getStatusBadge(imp.status)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {imp.status === 'completed' && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={rolling === imp.id}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            {rolling === imp.id ? 'Rolling back...' : 'Rollback'}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Rollback</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will delete {imp.inserted_count} transactions imported from this batch.
                              <br />
                              <br />
                              <strong>File:</strong> {imp.file_name}
                              <br />
                              <strong>Imported:</strong> {formatBangkokDate(imp.imported_at)}
                              {dateRange && (
                                <>
                                  <br />
                                  <strong>Date Range:</strong> {dateRange.start} to {dateRange.end}
                                </>
                              )}
                              <br />
                              <br />
                              <span className="text-red-600">This action cannot be undone.</span>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRollback(imp.id)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Rollback
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {imp.status === 'rolled_back' && (
                      <span className="text-xs text-muted-foreground">
                        Already rolled back
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
