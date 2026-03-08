'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { upsertAppSettings, seedDefaultRoles } from '@/app/(dashboard)/settings/actions'
import type { AppSettings } from '@/types/settings'
import { Lock, Save, Wand2 } from 'lucide-react'

const MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

interface Props {
  initialSettings: AppSettings | null
}

export function GeneralSettingsClient({ initialSettings }: Props) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isSeedPending, startSeedTransition] = useTransition()

  const [workspaceName, setWorkspaceName] = useState(
    initialSettings?.workspace_name ?? 'My Workspace'
  )
  const [fiscalYearStart, setFiscalYearStart] = useState(
    String(initialSettings?.fiscal_year_start ?? 1)
  )

  function handleSave() {
    startTransition(async () => {
      const result = await upsertAppSettings({
        workspace_name: workspaceName,
        fiscal_year_start: Number(fiscalYearStart),
      })
      if (result.success) {
        toast({ title: 'บันทึกสำเร็จ', description: 'ตั้งค่า Workspace อัปเดตแล้ว' })
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleSeedRoles() {
    startSeedTransition(async () => {
      const result = await seedDefaultRoles()
      if (result.success) {
        toast({
          title: 'สร้าง Default Roles สำเร็จ',
          description: 'Roles: Owner, Admin, Operator, Viewer ถูกสร้างแล้ว',
        })
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ตั้งค่าทั่วไป</h1>
        <p className="text-muted-foreground mt-1">ตั้งค่า Workspace ของทีม</p>
      </div>

      {/* Workspace Name */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ชื่อ Workspace</CardTitle>
          <CardDescription>ชื่อที่แสดงในระบบสำหรับทีมของคุณ</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">ชื่อ Workspace</Label>
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="เช่น My E-Commerce Team"
              maxLength={100}
              className="max-w-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Timezone & Currency (locked) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-500" />
            Timezone & Currency
          </CardTitle>
          <CardDescription>ค่าที่ถูกล็อกโดยระบบ</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertDescription className="text-amber-800 text-sm">
              ค่าเหล่านี้ถูกกำหนดโดยระบบและไม่สามารถเปลี่ยนแปลงได้ เพื่อความถูกต้องของข้อมูลทางการเงิน
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Timezone</Label>
              <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
                Asia/Bangkok (UTC+07:00)
              </Badge>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Currency</Label>
              <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
                THB (บาท)
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fiscal Year Start */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ปีงบประมาณ</CardTitle>
          <CardDescription>เดือนเริ่มต้นของปีงบประมาณ</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="fiscal-year">เดือนเริ่มต้น</Label>
            <Select value={fiscalYearStart} onValueChange={setFiscalYearStart}>
              <SelectTrigger className="max-w-xs" id="fiscal-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {idx + 1}. {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="h-4 w-4 mr-2" />
          {isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </Button>
      </div>

      {/* Seed Default Roles */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">เริ่มต้นค่าเริ่มต้น</CardTitle>
          <CardDescription>
            สร้าง Roles เริ่มต้น (Owner, Admin, Operator, Viewer) พร้อม Permissions สำหรับ Workspace ใหม่
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={handleSeedRoles}
            disabled={isSeedPending}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            {isSeedPending ? 'กำลังสร้าง...' : 'สร้าง Default Roles'}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            ปลอดภัยในการรันซ้ำ — จะไม่ลบ Roles ที่มีอยู่แล้ว
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
