'use client';

// Manual Match Modal Component
// Purpose: Manual reconciliation override for bank transactions
// Created: 2026-01-26

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { BankTransaction } from '@/types/bank';
import { WalletOption } from '@/types/bank-reconciliation-manual';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';

// Helper function
const formatCurrency = (amount: number) => {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

import {
  getSuggestedMatches,
  createExpenseFromBankTransaction,
  createWalletTopupFromBankTransaction,
  createWalletSpendFromBankTransaction,
  matchBankTransactionToSettlement,
  createAdjustmentForBankTransaction,
  ignoreBankTransaction,
  getAvailableWallets,
  searchExpenses,
  matchBankTransactionToExpense,
  ExpenseSearchResult,
} from '@/app/(dashboard)/reconciliation/manual-match-actions';

interface ManualMatchModalProps {
  bankTransaction: BankTransaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface SuggestedMatch {
  entity_type: 'settlement' | 'expense' | 'wallet_topup';
  entity_id: string;
  date: string;
  description: string;
  amount: number;
  match_score: number;
  match_reason: string;
}

export function ManualMatchModal({
  bankTransaction,
  open,
  onOpenChange,
  onSuccess,
}: ManualMatchModalProps) {
  const { toast } = useToast();

  // State
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<{
    settlements: SuggestedMatch[];
    expenses: SuggestedMatch[];
    walletEntries: SuggestedMatch[];
  }>({ settlements: [], expenses: [], walletEntries: [] });
  const [wallets, setWallets] = useState<WalletOption[]>([]);

  // Form state
  const [action, setAction] = useState<
    | 'match'
    | 'create_expense'
    | 'create_wallet_topup'
    | 'create_wallet_spend'
    | 'adjustment'
    | 'ignore'
  >('match');

  // Match state
  const [selectedMatch, setSelectedMatch] = useState<SuggestedMatch | null>(null);

  // Manual expense search state
  const [expenseSearchKeyword, setExpenseSearchKeyword] = useState('');
  const [expenseSearchLoading, setExpenseSearchLoading] = useState(false);
  const [searchedExpenses, setSearchedExpenses] = useState<ExpenseSearchResult[]>([]);
  const [selectedManualExpense, setSelectedManualExpense] = useState<ExpenseSearchResult | null>(null);

  // Create expense state
  const [expenseCategory, setExpenseCategory] = useState<'Advertising' | 'COGS' | 'Operating'>(
    'Advertising'
  );
  const [expenseSubcategory, setExpenseSubcategory] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState(
    Math.abs(Number(bankTransaction.withdrawal || 0))
  );

  // Wallet state
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [walletAmount, setWalletAmount] = useState(
    Math.abs(Number(bankTransaction.withdrawal || 0))
  );

  // Adjustment state
  const [adjustmentType, setAdjustmentType] = useState<
    'bank_error' | 'timing_difference' | 'other'
  >('other');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');

  // Ignore state
  const [ignoreReason, setIgnoreReason] = useState('');

  // Common notes
  const [notes, setNotes] = useState('');

  // Load suggestions and wallets on mount
  useEffect(() => {
    if (open) {
      loadSuggestions();
      loadWallets();
    }
  }, [open, bankTransaction.id]);

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const result = await getSuggestedMatches(bankTransaction.id);
      if (result.success && result.suggestions) {
        // Group by entity_type
        const settlements = result.suggestions.filter((s) => s.entity_type === 'settlement');
        const expenses = result.suggestions.filter((s) => s.entity_type === 'expense');
        const walletEntries = result.suggestions.filter((s) => s.entity_type === 'wallet_topup');

        setSuggestions({ settlements, expenses, walletEntries });
      }
    } catch (error) {
      console.error('Load suggestions error:', error);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const loadWallets = async () => {
    try {
      const result = await getAvailableWallets();
      if (result.success && result.wallets) {
        setWallets(result.wallets);
      }
    } catch (error) {
      console.error('Load wallets error:', error);
    }
  };

  const handleSearchExpenses = async () => {
    setExpenseSearchLoading(true);
    try {
      const startDate = new Date(bankTransaction.txn_date);
      startDate.setDate(startDate.getDate() - 7); // -7 days
      const endDate = new Date(bankTransaction.txn_date);
      endDate.setDate(endDate.getDate() + 7); // +7 days

      const result = await searchExpenses(
        expenseSearchKeyword,
        startDate,
        endDate,
        Math.abs(txnAmount)
      );

      if (result.success && result.expenses) {
        setSearchedExpenses(result.expenses);
      } else {
        toast({
          variant: 'destructive',
          title: 'ค้นหาไม่สำเร็จ',
          description: result.error || 'ไม่สามารถค้นหา Expense ได้',
        });
      }
    } catch (error) {
      console.error('Search expenses error:', error);
    } finally {
      setExpenseSearchLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      let result: { success: boolean; error?: string } = { success: false };

      if (action === 'match') {
        if (selectedMatch) {
          // Match to suggested record - dispatch based on entity_type
          console.log('Matching to suggested record:', {
            entity_type: selectedMatch.entity_type,
            entity_id: selectedMatch.entity_id,
            description: selectedMatch.description,
            amount: selectedMatch.amount,
          });

          if (selectedMatch.entity_type === 'expense') {
            // Match to existing expense
            result = await matchBankTransactionToExpense(
              bankTransaction.id,
              selectedMatch.entity_id,
              notes || undefined
            );
          } else if (selectedMatch.entity_type === 'settlement') {
            // Match to settlement
            result = await matchBankTransactionToSettlement(
              bankTransaction.id,
              selectedMatch.entity_id,
              notes || undefined
            );
          } else if (selectedMatch.entity_type === 'wallet_topup') {
            // Match to existing wallet entry
            // Note: This may need a new function matchBankTransactionToWalletEntry()
            // For now, show error
            toast({
              variant: 'destructive',
              title: 'ยังไม่รองรับ',
              description: 'การจับคู่กับ Wallet Entry ที่มีอยู่แล้วยังไม่รองรับ กรุณาใช้ "Wallet Top-up" แทน',
            });
            setLoading(false);
            return;
          } else {
            // Unknown entity_type
            toast({
              variant: 'destructive',
              title: 'ประเภทไม่รู้จัก',
              description: `ไม่รู้จักประเภทรายการ: ${selectedMatch.entity_type}`,
            });
            setLoading(false);
            return;
          }
        } else if (selectedManualExpense) {
          // Match to manually selected expense
          console.log('Matching to manual expense:', {
            expense_id: selectedManualExpense.id,
            category: selectedManualExpense.category,
            description: selectedManualExpense.description,
            amount: selectedManualExpense.amount,
          });

          result = await matchBankTransactionToExpense(
            bankTransaction.id,
            selectedManualExpense.id,
            notes || undefined
          );
        } else {
          toast({
            variant: 'destructive',
            title: 'กรุณาเลือกรายการ',
            description: 'ต้องเลือกรายการที่ต้องการจับคู่',
          });
          setLoading(false);
          return;
        }
      } else if (action === 'create_expense') {
        // Create new expense
        if (!expenseDescription.trim()) {
          toast({
            variant: 'destructive',
            title: 'กรุณากรอกรายละเอียด',
            description: 'ต้องระบุรายละเอียดค่าใช้จ่าย',
          });
          setLoading(false);
          return;
        }

        result = await createExpenseFromBankTransaction(
          bankTransaction.id,
          expenseCategory,
          expenseDescription,
          expenseAmount,
          expenseSubcategory || undefined,
          notes || undefined
        );
      } else if (action === 'create_wallet_topup') {
        // Create wallet top-up
        if (!selectedWalletId) {
          toast({
            variant: 'destructive',
            title: 'กรุณาเลือก Wallet',
            description: 'ต้องเลือก Wallet สำหรับ Top-up',
          });
          setLoading(false);
          return;
        }

        result = await createWalletTopupFromBankTransaction(
          bankTransaction.id,
          selectedWalletId,
          walletAmount,
          notes || undefined
        );
      } else if (action === 'create_wallet_spend') {
        // Create wallet spend
        if (!selectedWalletId) {
          toast({
            variant: 'destructive',
            title: 'กรุณาเลือก Wallet',
            description: 'ต้องเลือก Wallet สำหรับ Spend',
          });
          setLoading(false);
          return;
        }

        result = await createWalletSpendFromBankTransaction(
          bankTransaction.id,
          selectedWalletId,
          walletAmount,
          notes || undefined
        );
      } else if (action === 'adjustment') {
        // Create adjustment
        if (!adjustmentNotes.trim()) {
          toast({
            variant: 'destructive',
            title: 'กรุณากรอกหมายเหตุ',
            description: 'ต้องระบุหมายเหตุสำหรับการปรับปรุงบัญชี',
          });
          setLoading(false);
          return;
        }

        result = await createAdjustmentForBankTransaction(
          bankTransaction.id,
          adjustmentType,
          adjustmentNotes
        );
      } else if (action === 'ignore') {
        // Ignore transaction
        if (!ignoreReason.trim()) {
          toast({
            variant: 'destructive',
            title: 'กรุณากรอกเหตุผล',
            description: 'ต้องระบุเหตุผลในการข้ามรายการนี้',
          });
          setLoading(false);
          return;
        }

        result = await ignoreBankTransaction(bankTransaction.id, ignoreReason);
      }

      if (result.success) {
        toast({
          title: 'สำเร็จ',
          description: 'จับคู่รายการเรียบร้อยแล้ว',
        });
        onSuccess();
        onOpenChange(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'เกิดข้อผิดพลาด',
          description: result.error || 'ไม่สามารถจับคู่รายการได้',
        });
      }
    } catch (error) {
      console.error('Confirm error:', error);
      toast({
        variant: 'destructive',
        title: 'เกิดข้อผิดพลาด',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  const txnAmount = Number(bankTransaction.deposit || 0) - Number(bankTransaction.withdrawal || 0);
  const isCashIn = txnAmount > 0;
  const totalSuggestions =
    suggestions.settlements.length + suggestions.expenses.length + suggestions.walletEntries.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>จับคู่รายการธนาคาร</DialogTitle>
          <DialogDescription>
            เลือกวิธีจับคู่หรือสร้างรายการใหม่สำหรับธุรกรรมนี้
          </DialogDescription>
        </DialogHeader>

        {/* Section 1: Transaction Details */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <h3 className="font-semibold mb-2">รายละเอียดธุรกรรม</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">วันที่:</span>{' '}
              {format(new Date(bankTransaction.txn_date), 'dd MMM yyyy', { locale: th })}
            </div>
            <div>
              <span className="text-muted-foreground">จำนวนเงิน:</span>{' '}
              <span className={isCashIn ? 'text-green-600' : 'text-red-600'}>
                {isCashIn ? '+' : '-'}
                {formatCurrency(Math.abs(txnAmount))}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">รายละเอียด:</span>{' '}
              {bankTransaction.description || 'ไม่ระบุ'}
            </div>
            {bankTransaction.channel && (
              <div>
                <span className="text-muted-foreground">ช่องทาง:</span> {bankTransaction.channel}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Suggested Matches */}
        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-2">
            รายการที่แนะนำ ({totalSuggestions > 0 ? totalSuggestions : 'ไม่มี'})
          </h3>
            {suggestionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Tabs defaultValue="all">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="all">ทั้งหมด</TabsTrigger>
                  <TabsTrigger value="settlements">
                    Settlements ({suggestions.settlements.length})
                  </TabsTrigger>
                  <TabsTrigger value="expenses">Expenses ({suggestions.expenses.length})</TabsTrigger>
                  <TabsTrigger value="wallets">Wallets ({suggestions.walletEntries.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="max-h-60 overflow-y-auto">
                  {[...suggestions.settlements, ...suggestions.expenses, ...suggestions.walletEntries].map(
                    (match) => (
                      <SuggestedMatchRow
                        key={match.entity_id}
                        match={match}
                        selected={selectedMatch?.entity_id === match.entity_id}
                        onSelect={() => {
                          setSelectedMatch(match);
                          setAction('match');
                        }}
                      />
                    )
                  )}
                </TabsContent>

                <TabsContent value="settlements" className="max-h-60 overflow-y-auto">
                  {suggestions.settlements.map((match) => (
                    <SuggestedMatchRow
                      key={match.entity_id}
                      match={match}
                      selected={selectedMatch?.entity_id === match.entity_id}
                      onSelect={() => {
                        setSelectedMatch(match);
                        setAction('match');
                      }}
                    />
                  ))}
                </TabsContent>

                <TabsContent value="expenses" className="max-h-60 overflow-y-auto">
                  {suggestions.expenses.map((match) => (
                    <SuggestedMatchRow
                      key={match.entity_id}
                      match={match}
                      selected={selectedMatch?.entity_id === match.entity_id}
                      onSelect={() => {
                        setSelectedMatch(match);
                        setAction('match');
                      }}
                    />
                  ))}
                </TabsContent>

                <TabsContent value="wallets" className="max-h-60 overflow-y-auto">
                  {suggestions.walletEntries.map((match) => (
                    <SuggestedMatchRow
                      key={match.entity_id}
                      match={match}
                      selected={selectedMatch?.entity_id === match.entity_id}
                      onSelect={() => {
                        setSelectedMatch(match);
                        setAction('match');
                      }}
                    />
                  ))}
                </TabsContent>
              </Tabs>
            )}
        </div>

        {/* Section 2.5: Manual Expense Picker (NEW) */}
        {action === 'match' && (
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">เลือก Expense ที่มีอยู่แล้ว</h3>
            <p className="text-sm text-muted-foreground mb-3">
              ค้นหา Expense ที่ต้องการจับคู่ (แม้ไม่มีในรายการแนะนำ)
            </p>

            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="ค้นหา (รายละเอียด, ประเภท)"
                  value={expenseSearchKeyword}
                  onChange={(e) => setExpenseSearchKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearchExpenses();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={handleSearchExpenses}
                  disabled={expenseSearchLoading}
                >
                  {expenseSearchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ค้นหา'}
                </Button>
              </div>

              {searchedExpenses.length > 0 && (
                <div className="border rounded max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">วันที่</th>
                        <th className="px-3 py-2 text-left">ประเภท</th>
                        <th className="px-3 py-2 text-left">รายละเอียด</th>
                        <th className="px-3 py-2 text-right">จำนวน</th>
                        <th className="px-3 py-2 text-center">สถานะ</th>
                        <th className="px-3 py-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchedExpenses.map((exp) => {
                        const amountDiff = Math.abs(exp.amount - Math.abs(txnAmount));
                        const showWarning = amountDiff > 0.01;

                        return (
                          <tr
                            key={exp.id}
                            className={`border-t hover:bg-muted/50 ${
                              selectedManualExpense?.id === exp.id ? 'bg-primary/5' : ''
                            }`}
                          >
                            <td className="px-3 py-2">
                              {format(new Date(exp.expense_date), 'dd MMM yyyy', { locale: th })}
                            </td>
                            <td className="px-3 py-2">{exp.category}</td>
                            <td className="px-3 py-2 max-w-xs truncate" title={exp.description}>
                              {exp.description}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatCurrency(exp.amount)}
                              {showWarning && (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  ±{formatCurrency(amountDiff)}
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {exp.is_reconciled ? (
                                <Badge variant="secondary">Matched</Badge>
                              ) : (
                                <Badge variant="outline">Available</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={exp.is_reconciled}
                                onClick={() => {
                                  setSelectedManualExpense(exp);
                                  setSelectedMatch(null); // Clear suggested match
                                  setAction('match');
                                }}
                              >
                                เลือก
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {searchedExpenses.length === 0 && expenseSearchKeyword && !expenseSearchLoading && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  ไม่พบ Expense ที่ตรงกับเงื่อนไข
                </p>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Manual Override */}
        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-4">การจัดการรายการนี้</h3>

          <RadioGroup value={action} onValueChange={(value: any) => setAction(value)}>
            <div className="space-y-4">
              {/* Option: Match */}
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="match" id="match" className="mt-1" />
                <Label htmlFor="match" className="flex-1 cursor-pointer">
                  <div className="font-medium">จับคู่กับรายการที่เลือก</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedMatch ? (
                      <span className="text-primary">
                        ✓ {selectedMatch.description} ({formatCurrency(selectedMatch.amount)})
                      </span>
                    ) : selectedManualExpense ? (
                      <span className="text-primary">
                        ✓ {selectedManualExpense.category} - {selectedManualExpense.description} (
                        {formatCurrency(selectedManualExpense.amount)})
                      </span>
                    ) : (
                      'กรุณาเลือกรายการจากด้านบน'
                    )}
                  </div>
                </Label>
              </div>

              {/* Option: Create Expense */}
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="create_expense" id="create_expense" className="mt-1" />
                <Label htmlFor="create_expense" className="flex-1 cursor-pointer">
                  <div className="font-medium">สร้าง Expense ใหม่</div>
                  {action === 'create_expense' && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label>ประเภท</Label>
                        <Select
                          value={expenseCategory}
                          onValueChange={(value: any) => setExpenseCategory(value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Advertising">Advertising</SelectItem>
                            <SelectItem value="COGS">COGS</SelectItem>
                            <SelectItem value="Operating">Operating</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Subcategory (ถ้ามี)</Label>
                        <Input
                          value={expenseSubcategory}
                          onChange={(e) => setExpenseSubcategory(e.target.value)}
                          placeholder="เช่น Facebook Ads, Google Ads"
                        />
                      </div>
                      <div>
                        <Label>รายละเอียด</Label>
                        <Input
                          value={expenseDescription}
                          onChange={(e) => setExpenseDescription(e.target.value)}
                          placeholder="ระบุรายละเอียดค่าใช้จ่าย"
                        />
                      </div>
                      <div>
                        <Label>จำนวนเงิน</Label>
                        <Input
                          type="number"
                          value={expenseAmount}
                          onChange={(e) => setExpenseAmount(Number(e.target.value))}
                          step="0.01"
                        />
                      </div>
                    </div>
                  )}
                </Label>
              </div>

              {/* Option: Wallet Top-up */}
              <div className="flex items-start space-x-3">
                <RadioGroupItem
                  value="create_wallet_topup"
                  id="create_wallet_topup"
                  className="mt-1"
                />
                <Label htmlFor="create_wallet_topup" className="flex-1 cursor-pointer">
                  <div className="font-medium">Wallet Top-up</div>
                  {action === 'create_wallet_topup' && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label>เลือก Wallet</Label>
                        <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือก Wallet" />
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
                      <div>
                        <Label>จำนวนเงิน</Label>
                        <Input
                          type="number"
                          value={walletAmount}
                          onChange={(e) => setWalletAmount(Number(e.target.value))}
                          step="0.01"
                        />
                      </div>
                    </div>
                  )}
                </Label>
              </div>

              {/* Option: Wallet Spend */}
              <div className="flex items-start space-x-3">
                <RadioGroupItem
                  value="create_wallet_spend"
                  id="create_wallet_spend"
                  className="mt-1"
                />
                <Label htmlFor="create_wallet_spend" className="flex-1 cursor-pointer">
                  <div className="font-medium">Wallet Spend</div>
                  {action === 'create_wallet_spend' && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label>เลือก Wallet</Label>
                        <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                          <SelectTrigger>
                            <SelectValue placeholder="เลือก Wallet" />
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
                      <div>
                        <Label>จำนวนเงิน</Label>
                        <Input
                          type="number"
                          value={walletAmount}
                          onChange={(e) => setWalletAmount(Number(e.target.value))}
                          step="0.01"
                        />
                      </div>
                    </div>
                  )}
                </Label>
              </div>

              {/* Option: Adjustment */}
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="adjustment" id="adjustment" className="mt-1" />
                <Label htmlFor="adjustment" className="flex-1 cursor-pointer">
                  <div className="font-medium">ปรับปรุงบัญชี</div>
                  {action === 'adjustment' && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label>ประเภท</Label>
                        <Select
                          value={adjustmentType}
                          onValueChange={(value: any) => setAdjustmentType(value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bank_error">Bank Error</SelectItem>
                            <SelectItem value="timing_difference">Timing Difference</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>หมายเหตุ (required)</Label>
                        <Textarea
                          value={adjustmentNotes}
                          onChange={(e) => setAdjustmentNotes(e.target.value)}
                          placeholder="ระบุเหตุผลการปรับปรุงบัญชี"
                          rows={3}
                        />
                      </div>
                    </div>
                  )}
                </Label>
              </div>

              {/* Option: Ignore */}
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="ignore" id="ignore" className="mt-1" />
                <Label htmlFor="ignore" className="flex-1 cursor-pointer">
                  <div className="font-medium">ข้ามรายการนี้</div>
                  {action === 'ignore' && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label>เหตุผล (required)</Label>
                        <Textarea
                          value={ignoreReason}
                          onChange={(e) => setIgnoreReason(e.target.value)}
                          placeholder="ระบุเหตุผลในการข้ามรายการนี้"
                          rows={3}
                        />
                      </div>
                    </div>
                  )}
                </Label>
              </div>
            </div>
          </RadioGroup>

          {/* Common notes */}
          <div className="mt-4">
            <Label>หมายเหตุเพิ่มเติม (ถ้ามี)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="หมายเหตุเพิ่มเติม"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            ยกเลิก
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังดำเนินการ...
              </>
            ) : (
              'ยืนยัน'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper component: Suggested Match Row
function SuggestedMatchRow({
  match,
  selected,
  onSelect,
}: {
  match: SuggestedMatch;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border'
      }`}
      onClick={onSelect}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{match.entity_type}</Badge>
          <span className="text-sm font-medium">{match.description}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {format(new Date(match.date), 'dd MMM yyyy', { locale: th })} • {match.match_reason}
        </div>
      </div>
      <div className="text-right">
        <div className="font-semibold">{formatCurrency(match.amount)}</div>
        <div className="text-xs text-muted-foreground">Score: {match.match_score}</div>
      </div>
      {selected && <CheckCircle2 className="h-5 w-5 text-primary ml-2" />}
    </div>
  );
}
