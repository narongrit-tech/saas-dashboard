'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Wallet, WalletLedger, LedgerFilters } from '@/types/wallets'
import { toZonedTime } from 'date-fns-tz'
import { endOfDay } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download, Upload, Wallet as WalletIcon } from 'lucide-react'
import { AddLedgerDialog } from '@/components/wallets/AddLedgerDialog'
import { EditLedgerDialog } from '@/components/wallets/EditLedgerDialog'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { TigerImportDialog } from '@/components/wallets/TigerImportDialog'
import { PerformanceAdsImportDialog } from '@/components/wallets/PerformanceAdsImportDialog'
import { ShopeeWalletImportDialog } from '@/components/wallets/ShopeeWalletImportDialog'
import {
  deleteWalletLedgerEntry,
  exportWalletLedger,
  getWalletBalance,
} from '@/app/(dashboard)/wallets/actions'
import { WalletBalance } from '@/types/wallets'
import { getTodayBangkokString, parseBangkokDateStringToLocalDate } from '@/lib/bangkok-date-range'

const PER_PAGE = 20

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState<string>('')
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedger[]>([])
  const [walletBalance, setWalletBalance] = useState<WalletBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showTigerImportDialog, setShowTigerImportDialog] = useState(false)
  const [showPerformanceAdsImportDialog, setShowPerformanceAdsImportDialog] = useState(false)
  const [showShopeeWalletImportDialog, setShowShopeeWalletImportDialog] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<WalletLedger | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  const [filters, setFilters] = useState<LedgerFilters>({
    wallet_id: undefined,
    startDate: undefined,
    endDate: undefined,
    entry_type: undefined,
    source: undefined,
    page: 1,
    perPage: PER_PAGE,
  })

  // Fetch wallets on mount
  useEffect(() => {
    fetchWallets()
  }, [])

  // Fetch ledger entries when wallet or filters change
  useEffect(() => {
    if (selectedWalletId) {
      fetchLedgerEntries()
      fetchBalance()
    }
  }, [selectedWalletId, filters])

  const fetchWallets = async () => {
    try {
      const supabase = createClient()
      const { data, error: fetchError } = await supabase
        .from('wallets')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (fetchError) throw fetchError

      setWallets(data || [])

      // Auto-select first wallet if available
      if (data && data.length > 0 && !selectedWalletId) {
        setSelectedWalletId(data[0].id)
      }
    } catch (err) {
      console.error('Error fetching wallets:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลด wallets')
    }
  }

  const fetchLedgerEntries = async () => {
    try {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      let query = supabase
        .from('wallet_ledger')
        .select('*', { count: 'exact' })
        .eq('wallet_id', selectedWalletId)
        .order('date', { ascending: false })

      // Apply filters
      if (filters.startDate) {
        query = query.gte('date', filters.startDate)
      }

      if (filters.endDate) {
        // SAFE: Parse Bangkok date string correctly
        const bangkokDate = parseBangkokDateStringToLocalDate(filters.endDate)
        const endOfDayBangkok = endOfDay(bangkokDate)
        query = query.lte('date', endOfDayBangkok.toISOString())
      }

      if (filters.entry_type && filters.entry_type !== 'All') {
        query = query.eq('entry_type', filters.entry_type)
      }

      if (filters.source && filters.source !== 'All') {
        query = query.eq('source', filters.source)
      }

      // Pagination
      const from = (filters.page - 1) * filters.perPage
      const to = from + filters.perPage - 1
      query = query.range(from, to)

      const { data, error: fetchError, count } = await query

      if (fetchError) throw fetchError

      setLedgerEntries(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching ledger entries:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }

  const fetchBalance = async () => {
    try {
      // Default to last 30 days if no date filter
      // SAFE: Use Bangkok timezone for date strings
      const endDate = filters.endDate || getTodayBangkokString()
      const startDate = filters.startDate || (() => {
        const today = new Date()
        today.setDate(today.getDate() - 30)
        // Convert 30 days ago to Bangkok date string
        const year = today.getFullYear()
        const month = String(today.getMonth() + 1).padStart(2, '0')
        const day = String(today.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      })()

      const result = await getWalletBalance({
        walletId: selectedWalletId,
        startDate,
        endDate,
      })

      if (result.success && result.data) {
        setWalletBalance(result.data as WalletBalance)
      } else {
        console.error('Error calculating balance:', result.error)
        setWalletBalance(null)
      }
    } catch (err) {
      console.error('Error calculating balance:', err)
      setWalletBalance(null)
    }
  }

  const handleFilterChange = (key: keyof LedgerFilters, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }))
  }

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }))
  }

  const handleWalletChange = (walletId: string) => {
    setSelectedWalletId(walletId)
    setFilters((prev) => ({ ...prev, wallet_id: walletId, page: 1 }))
  }

  const getEntryTypeBadge = (entryType: string) => {
    const config: Record<string, { label: string; className: string }> = {
      TOP_UP: { label: 'Top-up', className: 'bg-green-500 hover:bg-green-600 text-white' },
      SPEND: { label: 'Spend', className: 'bg-red-500 hover:bg-red-600 text-white' },
      REFUND: { label: 'Refund', className: 'bg-blue-500 hover:bg-blue-600 text-white' },
      ADJUSTMENT: { label: 'Adjustment', className: 'bg-gray-500 hover:bg-gray-600 text-white' },
    }
    const { label, className } = config[entryType] || { label: entryType, className: 'bg-gray-500' }
    return <Badge className={className}>{label}</Badge>
  }

  const getSourceBadge = (source: string) => {
    return source === 'MANUAL' ? (
      <Badge variant="outline">Manual</Badge>
    ) : (
      <Badge className="bg-purple-500 hover:bg-purple-600 text-white">Imported</Badge>
    )
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

  const handleEdit = (entry: WalletLedger) => {
    setSelectedEntry(entry)
    setShowEditDialog(true)
  }

  const handleDeleteClick = (entry: WalletLedger) => {
    setSelectedEntry(entry)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    if (!selectedEntry) return

    setDeleteLoading(true)
    setError(null)

    try {
      const result = await deleteWalletLedgerEntry(selectedEntry.id)

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาดในการลบข้อมูล')
        setShowDeleteDialog(false)
        return
      }

      setShowDeleteDialog(false)
      setSelectedEntry(null)
      fetchLedgerEntries()
      fetchBalance()
    } catch (err) {
      console.error('Error deleting entry:', err)
      setError('เกิดข้อผิดพลาดในการลบข้อมูล')
      setShowDeleteDialog(false)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleExport = async () => {
    if (!selectedWalletId) return

    setExportLoading(true)
    setError(null)

    try {
      const result = await exportWalletLedger({
        wallet_id: selectedWalletId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        entry_type: filters.entry_type,
        source: filters.source,
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
      console.error('Error exporting ledger:', err)
      setError('เกิดข้อผิดพลาดในการ export')
    } finally {
      setExportLoading(false)
    }
  }

  const totalPages = Math.ceil(totalCount / PER_PAGE)
  const selectedWallet = wallets.find((w) => w.id === selectedWalletId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <WalletIcon className="h-8 w-8" />
          Wallets
        </h1>
      </div>

      {/* Wallet Selector */}
      <div className="flex gap-4 items-end">
        <div className="flex-1 max-w-md space-y-2">
          <label className="text-sm font-medium">Select Wallet</label>
          <Select value={selectedWalletId} onValueChange={handleWalletChange}>
            <SelectTrigger>
              <SelectValue placeholder="เลือก wallet" />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((wallet) => (
                <SelectItem key={wallet.id} value={wallet.id}>
                  {wallet.name} ({wallet.wallet_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Balance Summary Cards */}
      {selectedWalletId && walletBalance && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Opening Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ฿{formatCurrency(walletBalance.opening_balance)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total IN</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                +฿{formatCurrency(walletBalance.total_in)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Top-up: ฿{formatCurrency(walletBalance.top_up_total)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total OUT</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                -฿{formatCurrency(walletBalance.total_out)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Spend: ฿{formatCurrency(walletBalance.spend_total)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Closing Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${walletBalance.closing_balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ฿{formatCurrency(walletBalance.closing_balance)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Net: {walletBalance.net_change >= 0 ? '+' : ''}฿{formatCurrency(walletBalance.net_change)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      {selectedWalletId && (
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">วันที่เริ่มต้น</label>
            <Input
              type="date"
              value={filters.startDate || ''}
              onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
            />
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">วันที่สิ้นสุด</label>
            <Input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
            />
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Entry Type</label>
            <Select
              value={filters.entry_type || 'All'}
              onValueChange={(value) =>
                handleFilterChange('entry_type', value === 'All' ? undefined : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="ทั้งหมด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">ทั้งหมด</SelectItem>
                <SelectItem value="TOP_UP">Top-up</SelectItem>
                <SelectItem value="SPEND">Spend</SelectItem>
                <SelectItem value="REFUND">Refund</SelectItem>
                <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Source</label>
            <Select
              value={filters.source || 'All'}
              onValueChange={(value) =>
                handleFilterChange('source', value === 'All' ? undefined : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="ทั้งหมด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">ทั้งหมด</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="IMPORTED">Imported</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {selectedWalletId && (
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Entry
          </Button>
          {selectedWallet?.wallet_type === 'ADS' && (
            <>
              <Button
                variant="secondary"
                onClick={() => setShowPerformanceAdsImportDialog(true)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Performance Ads
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowTigerImportDialog(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Awareness Ads (Monthly)
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            onClick={() => setShowShopeeWalletImportDialog(true)}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Shopee Wallet
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportLoading || loading || ledgerEntries.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportLoading ? 'Exporting...' : 'Export CSV'}
          </Button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Table */}
      {selectedWalletId && (
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry Type</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Note</TableHead>
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
                      <div className="h-4 w-12 animate-pulse rounded bg-gray-200" />
                    </TableCell>
                    <TableCell>
                      <div className="ml-auto h-4 w-20 animate-pulse rounded bg-gray-200" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
                    </TableCell>
                  </TableRow>
                ))
              ) : ledgerEntries.length === 0 ? (
                // Empty state
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <p className="text-lg font-medium">ไม่พบข้อมูล</p>
                      <p className="text-sm">ยังไม่มีรายการ transaction</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                // Data rows
                ledgerEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{formatDate(entry.date)}</TableCell>
                    <TableCell>{getEntryTypeBadge(entry.entry_type)}</TableCell>
                    <TableCell>
                      <Badge variant={entry.direction === 'IN' ? 'default' : 'secondary'}>
                        {entry.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${entry.direction === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                      {entry.direction === 'IN' ? '+' : '-'}฿{formatCurrency(entry.amount)}
                    </TableCell>
                    <TableCell>{getSourceBadge(entry.source)}</TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {entry.reference_id || '-'}
                    </TableCell>
                    <TableCell className="max-w-md truncate">
                      {entry.note || '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                          title="แก้ไข"
                          disabled={entry.source === 'IMPORTED'}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(entry)}
                          title="ลบ"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          disabled={entry.source === 'IMPORTED'}
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
      )}

      {/* Pagination */}
      {selectedWalletId && !loading && ledgerEntries.length > 0 && (
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

      {/* Dialogs */}
      {selectedWallet && (
        <>
          <AddLedgerDialog
            open={showAddDialog}
            onOpenChange={setShowAddDialog}
            wallet={selectedWallet}
            onSuccess={() => {
              fetchLedgerEntries()
              fetchBalance()
            }}
          />

          {selectedEntry && (
            <EditLedgerDialog
              open={showEditDialog}
              onOpenChange={setShowEditDialog}
              wallet={selectedWallet}
              entry={selectedEntry}
              onSuccess={() => {
                fetchLedgerEntries()
                fetchBalance()
              }}
            />
          )}

          <DeleteConfirmDialog
            open={showDeleteDialog}
            onOpenChange={setShowDeleteDialog}
            onConfirm={handleDeleteConfirm}
            loading={deleteLoading}
            title="ยืนยันการลบรายการ"
            description="คุณต้องการลบรายการนี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้"
          />

          <ShopeeWalletImportDialog
            open={showShopeeWalletImportDialog}
            onOpenChange={setShowShopeeWalletImportDialog}
            onSuccess={() => {
              // Shopee wallet transactions are in a separate table
              // Refresh the ledger view if needed in future
            }}
          />

          {selectedWallet.wallet_type === 'ADS' && (
            <>
              <PerformanceAdsImportDialog
                open={showPerformanceAdsImportDialog}
                onOpenChange={setShowPerformanceAdsImportDialog}
                adsWalletId={selectedWallet.id}
                onImportSuccess={() => {
                  fetchLedgerEntries()
                  fetchBalance()
                }}
              />
              <TigerImportDialog
                open={showTigerImportDialog}
                onOpenChange={setShowTigerImportDialog}
                adsWalletId={selectedWallet.id}
                onImportSuccess={() => {
                  fetchLedgerEntries()
                  fetchBalance()
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
