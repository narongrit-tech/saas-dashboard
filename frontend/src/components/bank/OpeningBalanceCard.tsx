'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { formatBangkok } from '@/lib/bangkok-time'

interface OpeningBalanceCardProps {
  openingBalance: number
  effectiveDate: string | null // YYYY-MM-DD or null
  onEdit: () => void
}

export default function OpeningBalanceCard({
  openingBalance,
  effectiveDate,
  onEdit,
}: OpeningBalanceCardProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="text-sm font-medium text-muted-foreground">
              ยอดยกมา (Opening Balance)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold">
                {openingBalance.toLocaleString('th-TH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-sm text-muted-foreground">THB</span>
            </div>
            {effectiveDate && (
              <div className="mt-1 text-xs text-muted-foreground">
                มีผล: {formatBangkok(new Date(effectiveDate), 'dd MMM yyyy')}
              </div>
            )}
            {!effectiveDate && openingBalance === 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                ยังไม่ได้ตั้งค่ายอดยกมา (ค่าเริ่มต้น = 0)
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={onEdit}>
            <Settings className="mr-2 h-4 w-4" />
            {effectiveDate ? 'แก้ไข' : 'ตั้งค่า'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
