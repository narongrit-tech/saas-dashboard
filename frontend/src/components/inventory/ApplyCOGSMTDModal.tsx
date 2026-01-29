'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { applyCOGSMTD } from '@/app/(dashboard)/inventory/actions'

interface ApplyCOGSMTDModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ApplyCOGSMTDModal({
  open,
  onOpenChange,
  onSuccess,
}: ApplyCOGSMTDModalProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Get MTD date range for display
  const now = new Date()
  const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const startOfMonth = new Date(bangkokTime.getFullYear(), bangkokTime.getMonth(), 1)
  const startDate = startOfMonth.toISOString().split('T')[0]
  const endDate = bangkokTime.toISOString().split('T')[0]

  async function handleApply() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await applyCOGSMTD('FIFO')

      if (!response.success) {
        setError(response.error || 'เกิดข้อผิดพลาด')
      } else {
        setResult(response.data)
        if (onSuccess) {
          onSuccess()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    if (!loading) {
      setResult(null)
      setError(null)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply COGS (Month-to-Date)</DialogTitle>
          <DialogDescription>
            ตัด COGS สำหรับ orders ที่ shipped ในเดือนนี้ ({startDate} ถึง {endDate})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info */}
          {!result && !error && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>คำอธิบาย</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>ระบบจะตัด COGS สำหรับ orders ที่ shipped ในเดือนนี้เท่านั้น</li>
                  <li>Skip orders ที่ cancelled (ยกเลิกแล้ว)</li>
                  <li>Skip orders ที่ไม่มี seller_sku หรือ quantity ≤ 0</li>
                  <li>
                    Skip orders ที่มี COGS allocations อยู่แล้ว (ไม่สร้างซ้ำ)
                  </li>
                  <li>
                    <strong>ปลอดภัย:</strong> กดซ้ำได้ ไม่ duplicate allocations
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Result Summary */}
          {result && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>เสร็จสิ้น</AlertTitle>
                <AlertDescription>
                  {result.message || 'ประมวลผลเสร็จสิ้น'}
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold">{result.total}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Eligible</p>
                  <p className="text-2xl font-bold text-blue-600">{result.eligible}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Successful</p>
                  <p className="text-2xl font-bold text-green-600">
                    {result.successful}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Skipped</p>
                  <p className="text-xl font-semibold text-yellow-600">
                    {result.skipped}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-xl font-semibold text-red-600">{result.failed}</p>
                </div>
              </div>

              {/* Error List */}
              {result.errors && result.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Errors/Skipped Details ({result.errors.length}):
                  </p>
                  <div className="max-h-[200px] overflow-y-auto border rounded-md p-2 space-y-1">
                    {result.errors.map((err: any, idx: number) => (
                      <div
                        key={idx}
                        className="text-xs flex items-center justify-between gap-2 py-1"
                      >
                        <span className="font-mono">{err.order_id}</span>
                        <Badge
                          variant={
                            err.reason === 'already_allocated' ? 'secondary' : 'outline'
                          }
                        >
                          {err.reason}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {!result && (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                ยกเลิก
              </Button>
              <Button onClick={handleApply} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? 'กำลังประมวลผล...' : 'Apply COGS (MTD)'}
              </Button>
            </>
          )}
          {result && (
            <Button onClick={handleClose} className="w-full">
              ปิด
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
