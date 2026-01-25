'use client'

import { useState } from 'react'
import { createBankAccount } from '@/app/(dashboard)/bank/actions'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

interface AddBankAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function AddBankAccountDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddBankAccountDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState<'savings' | 'current' | 'fixed_deposit' | 'other'>('savings')
  const { toast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!bankName.trim() || !accountNumber.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Bank name and account number are required',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    const result = await createBankAccount({
      bank_name: bankName.trim(),
      account_number: accountNumber.trim(),
      account_type: accountType,
      currency: 'THB',
    })

    if (result.success) {
      toast({
        title: 'Success',
        description: 'Bank account added successfully',
      })
      setBankName('')
      setAccountNumber('')
      setAccountType('savings')
      onOpenChange(false)
      onSuccess()
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to add bank account',
        variant: 'destructive',
      })
    }
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Bank Account</DialogTitle>
          <DialogDescription>
            Add a new bank account to track cash flow
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="bank_name">Bank Name</Label>
              <Input
                id="bank_name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g., Kasikorn Bank"
                required
              />
            </div>
            <div>
              <Label htmlFor="account_number">Account Number</Label>
              <Input
                id="account_number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g., 123-4-56789-0"
                required
              />
            </div>
            <div>
              <Label htmlFor="account_type">Account Type</Label>
              <Select value={accountType} onValueChange={(val: any) => setAccountType(val)}>
                <SelectTrigger id="account_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="current">Current</SelectItem>
                  <SelectItem value="fixed_deposit">Fixed Deposit</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
