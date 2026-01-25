'use client'

import { ReconciliationSummary } from '@/types/bank'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, TrendingDown, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react'

interface ReconciliationSummaryCardsProps {
  summary: ReconciliationSummary
}

export default function ReconciliationSummaryCards({ summary }: ReconciliationSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* Bank Net (Truth) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            Bank Net (Truth)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">
            ฿{summary.bank_summary.net.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            In: ฿{summary.bank_summary.total_in.toLocaleString('th-TH')} |
            Out: ฿{summary.bank_summary.total_out.toLocaleString('th-TH')}
          </p>
        </CardContent>
      </Card>

      {/* Internal Total */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-purple-500" />
            Internal Total
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600">
            ฿{summary.internal_summary.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Settlements + Expenses + Top-ups
          </p>
        </CardContent>
      </Card>

      {/* Matched */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Matched
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {summary.reconciliation.matched_count}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            ฿{summary.reconciliation.matched_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
          </p>
        </CardContent>
      </Card>

      {/* Unmatched */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Unmatched
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {summary.reconciliation.unmatched_bank_count + summary.reconciliation.unmatched_internal_count}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Bank: {summary.reconciliation.unmatched_bank_count} |
            Internal: {summary.reconciliation.unmatched_internal_count}
          </p>
        </CardContent>
      </Card>

      {/* Gap */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Gap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${Math.abs(summary.gap) < 0.01 ? 'text-green-600' : 'text-yellow-600'}`}>
            ฿{summary.gap.toLocaleString('th-TH', { minimumFractionDigits: 2, signDisplay: 'always' })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {Math.abs(summary.gap) < 0.01 ? 'Balanced' : 'Needs reconciliation'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
