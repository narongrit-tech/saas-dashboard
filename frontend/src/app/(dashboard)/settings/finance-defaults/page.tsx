export const dynamic = 'force-dynamic'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Lock, TrendingUp, Banknote, Wallet, Download, Clock, Globe } from 'lucide-react'

function RuleCard({
  icon: Icon,
  title,
  description,
  details,
}: {
  icon: React.ElementType
  title: string
  description: string
  details?: React.ReactNode
}) {
  return (
    <Card className="border-l-4 border-l-amber-400">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-amber-600 shrink-0" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
        {details && <div className="mt-3">{details}</div>}
      </CardContent>
    </Card>
  )
}

export default function FinanceDefaultsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance Rules</h1>
        <p className="text-muted-foreground mt-1">
          กฎการคำนวณและสมมติฐานทางการเงินที่ถูกล็อกไว้
        </p>
      </div>

      {/* Locked notice */}
      <Alert className="border-amber-200 bg-amber-50">
        <Lock className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800 text-sm">
          ค่าเหล่านี้เป็นกฎพื้นฐานของระบบที่ไม่สามารถเปลี่ยนแปลงได้ หากต้องการแก้ไขต้องติดต่อทีมพัฒนา
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {/* Net Profit Formula */}
        <RuleCard
          icon={TrendingUp}
          title="สูตร Net Profit (Economic P&L)"
          description="สูตรคำนวณ Net Profit สำหรับ Performance Dashboard"
          details={
            <div className="flex items-center gap-2 flex-wrap font-mono text-sm bg-muted/50 rounded-lg p-3">
              <Badge className="bg-green-100 text-green-800 border-green-200">GMV</Badge>
              <span className="text-muted-foreground">-</span>
              <Badge className="bg-red-100 text-red-800 border-red-200">Advertising</Badge>
              <span className="text-muted-foreground">-</span>
              <Badge className="bg-red-100 text-red-800 border-red-200">COGS</Badge>
              <span className="text-muted-foreground">-</span>
              <Badge className="bg-red-100 text-red-800 border-red-200">Operating</Badge>
              <span className="text-muted-foreground">=</span>
              <Badge className="bg-blue-100 text-blue-800 border-blue-200">Net Profit</Badge>
            </div>
          }
        />

        {/* Accrual vs Cashflow */}
        <RuleCard
          icon={Banknote}
          title="Accrual P&L ≠ Cashflow"
          description="P&L คำนวณแบบ Accrual Basis (บันทึกเมื่อเกิดรายได้/ค่าใช้จ่าย) ส่วน Cashflow คือการเคลื่อนไหวของเงินสดจริง ค่าทั้งสองจะต่างกันในแต่ละงวด การ Reconcile เป็นสิ่งจำเป็น"
        />

        {/* Top-up is not expense */}
        <RuleCard
          icon={Wallet}
          title="Top-up ≠ Expense"
          description="การเติมเงินเข้า Wallet (Top-up) ไม่ถือเป็น Expense ใน P&L เป็นเพียงการโอนเงินระหว่างบัญชี Expense จะเกิดขึ้นเมื่อมีการ Spend จาก Wallet เท่านั้น"
        />

        {/* Ad Spend from import only */}
        <RuleCard
          icon={Download}
          title="Ad Spend = Import Only"
          description="ค่าโฆษณา (Ad Spend) ต้อง Import เข้าระบบผ่าน Wallet Ledger เท่านั้น ไม่สามารถบันทึกค่าโฆษณาแบบ Manual ได้ เพื่อให้ข้อมูลตรงกับยอดจริงจาก Platform โฆษณา"
        />

        {/* Timezone */}
        <RuleCard
          icon={Clock}
          title="Timezone = Asia/Bangkok (+07:00)"
          description="วันที่และเวลาทุกรายการในระบบใช้ Asia/Bangkok (UTC+07:00) เป็น Authoritative Timezone สำหรับการจัดกลุ่มข้อมูลรายวัน/รายเดือน และการ Export ข้อมูล"
          details={
            <Badge variant="secondary" className="font-mono">
              Asia/Bangkok (UTC+07:00)
            </Badge>
          }
        />

        {/* Base Currency */}
        <RuleCard
          icon={Globe}
          title="Base Currency = THB"
          description="ระบบรองรับสกุลเงินบาทไทย (THB) เท่านั้น ตัวเลขทางการเงินทั้งหมดจะแสดงและคำนวณในหน่วยบาท"
          details={
            <Badge variant="secondary" className="font-mono">
              THB (บาทไทย)
            </Badge>
          }
        />
      </div>
    </div>
  )
}
