'use client'

import { useState, useEffect } from 'react'
import { BankBalanceSummary } from '@/types/bank'
import { getBankBalanceSummary } from '@/app/(dashboard)/bank/actions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Edit } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import SaveReportedBalanceDialog from './SaveReportedBalanceDialog'
import { toBangkokDateString } from '@/lib/bangkok-date-range'

interface BankBalanceSummaryCardProps {
  bankAccountId: string
  startDate: Date
  endDate: Date
  onUpdate?: () => void
}

export default function BankBalanceSummaryCard({
  bankAccountId,
  startDate,
  endDate,
  onUpdate,
}: BankBalanceSummaryCardProps) {
  const [summary, setSummary] = useState<BankBalanceSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [showReportedDialog, setShowReportedDialog] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    loadSummary()
  }, [bankAccountId, startDate, endDate])

  async function loadSummary() {
    if (!bankAccountId) return

    setLoading(true)
    const startStr = toBangkokDateString(startDate)
    const endStr = toBangkokDateString(endDate)

    const result = await getBankBalanceSummary(bankAccountId, startStr, endStr)

    if (result.success && result.data) {
      setSummary(result.data)
    } else {
      toast({
        title: 'ข้อผิดพลาด',
        description: result.error || 'ไม่สามารถโหลดข้อมูลสรุปยอดได้',
        variant: 'destructive',
      })
    }
    setLoading(false)
  }

  const hasMismatch = summary && summary.delta !== null && Math.abs(summary.delta) >= 0.01

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>สรุปยอดเงิน (Balance Summary)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground">Loading...</div>
          ) : summary ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Opening Balance */}
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground mb-1">ยอดยกมา (Opening)</div>
                <div className="text-2xl font-bold">
                  ฿{summary.opening_balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </div>
              </div>

              {/* Net Movement */}
              <div className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground mb-1">
                  Net Movement <span className="text-xs">(ในช่วงที่เลือก)</span>
                </div>
                <div
                  className={`text-2xl font-bold ${
                    summary.net_movement >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {summary.net_movement >= 0 ? '+' : ''}
                  ฿{summary.net_movement.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </div>
              </div>

              {/* Expected Closing Balance */}
              <div className="border rounded-lg p-4 bg-blue-50">
                <div className="text-sm text-muted-foreground mb-1">
                  Expected Closing <span className="text-xs">(Calculated)</span>
                </div>
                <div className="text-2xl font-bold text-blue-700">
                  ฿
                  {summary.expected_closing_balance.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>

              {/* Reported Balance (with Edit button) */}
              <div
                className={`border rounded-lg p-4 ${
                  summary.reported_balance !== null
                    ? hasMismatch
                      ? 'bg-red-50'
                      : 'bg-green-50'
                    : 'bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm text-muted-foreground">
                    Reported Balance
                    {summary.reported_as_of_date && (
                      <span className="text-xs block">
                        ({new Date(summary.reported_as_of_date).toLocaleDateString('th-TH')})
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowReportedDialog(true)}
                    title="บันทึกยอดจากธนาคาร"
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                </div>
                <div
                  className={`text-2xl font-bold ${
                    summary.reported_balance !== null
                      ? hasMismatch
                        ? 'text-red-700'
                        : 'text-green-700'
                      : 'text-gray-500'
                  }`}
                >
                  {summary.reported_balance !== null ? (
                    <>
                      ฿
                      {summary.reported_balance.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                      })}
                    </>
                  ) : (
                    <span className="text-base">ไม่มีข้อมูล</span>
                  )}
                </div>
                {summary.delta !== null && (
                  <div
                    className={`text-sm mt-1 ${
                      Math.abs(summary.delta) < 0.01 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    Delta: {summary.delta >= 0 ? '+' : ''}
                    {summary.delta.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    {Math.abs(summary.delta) >= 0.01 && ' ⚠️'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">No data available</div>
          )}

          {hasMismatch && (
            <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded-lg">
              <p className="text-sm text-red-800">
                ⚠️ <strong>ยอดไม่ตรง (Mismatch detected):</strong> ยอดจากธนาคารไม่ตรงกับยอดที่คำนวณ
                กรุณาตรวจสอบรายการธุรกรรม
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Reported Balance Dialog */}
      <SaveReportedBalanceDialog
        open={showReportedDialog}
        onOpenChange={setShowReportedDialog}
        bankAccountId={bankAccountId}
        defaultDate={endDate}
        onSuccess={() => {
          loadSummary()
          onUpdate?.()
        }}
      />
    </>
  )
}
