'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Expense, ExpenseFilters, ExpenseCategory } from '@/types/expenses'
import { endOfDayBangkok, formatBangkok } from '@/lib/bangkok-time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SingleDateRangePicker, DateRangeResult } from '@/components/shared/SingleDateRangePicker'
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
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download, FileUp, FileDown } from 'lucide-react'
import { AddExpenseDialog } from '@/components/expenses/AddExpenseDialog'
import { EditExpenseDialog } from '@/components/expenses/EditExpenseDialog'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { ExpensesImportDialog } from '@/components/expenses/ExpensesImportDialog'
import { deleteExpense, exportExpenses } from '@/app/(dashboard)/expenses/actions'
import { downloadExpenseTemplate } from '@/app/(dashboard)/expenses/template-actions'

const PER_PAGE = 20

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [downloadTemplateLoading, setDownloadTemplateLoading] = useState(false)

  const [filters, setFilters] = useState<ExpenseFilters>({
    category: undefined,
    startDate: undefined,
    endDate: undefined,
    search: undefined,
    page: 1,
    perPage: PER_PAGE,
  })

  useEffect(() => {
    fetchExpenses()
  }, [filters])

  const fetchExpenses = async () => {
    try {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      let query = supabase
        .from('expenses')
        .select('*', { count: 'exact' })
        .order('expense_date', { ascending: false })

      // Apply filters
      if (filters.category && filters.category !== 'All') {
        query = query.eq('category', filters.category)
      }

      if (filters.startDate) {
        query = query.gte('expense_date', filters.startDate)
      }

      if (filters.endDate) {
        // Use Bangkok timezone for end of day
        const endBangkok = endOfDayBangkok(filters.endDate)
        query = query.lte('expense_date', endBangkok.toISOString())
      }

      if (filters.search && filters.search.trim()) {
        query = query.or(
          `description.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
        )
      }

      // Pagination
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
      page: 1
    }))
  }

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }))
  }

  const getCategoryBadge = (category: ExpenseCategory) => {
    const config: Record<ExpenseCategory, { label: string; className: string }> = {
      Advertising: {
        label: 'ค่าโฆษณา',
        className: 'bg-purple-500 hover:bg-purple-600 text-white',
      },
      COGS: {
        label: 'ต้นทุนขาย',
        className: 'bg-orange-500 hover:bg-orange-600 text-white',
      },
      Operating: {
        label: 'ดำเนินงาน',
        className: 'bg-blue-500 hover:bg-blue-600 text-white',
      },
    }

    const { label, className } = config[category]
    return <Badge className={className}>{label}</Badge>
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const totalPages = Math.ceil(totalCount / PER_PAGE)

  const handleEdit = (expense: Expense) => {
    setSelectedExpense(expense)
    setShowEditDialog(true)
  }

  const handleDeleteClick = (expense: Expense) => {
    setSelectedExpense(expense)
    setShowDeleteDialog(true)
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

      // Success - close dialog and refresh
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
      })

      if (!result.success || !result.csv || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการ export')
        return
      }

      // Create blob and download
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

      if (!result.success || !result.buffer || !result.filename) {
        setError(result.error || 'เกิดข้อผิดพลาดในการดาวน์โหลด template')
        return
      }

      // Create blob and download
      const blob = new Blob([result.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">ช่วงวันที่</label>
          <SingleDateRangePicker
            defaultRange={
              filters.startDate && filters.endDate
                ? {
                    startDate: new Date(filters.startDate),
                    endDate: new Date(filters.endDate)
                  }
                : undefined
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
      <div className="flex gap-2">
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
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exportLoading || loading || expenses.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          {exportLoading ? 'กำลัง Export...' : 'Export CSV'}
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>วันที่</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead className="text-right">จำนวนเงิน</TableHead>
              <TableHead>รายละเอียด</TableHead>
              <TableHead>บันทึกเมื่อ</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="ml-auto h-4 w-24 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                  </TableCell>
                </TableRow>
              ))
            ) : expenses.length === 0 ? (
              // Empty state
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                    <p className="text-sm">ยังไม่มีรายการค่าใช้จ่าย</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              // Data rows
              expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="font-medium">
                    {formatDate(expense.expense_date)}
                  </TableCell>
                  <TableCell>{getCategoryBadge(expense.category)}</TableCell>
                  <TableCell className="text-right font-semibold text-red-600">
                    ฿{formatCurrency(expense.amount)}
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {expense.description || expense.notes || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(expense.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
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
            {Math.min(filters.page * PER_PAGE, totalCount)} จากทั้งหมด {totalCount}{' '}
            รายการ
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

      {/* Add Expense Dialog */}
      <AddExpenseDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={fetchExpenses}
      />

      {/* Edit Expense Dialog */}
      <EditExpenseDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={fetchExpenses}
        expense={selectedExpense}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
        title="ยืนยันการลบรายการค่าใช้จ่าย"
        description="คุณต้องการลบรายการค่าใช้จ่ายนี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้"
      />

      {/* Import Dialog */}
      <ExpensesImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={fetchExpenses}
      />
    </div>
  )
}
