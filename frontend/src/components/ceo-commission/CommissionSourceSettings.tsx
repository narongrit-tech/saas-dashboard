'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  getCommissionSources,
  getBankAccountsForSourceSelection,
  updateCommissionSources,
} from '@/app/(dashboard)/ceo-commission/actions'
import type { BankAccount } from '@/types/bank'
import { useToast } from '@/hooks/use-toast'

export function CommissionSourceSettings() {
  const { toast } = useToast()

  // State
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [hasChanges, setHasChanges] = useState(false)

  // Load data
  const loadData = async () => {
    try {
      setLoading(true)

      // Load all bank accounts
      const accountsResult = await getBankAccountsForSourceSelection()
      if (!accountsResult.success) {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: `โหลดบัญชีธนาคารไม่สำเร็จ: ${accountsResult.error}`,
        })
        return
      }

      setBankAccounts(accountsResult.data || [])

      // Load selected sources
      const sourcesResult = await getCommissionSources()
      if (!sourcesResult.success) {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: `โหลดแหล่งเงินไม่สำเร็จ: ${sourcesResult.error}`,
        })
        return
      }

      const sourceIds = new Set(
        (sourcesResult.data || []).map((source) => source.bank_account_id)
      )
      setSelectedAccountIds(sourceIds)
      setHasChanges(false)
    } catch (error) {
      console.error('Load data error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการโหลดข้อมูล',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Handle checkbox change
  const handleToggle = (accountId: string) => {
    const newSelected = new Set(selectedAccountIds)
    if (newSelected.has(accountId)) {
      newSelected.delete(accountId)
    } else {
      newSelected.add(accountId)
    }
    setSelectedAccountIds(newSelected)
    setHasChanges(true)
  }

  // Handle save
  const handleSave = async () => {
    try {
      setSaving(true)
      const result = await updateCommissionSources(Array.from(selectedAccountIds))

      if (result.success) {
        toast({
          title: 'สำเร็จ',
          description: result.message || 'บันทึกแหล่งเงิน Commission สำเร็จ',
        })
        setHasChanges(false)
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'บันทึกไม่สำเร็จ',
        })
      }
    } catch (error) {
      console.error('Save error:', error)
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: 'เกิดข้อผิดพลาดในการบันทึก',
      })
    } finally {
      setSaving(false)
    }
  }

  // Format account display
  const formatAccount = (account: BankAccount) => {
    return `${account.bank_name} - ${account.account_number} (${account.account_type})`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          แหล่งเงิน CEO Commission (บัญชีต้นทาง)
          {selectedAccountIds.size > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({selectedAccountIds.size} บัญชี)
            </span>
          )}
        </CardTitle>
        <CardDescription>
          เลือกบัญชีธนาคารที่รับเงิน Commission (เช่น บัญชีส่วนตัวของ CEO) เฉพาะรายการจากบัญชีที่เลือกจะแสดงใน "ดึงจากธนาคาร"
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : bankAccounts.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              ไม่พบบัญชีธนาคาร กรุณาเพิ่มบัญชีธนาคารใน Bank Module ก่อน
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Empty state when no sources selected */}
            {selectedAccountIds.size === 0 && !hasChanges && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  โปรดเลือกบัญชีต้นทางก่อนใช้งานระบบ CEO Commission
                </AlertDescription>
              </Alert>
            )}

            {/* Bank account checkboxes */}
            <div className="space-y-3 border rounded-lg p-4">
              {bankAccounts.map((account) => {
                const isSelected = selectedAccountIds.has(account.id)
                return (
                  <div key={account.id} className="flex items-center space-x-3">
                    <Checkbox
                      id={account.id}
                      checked={isSelected}
                      onCheckedChange={() => handleToggle(account.id)}
                      disabled={saving}
                    />
                    <Label
                      htmlFor={account.id}
                      className="flex-1 font-normal cursor-pointer"
                    >
                      {formatAccount(account)}
                    </Label>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            <div className="text-sm text-muted-foreground">
              {selectedAccountIds.size === 0 ? (
                'ยังไม่ได้เลือกบัญชีใดเลย'
              ) : (
                <>
                  เลือกแล้ว {selectedAccountIds.size} จาก {bankAccounts.length} บัญชี
                </>
              )}
            </div>

            {/* Save button */}
            <div className="flex justify-end gap-2">
              {hasChanges && (
                <Button
                  variant="outline"
                  onClick={() => {
                    loadData() // Reset
                  }}
                  disabled={saving}
                >
                  ยกเลิก
                </Button>
              )}
              <Button onClick={handleSave} disabled={!hasChanges || saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังบันทึก...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    บันทึก
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
