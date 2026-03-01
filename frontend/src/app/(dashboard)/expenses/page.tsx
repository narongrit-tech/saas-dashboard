'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Expense, ExpenseFilters, ExpenseCategory, ExpenseStatus } from '@/types/expenses'
import { endOfDayBangkok, formatBangkok } from '@/lib/bangkok-time'
import { toZonedTime } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { DateRangePicker, DateRangeResult } from '@/components/shared/DateRangePicker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Download,
  FileUp,
  FileDown,
  X,
  CheckCircle,
} from 'lucide-react'
import { AddExpenseDialog } from '@/components/expenses/AddExpenseDialog'
import { EditExpenseDialog } from '@/components/expenses/EditExpenseDialog'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { BulkDeleteConfirmDialog } from '@/components/expenses/BulkDeleteConfirmDialog'
import { ExpensesImportDialog } from '@/components/expenses/ExpensesImportDialog'
import { ConfirmPaidDialog } from '@/components/expenses/ConfirmPaidDialog'
import {
  deleteExpense,
  exportExpenses,
  getExpensesSelectionSummary,
  deleteExpensesSelected,
  SelectionMode,
} from '@/app/(dashboard)/expenses/actions'
import { downloadExpenseTemplate } from '@/app/(dashboard)/expenses/template-actions'

const PER_PAGE = 20

function getDefaultRange(): DateRangeResult {
  const now = toZonedTime(new Date(), 'Asia/Bangkok')
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  return { startDate: startOfDay, endDate: now, preset: 'today' }
}

function StatusBadge({ status }: { status: ExpenseStatus }) {
  if (status === 'PAID') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        จ่ายแล้ว
      </Badge>
    )
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
      รอยืนยัน
    </Badge>
  )
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showConfirmPaidDialog, setShowConfirmPaidDialog] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [downloadTemplateLoading, setDownloadTemplateLoading] = useState(false)

  // Cash-basis export toggle
  const [exportCashBasis, setExportCashBasis] = useState(false)

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('ids')
  const [showSelectAllBanner, setShowSelectAllBanner] = useState(false)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false)
  const [selectionSummary, setSelectionSummary] = useState<{
    count: number
    amount: number
    blockedCount: number
    blockedReason?: string
  } | null>(null)

  const [filters, setFilters] = useState<ExpenseFilters>({
    category: undefined,
    status: 'All',
    startDate: undefined,
    endDate: undefined,
    search: undefined,
    page: 1,
    perPage: PER_PAGE,
  })

  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('All')
  const [subcategories, setSubcategories] = useState<string[]>([])

  useEffect(() => {
    fetchExpenses()
  }, [filters])

  useEffect(() => {
    if (expenses.length > 0) {
      const unique = Array.from(
        new Set(expenses.map((e) => e.subcategory).filter((s): s is string => Boolean(s)))
      )
      setSubcategories(unique.sort())
    } else {
      setSubcategories([])
    }
  }, [expenses])

  const fetchExpenses = async () => {
    try {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      let query = supabase
        .from('expenses')
        .select('*', { count: 'exact' })
        .order('expense_date', { ascending: false })

      if (filters.category && filters.category !== 'All') {
        query = query.eq('category', filters.category)
      }

      if (filters.status && filters.status !== 'All') {
        query = query.eq('expense_status', filters.status)
      }

      if (filters.startDate) {
        query = query.gte('expense_date', filters.startDate)
      }

      if (filters.endDate) {
        const endBangkok = endOfDayBangkok(filters.endDate)
        query = query.lte('expense_date', endBangkok.toISOString())
      }

      if (filters.search && filters.search.trim()) {
        query = query.or(
          `description.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
        )
      }

      const from = (filters.page - 1) * filters.perPage
      const to = from + filters.perPage - 1
      query = query.range(from, to)

      const { data, error: fetchError, count } = await query

      if (fetchError) throw fetchError

      setExpenses(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching expenses:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: keyof ExpenseFilters, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  const handleDateRangeChange = (range: DateRangeResult) => {
    setFilters((prev) => ({
      ...prev,
      startDate: formatBangkok(range.startDate, 'yyyy-MM-dd'),
      endDate: formatBangkok(range.endDate, 'yyyy-MM-dd'),
      page: 1,
    }))
  }

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }))
  }

  const getCategoryBadge = (category: ExpenseCategory) => {
    const config: Record<ExpenseCategory, { label: string; className: string }> = {
      Advertising: { label: 'ค่าโฆษณา', className: 'bg-purple-500 hover:bg-purple-600 text-white' },
      COGS: { label: 'ต้นทุนขาย', className: 'bg-orange-500 hover:bg-orange-600 text-white' },
      Operating: { label: 'ดำเนินงาน', className: 'bg-blue-500 hover:bg-blue-600 text-white' },
      Tax: { label: 'ภาษี', className: 'bg-rose-500 hover:bg-rose-600 text-white' },
    }
    const { label, className } = config[category]
    return <Badge className={className}>{label}</Badge>
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const displayedExpenses =
    subcategoryFilter === 'All'
      ? expenses
      : expenses.filter((e) => e.subcategory === subcategoryFilter)

  const totalPages = Math.ceil(totalCount / PER_PAGE)

  const handleEdit = (expense: Expense) => {
    setSelectedExpense(expense)
    setShowEditDialog(true)
  }

  const handleDeleteClick = (expense: Expense) => {
    setSelectedExpense(expense)
    setShowDeleteDialog(true)
  }

  const handleConfirmPaidClick = (expense: Expense) => {
    setSelectedExpense(expense)
    setShowConfirmPaidDialog(true)
  }

  const handleDeleteConfirm = async () => {
    if (!selectedExpense) return
    setDeleteLoading(true)
    setError(null)

    try {
      const result = await deleteExpense(selectedExpense.id)
      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการลบข้อมูล')
        setShowDeleteDialog(false)
        return
      }
      setShowDeleteDialog(false)
      setSelectedExpense(null)
      fetchExpenses()
    } catch (err) {
      console.error('Error deleting expense:', err)
      setError('เกิดข้อผิดพลาดในการลบข้อมูล')
      setShowDeleteDialog(false)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleExport = async () => {
    setExportLoading(true)
    setError(null)

    try {
      const result = await exportExpenses({
        category: filters.category,
        startDate: filters.startDate,
        endDate: filters.endDate,
        search: filters.search,
        statusFilter: exportCashBasis ? 'PAID' : (filters.status as 'All' | 'DRAFT' | 'PAID' | undefined),
        dateBasis: exportCashBasis ? 'paid_date' : 'expense_date',
      })

      if (!result.success || !result.csv || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการ export')
        return
      }

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Error exporting expenses:', err)
      setError('เกิดข้อผิดพลาดในการ export')
    } finally {
      setExportLoading(false)
    }
  }

  const handleDownloadTemplate = async () => {
    setDownloadTemplateLoading(true)
    setError(null)

    try {
      const result = await downloadExpenseTemplate()
      if (!result.success || !result.base64 || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการดาวน์โหลด template')
        return
      }
      const binaryString = atob(result.base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Error downloading template:', err)
      setError('เกิดข้อผิดพลาดในการดาวน์โหลด template')
    } finally {
      setDownloadTemplateLoading(false)
    }
  }

  // Bulk selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(displayedExpenses.map((e) => e.id)))
      setShowSelectAllBanner(displayedExpenses.length < totalCount)
      setSelectionMode('ids')
    } else {
      setSelectedIds(new Set())
      setShowSelectAllBanner(false)
      setSelectionMode('ids')
    }
  }

  const handleSelectRow = (expenseId: string, checked: boolean) => {
    const newSelectedIds = new Set(selectedIds)
    if (checked) {
      newSelectedIds.add(expenseId)
    } else {
      newSelectedIds.delete(expenseId)
      if (selectionMode === 'filtered') {
        setShowSelectAllBanner(true)
        setSelectionMode('ids')
      }
    }
    setSelectedIds(newSelectedIds)
  }

  const handleSelectAllMatching = () => {
    setSelectionMode('filtered')
    setShowSelectAllBanner(false)
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
    setSelectionMode('ids')
    setShowSelectAllBanner(false)
    setSelectionSummary(null)
  }

  const handleBulkDeleteClick = async () => {
    setError(null)
    const result = await getExpensesSelectionSummary(
      selectionMode,
      selectionMode === 'filtered'
        ? {
            category: filters.category,
            status: filters.status,
            startDate: filters.startDate,
            endDate: filters.endDate,
            search: filters.search,
          }
        : undefined,
      selectionMode === 'ids' ? Array.from(selectedIds) : undefined
    )
    if (!result.success) {
      setError(result.error || 'เกิดข้อผิดพลาดในการดึงข้อมูล')
      return
    }
    setSelectionSummary({
      count: result.deletableCount || 0,
      amount: result.sumAmount || 0,
      blockedCount: result.blockedCount || 0,
      blockedReason: result.blockedReason,
    })
    setShowBulkDeleteDialog(true)
  }

  const handleBulkDeleteConfirm = async () => {
    setBulkDeleteLoading(true)
    setError(null)
    try {
      const result = await deleteExpensesSelected(
        selectionMode,
        selectionMode === 'filtered'
          ? {
              category: filters.category,
              status: filters.status,
              startDate: filters.startDate,
              endDate: filters.endDate,
              search: filters.search,
            }
          : undefined,
        selectionMode === 'ids' ? Array.from(selectedIds) : undefined
      )
      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการลบข้อมูล')
        setShowBulkDeleteDialog(false)
        return
      }
      setShowBulkDeleteDialog(false)
      handleClearSelection()
      fetchExpenses()
    } catch (err) {
      console.error('Error bulk deleting expenses:', err)
      setError('เกิดข้อผิดพลาดในการลบข้อมูล')
      setShowBulkDeleteDialog(false)
    } finally {
      setBulkDeleteLoading(false)
    }
  }

  const isAllPageSelected =
    displayedExpenses.length > 0 && displayedExpenses.every((e) => selectedIds.has(e.id))

  const hasSelection = selectedIds.size > 0 || selectionMode === 'filtered'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Expenses</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">ประเภท</label>
          <Select
            value={filters.category || 'All'}
            onValueChange={(value) =>
              handleFilterChange('category', value === 'All' ? undefined : value)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="เลือกประเภท" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">ทั้งหมด</SelectItem>
              <SelectItem value="Advertising">ค่าโฆษณา</SelectItem>
              <SelectItem value="COGS">ต้นทุนขาย (COGS)</SelectItem>
              <SelectItem value="Operating">ค่าใช้จ่ายดำเนินงาน</SelectItem>
              <SelectItem value="Tax">ภาษี (Tax)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">สถานะ</label>
          <Select
            value={filters.status || 'All'}
            onValueChange={(value) =>
              handleFilterChange('status', value === 'All' ? undefined : value)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="ทุกสถานะ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">ทุกสถานะ</SelectItem>
              <SelectItem value="DRAFT">DRAFT (รอยืนยัน)</SelectItem>
              <SelectItem value="PAID">PAID (จ่ายแล้ว)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">หมวดหมู่ย่อย</label>
          <Select
            value={subcategoryFilter}
            onValueChange={(value) => {
              setSubcategoryFilter(value)
              setFilters((prev) => ({ ...prev, page: 1 }))
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="ทุกหมวดหมู่ย่อย" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">ทุกหมวดหมู่ย่อย</SelectItem>
              {subcategories.map((sub) => (
                <SelectItem key={sub} value={sub}>
                  {sub}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">ช่วงวันที่</label>
          <DateRangePicker
            value={
              filters.startDate && filters.endDate
                ? { startDate: new Date(filters.startDate), endDate: new Date(filters.endDate) }
                : getDefaultRange()
            }
            onChange={handleDateRangeChange}
          />
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">ค้นหา</label>
          <Input
            placeholder="ค้นหารายละเอียด..."
            value={filters.search || ''}
            onChange={(e) => handleFilterChange('search', e.target.value || undefined)}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          เพิ่มค่าใช้จ่าย
        </Button>
        <Button
          variant="outline"
          onClick={handleDownloadTemplate}
          disabled={downloadTemplateLoading}
        >
          <FileDown className="mr-2 h-4 w-4" />
          {downloadTemplateLoading ? 'กำลังดาวน์โหลด...' : 'Download Template'}
        </Button>
        <Button variant="outline" onClick={() => setShowImportDialog(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Import
        </Button>

        {/* Export area */}
        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={exportCashBasis}
              onChange={(e) => setExportCashBasis(e.target.checked)}
              className="h-3.5 w-3.5 accent-green-600"
            />
            <span className="text-muted-foreground">Cash-basis (PAID เท่านั้น / ใช้วันจ่ายจริง)</span>
          </label>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportLoading || loading || expenses.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportLoading ? 'กำลัง Export...' : 'Export CSV'}
          </Button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">{error}</div>
      )}

      {/* Selection Banner */}
      {showSelectAllBanner && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-4 flex items-center justify-between">
          <span className="text-sm text-blue-900">
            เลือกแล้ว {selectedIds.size} รายการในหน้านี้.{' '}
            <button
              onClick={handleSelectAllMatching}
              className="font-medium text-blue-600 hover:text-blue-700 underline"
            >
              เลือกทั้งหมด {totalCount} รายการที่ตรงกับเงื่อนไขปัจจุบัน
            </button>
          </span>
          <Button variant="ghost" size="sm" onClick={handleClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {hasSelection && (
        <div className="rounded-md bg-slate-100 border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {selectionMode === 'filtered'
                ? `เลือกทั้งหมด ${totalCount} รายการที่ตรงกับเงื่อนไข`
                : `เลือกแล้ว ${selectedIds.size} รายการ`}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleClearSelection}>
                ยกเลิกการเลือก
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDeleteClick}>
                <Trash2 className="mr-2 h-4 w-4" />
                ลบที่เลือก
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={isAllPageSelected}
                  onCheckedChange={handleSelectAll}
                  disabled={loading || displayedExpenses.length === 0}
                />
              </TableHead>
              <TableHead>วันที่</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead>หมวดหมู่ย่อย</TableHead>
              <TableHead className="text-right">จำนวนเงิน</TableHead>
              <TableHead>รายละเอียด</TableHead>
              <TableHead>วันจ่ายจริง</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 9 }).map((__, ci) => (
                    <TableCell key={ci}>
                      <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : displayedExpenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                    <p className="text-sm">
                      {subcategoryFilter !== 'All'
                        ? 'ไม่พบรายการที่ตรงกับหมวดหมู่ย่อยที่เลือก'
                        : 'ยังไม่มีรายการค่าใช้จ่าย'}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              displayedExpenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(expense.id)}
                      onCheckedChange={(checked) =>
                        handleSelectRow(expense.id, checked as boolean)
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatDate(expense.expense_date)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={expense.expense_status ?? 'PAID'} />
                  </TableCell>
                  <TableCell>{getCategoryBadge(expense.category)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {expense.subcategory || '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-red-600">
                    ฿{formatCurrency(expense.amount)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {expense.description || expense.notes || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {expense.paid_date ? formatDate(expense.paid_date) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {expense.expense_status !== 'PAID' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleConfirmPaidClick(expense)}
                          title="ยืนยันการจ่าย"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(expense)}
                        title="แก้ไข"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(expense)}
                        title="ลบ"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {!loading && expenses.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            แสดง {(filters.page - 1) * PER_PAGE + 1} ถึง{' '}
            {Math.min(filters.page * PER_PAGE, totalCount)} จากทั้งหมด {totalCount} รายการ
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(filters.page - 1)}
              disabled={filters.page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              ก่อนหน้า
            </Button>
            <span className="text-sm">
              หน้า {filters.page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(filters.page + 1)}
              disabled={filters.page >= totalPages}
            >
              ถัดไป
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <AddExpenseDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={fetchExpenses}
      />

      <EditExpenseDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={fetchExpenses}
        expense={selectedExpense}
      />

      <ConfirmPaidDialog
        open={showConfirmPaidDialog}
        onOpenChange={setShowConfirmPaidDialog}
        expense={selectedExpense}
        onSuccess={fetchExpenses}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title={
          selectedExpense?.expense_status === 'PAID'
            ? 'ยืนยันการลบรายการที่จ่ายแล้ว'
            : 'ยืนยันการลบรายการค่าใช้จ่าย'
        }
        description={
          selectedExpense?.expense_status === 'PAID'
            ? 'รายการนี้ยืนยันจ่ายแล้ว คุณต้องการลบใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้'
            : 'คุณต้องการลบรายการค่าใช้จ่ายนี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้'
        }
      />

      <ExpensesImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={fetchExpenses}
      />

      {selectionSummary && (
        <BulkDeleteConfirmDialog
          open={showBulkDeleteDialog}
          onOpenChange={setShowBulkDeleteDialog}
          onConfirm={handleBulkDeleteConfirm}
          loading={bulkDeleteLoading}
          count={selectionSummary.count}
          amount={selectionSummary.amount}
          blockedCount={selectionSummary.blockedCount}
          blockedReason={selectionSummary.blockedReason}
        />
      )}
    </div>
  )
}
