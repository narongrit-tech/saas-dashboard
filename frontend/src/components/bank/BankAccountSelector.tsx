'use client'

import { BankAccount } from '@/types/bank'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface BankAccountSelectorProps {
  accounts: BankAccount[]
  selectedAccountId: string
  onSelectAccount: (accountId: string) => void
}

export default function BankAccountSelector({
  accounts,
  selectedAccountId,
  onSelectAccount,
}: BankAccountSelectorProps) {
  return (
    <div className="w-full max-w-xs">
      <Select value={selectedAccountId} onValueChange={onSelectAccount}>
        <SelectTrigger>
          <SelectValue placeholder="Select bank account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.bank_name} - {account.account_number}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
