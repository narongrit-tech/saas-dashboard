'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { DateRangePicker, DateRangeResult } from '@/components/shared/DateRangePicker'
import { getBangkokNow, startOfDayBangkok } from '@/lib/bangkok-time'
import {
  getCashInTransactions,
  getCashInSelectionSummary,
  applyCashInType,
  clearCashInType,
} from '@/app/(dashboard)/bank/cash-in-actions'
import { BankTransaction, BankAccount, CASH_IN_TYPES, CASH_IN_TYPE_LABELS, CashInType } from '@/types/bank'
import { useToast } from '@/hooks/use-toast'
import { Search, AlertCircle, Info, CheckCircle2, Tag, Download, Upload } from 'lucide-react'
import CashInTypeDialog from './CashInTypeDialog'
import ImportCashInDialog from './ImportCashInDialog'
import { downloadCashInTemplate } from '@/app/(dashboard)/bank/cash-in-actions'

interface CashInClassificationProps {
  bankAccountId: string | null
  accounts: BankAccount[]
}

interface SelectionState {
  mode: 'ids' | 'filtered'
  ids: Set<string>
  allOnPageSelected: boolean
  allFilteredSelected: boolean
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function CashInClassification({ bankAccountId, accounts }: CashInClassificationProps) {
  const { toast } = useToast()

  // Default: Last 30 days
  const getDefaultRange = (): DateRangeResult => {
    const now = getBangkokNow()
    const start = new Date(now)
    start.setDate(start.getDate() - 29)
    return {
      startDate: startOfDayBangkok(start),
      endDate: getBangkokNow(),
    }
  }

  // Filters
  const [dateRange, setDateRange] = useState<DateRangeResult>(getDefaultRange())
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>(bankAccountId || '')
  const [search, setSearch] = useState('')
  const [showClassified, setShowClassified] = useState(false)

  // Data
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Selection
  const [selection, setSelection] = useState<SelectionState>({
    mode: 'ids',
    ids: new Set(),
    allOnPageSelected: false,
    allFilteredSelected: false,
  })

  // Dialog
  const [showTypeDialog, setShowTypeDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)

  useEffect(() => {
    fetchTransactions()
  }, [dateRange, selectedBankAccount, search, showClassified, page])

  useEffect(() => {
    // Reset selection when filters change
    setSelection({
      mode: 'ids',
      ids: new Set(),
      allOnPageSelected: false,
      allFilteredSelected: false,
    })
  }, [dateRange, selectedBankAccount, search, showClassified])

  useEffect(() => {
    if (bankAccountId) {
      setSelectedBankAccount(bankAccountId)
    }
  }, [bankAccountId])

  async function fetchTransactions() {
    try {
      setLoading(true)

      const filters = {
        bankAccountId: selectedBankAccount || null,
        startDate: dateRange.startDate.toISOString().split('T')[0],
        endDate: dateRange.endDate.toISOString().split('T')[0],
        search: search || null,
        showClassified,
      }

      const result = await getCashInTransactions(filters, page, pageSize)

      if (!result.success || !result.data) {
        toast({
          title: 'ข้อผิดพลาด',
          description: result.error || 'ไม่สามารถโหลดข้อมูลได้',
          variant: 'destructive',
        })
        return
      }

      setTransactions(result.data.transactions)
      setTotal(result.data.total)
    } catch (error) {
      console.error('Error fetching transactions:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Selection handlers
  function handleSelectRow(txnId: string, checked: boolean) {
    const newIds = new Set(selection.ids)
    if (checked) {
      newIds.add(txnId)
    } else {
      newIds.delete(txnId)
    }

    setSelection({
      ...selection,
      ids: newIds,
      allOnPageSelected: false,
      allFilteredSelected: false,
    })
  }

  function handleSelectAllOnPage(checked: boolean) {
    if (checked) {
      const pageIds = new Set(transactions.map((txn) => txn.id))
      setSelection({
        mode: 'ids',
        ids: pageIds,
        allOnPageSelected: true,
        allFilteredSelected: false,
      })
    } else {
      setSelection({
        mode: 'ids',
        ids: new Set(),
        allOnPageSelected: false,
        allFilteredSelected: false,
      })
    }
  }

  function handleSelectAllFiltered() {
    setSelection({
      mode: 'filtered',
      ids: new Set(),
      allOnPageSelected: false,
      allFilteredSelected: true,
    })
  }

  function clearSelection() {
    setSelection({
      mode: 'ids',
      ids: new Set(),
      allOnPageSelected: false,
      allFilteredSelected: false,
    })
  }

  // Calculate selection summary
  const selectedCount = useMemo(() => {
    if (selection.allFilteredSelected) return total
    return selection.ids.size
  }, [selection, total])

  const selectedAmount = useMemo(() => {
    if (selection.allFilteredSelected) {
      // Return sum of all filtered transactions
      return transactions.reduce((sum, txn) => sum + txn.deposit, 0)
    }
    return transactions
      .filter((txn) => selection.ids.has(txn.id))
      .reduce((sum, txn) => sum + txn.deposit, 0)
  }, [selection, transactions])

  // Handle apply type
  async function handleApplyType(
    cashInType: CashInType,
    refType?: string,
    refId?: string,
    note?: string
  ) {
    try {
      const filters = {
        bankAccountId: selectedBankAccount || null,
        startDate: dateRange.startDate.toISOString().split('T')[0],
        endDate: dateRange.endDate.toISOString().split('T')[0],
        search: search || null,
        showClassified,
      }

      const selectionMode = {
        mode: selection.mode,
        ids: selection.mode === 'ids' ? Array.from(selection.ids) : undefined,
      }

      const result = await applyCashInType(filters, selectionMode, {
        cash_in_type: cashInType,
        cash_in_ref_type: refType || null,
        cash_in_ref_id: refId || null,
        note: note || null,
      })

      if (!result.success) {
        toast({
          title: 'ข้อผิดพลาด',
          description: result.error || 'ไม่สามารถจัดประเภทได้',
          variant: 'destructive',
        })
        return
      }

      toast({
        title: 'สำเร็จ',
        description: result.message || `จัดประเภท ${result.affected_rows} รายการสำเร็จ`,
      })

      // Refresh
      clearSelection()
      fetchTransactions()
    } catch (error) {
      console.error('Error applying type:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
        variant: 'destructive',
      })
    }
  }

  // Handle clear classification
  async function handleClearClassification() {
    if (!confirm(`ยืนยันการล้างการจัดประเภท ${selectedCount} รายการ?`)) {
      return
    }

    try {
      const filters = {
        bankAccountId: selectedBankAccount || null,
        startDate: dateRange.startDate.toISOString().split('T')[0],
        endDate: dateRange.endDate.toISOString().split('T')[0],
        search: search || null,
        showClassified: true, // Only clear classified ones
      }

      const selectionMode = {
        mode: selection.mode,
        ids: selection.mode === 'ids' ? Array.from(selection.ids) : undefined,
      }

      const result = await clearCashInType(filters, selectionMode)

      if (!result.success) {
        toast({
          title: 'ข้อผิดพลาด',
          description: result.error || 'ไม่สามารถล้างการจัดประเภทได้',
          variant: 'destructive',
        })
        return
      }

      toast({
        title: 'สำเร็จ',
        description: result.message || `ล้างการจัดประเภท ${result.affected_rows} รายการสำเร็จ`,
      })

      // Refresh
      clearSelection()
      fetchTransactions()
    } catch (error) {
      console.error('Error clearing classification:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
        variant: 'destructive',
      })
    }
  }

  const hasSelection = selectedCount > 0

  // Handle template download
  async function handleDownloadTemplate() {
    try {
      const result = await downloadCashInTemplate()

      if (!result.success || !result.base64 || !result.filename) {
        toast({
          title: 'ข้อผิดพลาด',
          description: result.error || 'ไม่สามารถดาวน์โหลด template ได้',
          variant: 'destructive',
        })
        return
      }

      // Create download link
      const link = document.createElement('a')
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({
        title: 'สำเร็จ',
        description: 'ดาวน์โหลด template สำเร็จ',
      })
    } catch (error) {
      console.error('Download template error:', error)
      toast({
        title: 'ข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการดาวน์โหลด template',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Info Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Cash In Classification:</strong> จัดประเภทเงินเข้าบัญชีธนาคารเพื่อให้ Company Cashflow
          และ Reconciliation สามารถแยกแยะประเภทเงินได้ชัดเจน
          <br />
          <strong>หมายเหตุ:</strong> ระบบแสดงเฉพาะรายการเงินเข้า (Deposit &gt; 0) เท่านั้น
        </AlertDescription>
      </Alert>

      {/* Import Actions */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleDownloadTemplate}>
          <Download className="mr-2 h-4 w-4" />
          Download Template
        </Button>
        <Button variant="outline" onClick={() => setShowImportDialog(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import Classification
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>ตัวกรอง</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Bank Account */}
            <div>
              <label className="text-sm font-medium mb-2 block">บัญชีธนาคาร</label>
              <Select value={selectedBankAccount} onValueChange={setSelectedBankAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกบัญชีธนาคาร" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.bank_name} - {acc.account_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div>
              <label className="text-sm font-medium mb-2 block">ช่วงวันที่</label>
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            </div>

            {/* Search */}
            <div>
              <label className="text-sm font-medium mb-2 block">ค้นหา (รายละเอียด)</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ค้นหา..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Show Classified Toggle */}
            <div className="flex items-end">
              <label className="flex items-center space-x-2 cursor-pointer">
                <Checkbox checked={showClassified} onCheckedChange={(c) => setShowClassified(!!c)} />
                <span className="text-sm">แสดงรายการที่จัดประเภทแล้ว</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selection Banner */}
      {hasSelection && (
        <Alert className="border-primary bg-primary/5">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <strong>เลือกแล้ว {selectedCount} รายการ</strong> (รวม ฿{formatCurrency(selectedAmount)})
              {selection.allOnPageSelected && !selection.allFilteredSelected && total > transactions.length && (
                <>
                  {' '}
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-primary underline"
                    onClick={handleSelectAllFiltered}
                  >
                    เลือกทั้งหมด {total} รายการที่ตรงเงื่อนไข
                  </Button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setShowTypeDialog(true)}>
                <Tag className="mr-2 h-4 w-4" />
                กำหนดประเภท
              </Button>
              {showClassified && (
                <Button size="sm" variant="outline" onClick={handleClearClassification}>
                  ล้างการจัดประเภท
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={clearSelection}>
                ยกเลิก
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            รายการเงินเข้า ({total} รายการ)
            {!showClassified && <Badge className="ml-2">ยังไม่จัดประเภท</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">กำลังโหลด...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">ไม่พบข้อมูล</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selection.allOnPageSelected}
                        onCheckedChange={handleSelectAllOnPage}
                      />
                    </TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead>บัญชีธนาคาร</TableHead>
                    <TableHead>รายละเอียด</TableHead>
                    <TableHead className="text-right">จำนวนเงิน</TableHead>
                    <TableHead>ประเภท</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => {
                    const account = accounts.find((acc) => acc.id === txn.bank_account_id)
                    return (
                      <TableRow key={txn.id}>
                        <TableCell>
                          <Checkbox
                            checked={
                              selection.allFilteredSelected || selection.ids.has(txn.id)
                            }
                            onCheckedChange={(checked) => handleSelectRow(txn.id, !!checked)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(txn.txn_date)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {account ? `${account.bank_name} - ${account.account_number}` : 'N/A'}
                        </TableCell>
                        <TableCell className="max-w-md truncate">{txn.description}</TableCell>
                        <TableCell className="text-right font-mono text-green-600 font-medium">
                          ฿{formatCurrency(txn.deposit)}
                        </TableCell>
                        <TableCell>
                          {txn.cash_in_type ? (
                            <Badge variant="secondary">
                              {CASH_IN_TYPE_LABELS[txn.cash_in_type]}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  แสดง {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} จาก {total}{' '}
                  รายการ
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                  >
                    ก่อนหน้า
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page * pageSize >= total}
                  >
                    ถัดไป
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Apply Type Dialog */}
      <CashInTypeDialog
        open={showTypeDialog}
        onOpenChange={setShowTypeDialog}
        selectedCount={selectedCount}
        selectedAmount={selectedAmount}
        onConfirm={handleApplyType}
      />

      {/* Import Classification Dialog */}
      <ImportCashInDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={fetchTransactions}
      />
    </div>
  )
}
