'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { upsertUserPreferences } from '@/app/(dashboard)/settings/actions'
import type { UserPreferences } from '@/types/settings'
import { Sun, Moon, Monitor, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  initialPreferences: UserPreferences | null
}

type Theme = 'light' | 'dark' | 'system'

const THEMES: { value: Theme; label: string; icon: React.ElementType; disabled: boolean }[] = [
  { value: 'light',  label: 'Light',  icon: Sun,     disabled: false },
  { value: 'dark',   label: 'Dark',   icon: Moon,    disabled: true },
  { value: 'system', label: 'System', icon: Monitor, disabled: true },
]

export function AppearanceSettingsClient({ initialPreferences }: Props) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const [theme, setTheme] = useState<Theme>(initialPreferences?.theme ?? 'light')
  const [notifCogs, setNotifCogs] = useState(initialPreferences?.notification_cogs_runs ?? true)
  const [notifImport, setNotifImport] = useState(
    initialPreferences?.notification_import_complete ?? true
  )
  const [notifBalance, setNotifBalance] = useState(
    initialPreferences?.notification_low_balance ?? false
  )

  function handleSave() {
    startTransition(async () => {
      const result = await upsertUserPreferences({
        theme,
        notification_cogs_runs: notifCogs,
        notification_import_complete: notifImport,
        notification_low_balance: notifBalance,
      })
      if (result.success) {
        toast({ title: 'บันทึกสำเร็จ', description: 'การตั้งค่าการแสดงผลอัปเดตแล้ว' })
      } else {
        toast({ title: 'เกิดข้อผิดพลาด', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รูปแบบการแสดงผล</h1>
        <p className="text-muted-foreground mt-1">ตั้งค่าธีมและการแสดงผลสำหรับคุณ</p>
      </div>

      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ธีม</CardTitle>
          <CardDescription>เลือกรูปแบบการแสดงผลของแอปพลิเคชัน</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            {THEMES.map(({ value, label, icon: Icon, disabled }) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-4 w-28 transition-all',
                  disabled && 'opacity-40 cursor-not-allowed',
                  !disabled && 'cursor-pointer hover:border-primary/50',
                  theme === value && !disabled
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm font-medium">{label}</span>
                {disabled && (
                  <span className="text-[10px] text-muted-foreground">ยังไม่รองรับ</span>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            ธีม Dark และ System ยังไม่รองรับในเวอร์ชันนี้
          </p>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">การแจ้งเตือน</CardTitle>
          <CardDescription>เลือกประเภทการแจ้งเตือนที่คุณต้องการรับ</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="notif-cogs"
              checked={notifCogs}
              onCheckedChange={(v) => setNotifCogs(Boolean(v))}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="notif-cogs" className="font-medium cursor-pointer">
                COGS Allocation เสร็จสิ้น
              </Label>
              <p className="text-xs text-muted-foreground">
                แจ้งเตือนเมื่อการคำนวณ COGS เสร็จสิ้น
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="notif-import"
              checked={notifImport}
              onCheckedChange={(v) => setNotifImport(Boolean(v))}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="notif-import" className="font-medium cursor-pointer">
                Import ข้อมูลเสร็จสิ้น
              </Label>
              <p className="text-xs text-muted-foreground">
                แจ้งเตือนเมื่อ Import ไฟล์ข้อมูลเสร็จสิ้น
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="notif-balance"
              checked={notifBalance}
              onCheckedChange={(v) => setNotifBalance(Boolean(v))}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="notif-balance" className="font-medium cursor-pointer">
                ยอดเงินใน Wallet ต่ำ
              </Label>
              <p className="text-xs text-muted-foreground">
                แจ้งเตือนเมื่อยอดเงินใน Wallet ต่ำกว่าระดับที่กำหนด
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={handleSave} disabled={isPending}>
        <Save className="h-4 w-4 mr-2" />
        {isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
      </Button>
    </div>
  )
}
