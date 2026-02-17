'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertCircle, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'
import {
  getCandidateBankTransactions,
  createCommissionFromBankTransaction,
} from '@/app/(dashboard)/ceo-commission/actions'
import type { CandidateBankTransaction } from '@/types/ceo-commission'
import { formatInTimeZone } from 'date-fns-tz'
import { useToast } from '@/hooks/use-toast'

const BANGKOK_TZ = 'Asia/Bangkok'

interface ImportFromBankDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type Step = 'filter' | 'select' | 'declare'

export function ImportFromBankDialog({
  open,
  onOpenChange,
  onSuccess,
}: ImportFromBankDialogProps) {
  const { toast } = useToast()

  // State - steps
  const [step, setStep] = useState<Step>('filter')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // State - filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // State - candidates
  const [candidates, setCandidates] = useState<CandidateBankTransaction[]>([])
  const [selectedTransaction, setSelectedTransaction] =
    useState<CandidateBankTransaction | null>(null)

  // State - declaration form
  const [commissionDate, setCommissionDate] = useState('')
  const [platform, setPlatform] = useState('TikTok')
  const [grossAmount, setGrossAmount] = useState('')
  const [personalUsedAmount, setPersonalUsedAmount] = useState('')
  const [transferredAmount, setTransferredAmount] = useState('')
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const [validationError, setValidationError] = useState('')
  const [autoCalculate, setAutoCalculate] = useState(true)

  // Reset when dialog opens/closes
  useEffect(() => {
    if (open) {
      setStep('filter')
      setStartDate('')
      setEndDate('')
      setCandidates([])
      setSelectedTransaction(null)
      resetForm()
    }
  }, [open])

  // Auto-calculate transferred amount
  useEffect(() => {
    if (autoCalculate) {
      const gross = parseFloat(grossAmount) || 0
      const personal = parseFloat(personalUsedAmount) || 0
      const transferred = Math.max(0, gross - personal)
      setTransferredAmount(transferred > 0 ? transferred.toFixed(2) : '')
    }
  }, [grossAmount, personalUsedAmount, autoCalculate])

  // Real-time validation
  useEffect(() => {
    const gross = parseFloat(grossAmount) || 0
    const personal = parseFloat(personalUsedAmount) || 0
    const transferred = parseFloat(transferredAmount) || 0

    if (gross > 0) {
      const sum = personal + transferred
      const diff = Math.abs(gross - sum)

      if (diff > 0.01) {
        setValidationError(
          `ยอดรวมไม่ตรง: ${gross.toFixed(2)} ≠ ${personal.toFixed(2)} + ${transferred.toFixed(2)}`
        )
      } else {
        setValidationError('')
      }
    } else {
      setValidationError('')
    }
  }, [grossAmount, personalUsedAmount, transferredAmount])

  // Reset form
  const resetForm = () => {
    setCommissionDate('')
    setPlatform('TikTok')
    setGrossAmount('')
    setPersonalUsedAmount('')
    setTransferredAmount('')
    setNote('')
    setReference('')
    setValidationError('')
    setAutoCalculate(true)
  }

  // Step 1: Load candidates
  const handleLoadCandidates = async () => {
    try {
      setLoading(true)
      const result = await getCandidateBankTransactions({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })

      if (result.success) {
        setCandidates(result.data || [])
        if ((result.data || []).length === 0) {
          toast({
            title: 'ไม่พบรายการ',
            description: 'ไม่มีรายการธนาคารที่ตรงเงื่อนไข',
          })
        } else {
          setStep('select')
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'โหลดรายการไม่สำเร็จ',
        })
      }
    } catch (error) {
      console.error('Load candidates error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการโหลดรายการ',
      })
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Select transaction
  const handleSelectTransaction = (txn: CandidateBankTransaction) => {
    setSelectedTransaction(txn)

    // Pre-fill form
    setCommissionDate(txn.txn_date)
    setGrossAmount(txn.deposit.toFixed(2))
    setPersonalUsedAmount('0')
    setTransferredAmount(txn.deposit.toFixed(2))
    setReference(txn.reference_id || '')
    setAutoCalculate(true)

    setStep('declare')
  }

  // Step 3: Submit declaration
  const handleSubmit = async () => {
    try {
      if (!selectedTransaction) {
        toast({
          variant: 'destructive',
          title: 'ข้อผิดพลาด',
          description: 'ไม่พบรายการธนาคารที่เลือก',
        })
        return
      }

      // Validate
      if (!commissionDate) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาระบุวันที่รับ Commission',
        })
        return
      }
      if (!platform.trim()) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาระบุ Platform',
        })
        return
      }
      if (!grossAmount || parseFloat(grossAmount) <= 0) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ครบ',
          description: 'กรุณาระบุจำนวน Commission',
        })
        return
      }
      if (validationError) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลไม่ถูกต้อง',
          description: validationError,
        })
        return
      }

      setSubmitting(true)

      const result = await createCommissionFromBankTransaction({
        bank_transaction_id: selectedTransaction.id,
        commission_date: commissionDate,
        platform: platform.trim(),
        gross_amount: parseFloat(grossAmount),
        personal_used_amount: parseFloat(personalUsedAmount) || 0,
        transferred_to_company_amount: parseFloat(transferredAmount) || 0,
        note: note.trim() || undefined,
        reference: reference.trim() || undefined,
      })

      if (result.success) {
        if (result.warning) {
          toast({
            title: 'คำเตือน',
            description: result.warning,
          })
        }
        onSuccess()
        onOpenChange(false)
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'บันทึกไม่สำเร็จ',
        })
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการบันทึก',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Format number
  const formatNumber = (num: number) => {
    return num.toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      return formatInTimeZone(new Date(dateStr), BANGKOK_TZ, 'dd/MM/yyyy')
    } catch {
      return dateStr
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ดึงจากธนาคาร - Declare CEO Commission</DialogTitle>
          <DialogDescription>
            {step === 'filter' && 'เลือกช่วงวันที่เพื่อกรองรายการ (ไม่ระบุ = ทั้งหมด)'}
            {step === 'select' && 'เลือกรายการธนาคารที่เป็น Commission'}
            {step === 'declare' && 'ระบุรายละเอียด Commission'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Filter */}
        {step === 'filter' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">วันที่เริ่มต้น</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">วันที่สิ้นสุด</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                จะแสดงเฉพาะรายการจากบัญชีที่เลือกไว้ใน Settings และยังไม่ได้ declare
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Step 2: Select transaction */}
        {step === 'select' && (
          <div className="space-y-4">
            {candidates.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>ไม่มีรายการที่ตรงเงื่อนไข</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="text-sm text-muted-foreground">
                  พบ {candidates.length} รายการ - คลิกเพื่อเลือก
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead>บัญชี</TableHead>
                        <TableHead>รายละเอียด</TableHead>
                        <TableHead className="text-right">จำนวน</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((txn) => (
                        <TableRow
                          key={txn.id}
                          className="cursor-pointer hover:bg-accent"
                          onClick={() => handleSelectTransaction(txn)}
                        >
                          <TableCell className="font-medium">
                            {formatDate(txn.txn_date)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {txn.bank_account?.bank_name || 'N/A'}
                            <br />
                            <span className="text-muted-foreground">
                              {txn.bank_account?.account_number || ''}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-sm">
                            {txn.description || '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-green-600">
                            ฿{formatNumber(txn.deposit)}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: Declare form */}
        {step === 'declare' && selectedTransaction && (
          <div className="space-y-4">
            {/* Selected transaction info */}
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-1">รายการที่เลือก:</div>
                <div className="text-sm">
                  {formatDate(selectedTransaction.txn_date)} -{' '}
                  {selectedTransaction.bank_account?.bank_name} - ฿
                  {formatNumber(selectedTransaction.deposit)}
                  <br />
                  {selectedTransaction.description}
                </div>
              </AlertDescription>
            </Alert>

            {/* Form */}
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="commission_date">
                    วันที่รับ Commission <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="commission_date"
                    type="date"
                    value={commissionDate}
                    onChange={(e) => setCommissionDate(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="platform">
                    Platform <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="platform"
                    type="text"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gross_amount">
                  Commission ที่รับ (Gross) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="gross_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="personal_used">จำนวนที่ใช้ส่วนตัว</Label>
                <Input
                  id="personal_used"
                  type="number"
                  step="0.01"
                  min="0"
                  value={personalUsedAmount}
                  onChange={(e) => setPersonalUsedAmount(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transferred">
                  จำนวนที่โอนให้บริษัท
                  <span className="ml-2 text-xs text-muted-foreground">
                    {autoCalculate && '(คำนวณอัตโนมัติ)'}
                  </span>
                </Label>
                <Input
                  id="transferred"
                  type="number"
                  step="0.01"
                  min="0"
                  value={transferredAmount}
                  onChange={(e) => {
                    setTransferredAmount(e.target.value)
                    setAutoCalculate(false)
                  }}
                  onFocus={() => setAutoCalculate(false)}
                  disabled={submitting}
                />
              </div>

              {validationError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{validationError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="note">หมายเหตุ</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={submitting}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reference">Reference</Label>
                <Input
                  id="reference"
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'filter' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                ยกเลิก
              </Button>
              <Button onClick={handleLoadCandidates} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังโหลด...
                  </>
                ) : (
                  'ดูรายการ'
                )}
              </Button>
            </>
          )}

          {step === 'select' && (
            <>
              <Button variant="outline" onClick={() => setStep('filter')}>
                ย้อนกลับ
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                ยกเลิก
              </Button>
            </>
          )}

          {step === 'declare' && (
            <>
              <Button variant="outline" onClick={() => setStep('select')}>
                ย้อนกลับ
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !!validationError || !grossAmount || !platform}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'Declare Commission'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
