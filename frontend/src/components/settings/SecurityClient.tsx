'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { SettingsAuditLog } from '@/types/settings'
import { Lock, ShieldCheck, Database, ChevronDown, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'

interface Props {
  initialLogs: SettingsAuditLog[]
}

const PAGE_SIZE = 20

const ACTION_BADGE: Record<string, { label: string; className: string }> = {
  INSERT: { label: 'สร้าง',  className: 'bg-green-100 text-green-800 border-green-200' },
  UPDATE: { label: 'แก้ไข', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  DELETE: { label: 'ลบ',    className: 'bg-red-100 text-red-800 border-red-200' },
}

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_BADGE[action] ?? { label: action, className: '' }
  return <Badge className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>
}

function formatDate(dateStr: string) {
  try {
    return format(new Date(dateStr), 'd MMM yyyy HH:mm', { locale: th })
  } catch {
    return dateStr
  }
}

function JsonViewer({ data }: { data: Record<string, unknown> | null | undefined }) {
  if (!data) return <span className="text-muted-foreground text-xs">-</span>
  return (
    <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function LogRow({ log }: { log: SettingsAuditLog }) {
  const [open, setOpen] = useState(false)
  const hasDetails = log.old_values || log.new_values

  return (
    <>
      <TableRow className="group">
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(log.created_at)}
        </TableCell>
        <TableCell className="font-mono text-xs">{log.table_name}</TableCell>
        <TableCell>
          <ActionBadge action={log.action} />
        </TableCell>
        <TableCell className="text-xs">
          {log.changed_fields && log.changed_fields.length > 0
            ? log.changed_fields.join(', ')
            : '-'}
        </TableCell>
        <TableCell>
          {hasDetails && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? (
                <ChevronDown className="h-3 w-3 mr-1" />
              ) : (
                <ChevronRight className="h-3 w-3 mr-1" />
              )}
              Details
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && hasDetails && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/20 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">ก่อน (Old Values)</p>
                <JsonViewer data={log.old_values} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">หลัง (New Values)</p>
                <JsonViewer data={log.new_values} />
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export function SecurityClient({ initialLogs }: Props) {
  const [tableFilter, setTableFilter] = useState<string>('all')
  const [page, setPage] = useState(0)

  // Extract unique table names
  const tableNames = Array.from(new Set(initialLogs.map((l) => l.table_name))).sort()

  const filtered =
    tableFilter === 'all'
      ? initialLogs
      : initialLogs.filter((l) => l.table_name === tableFilter)

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security & Audit</h1>
        <p className="text-muted-foreground mt-1">ประวัติการเปลี่ยนแปลง Settings</p>
      </div>

      {/* Security Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-green-600" />
              Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>Provider: <span className="font-medium text-foreground">Google OAuth</span></p>
            <p>ผ่าน: <span className="font-medium text-foreground">Supabase Auth</span></p>
            <p>Session: <span className="font-medium text-foreground">จัดการโดย Supabase</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              Row Level Security
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>RLS: <Badge className="bg-green-100 text-green-800 border-green-200 text-xs ml-1">เปิดใช้งาน</Badge></p>
            <p>นโยบาย: <span className="font-medium text-foreground">created_by = auth.uid()</span></p>
            <p className="text-xs">ข้อมูลทุก table ถูก isolate ต่อผู้ใช้</p>
          </CardContent>
        </Card>
      </div>

      {/* Audit Logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                Audit Logs ({filtered.length})
              </CardTitle>
              <CardDescription>บันทึกการเปลี่ยนแปลง Settings ทั้งหมด (ไม่สามารถลบได้)</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">กรองตาม Table:</Label>
              <Select
                value={tableFilter}
                onValueChange={(v) => { setTableFilter(v); setPage(0) }}
              >
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  {tableNames.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {paginated.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              ยังไม่มี Audit Logs
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">วันที่/เวลา</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead className="w-24">Action</TableHead>
                    <TableHead>Fields ที่เปลี่ยน</TableHead>
                    <TableHead className="w-24">รายละเอียด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((log) => (
                    <LogRow key={log.id} log={log} />
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    แสดง {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} จาก {filtered.length} รายการ
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ก่อนหน้า
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      ถัดไป
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
