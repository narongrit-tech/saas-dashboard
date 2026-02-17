'use server'

import { createClient } from '@/lib/supabase/server'
import {
  CommissionReceipt,
  CreateCommissionInput,
  CommissionFilters,
  CommissionSummary,
  CommissionSourceWithAccount,
  CreateCommissionFromBankInput,
  CandidateBankTransaction,
  CandidateFilters,
} from '@/types/ceo-commission'
import type { BankAccount } from '@/types/bank'
import { formatInTimeZone } from 'date-fns-tz'

const BANGKOK_TZ = 'Asia/Bangkok'

/**
 * Validates commission input amounts
 */
function validateCommissionInput(input: CreateCommissionInput): {
  valid: boolean
  error?: string
} {
  // Validate gross amount
  if (input.gross_amount <= 0) {
    return { valid: false, error: 'จำนวน Commission ต้องมากกว่า 0' }
  }

  // Validate personal used amount
  if (input.personal_used_amount < 0) {
    return { valid: false, error: 'จำนวนที่ใช้ส่วนตัวต้องไม่ติดลบ' }
  }

  // Validate transferred amount
  if (input.transferred_to_company_amount < 0) {
    return { valid: false, error: 'จำนวนที่โอนให้บริษัทต้องไม่ติดลบ' }
  }

  // Validate balance equation (with 0.01 tolerance for floating point)
  const sum = input.personal_used_amount + input.transferred_to_company_amount
  const diff = Math.abs(input.gross_amount - sum)
  if (diff > 0.01) {
    return {
      valid: false,
      error: `ยอดรวมไม่ตรง: ${input.gross_amount} ≠ ${input.personal_used_amount} + ${input.transferred_to_company_amount}`,
    }
  }

  // Validate required fields
  if (!input.platform || input.platform.trim() === '') {
    return { valid: false, error: 'กรุณาระบุ Platform' }
  }

  if (!input.commission_date) {
    return { valid: false, error: 'กรุณาระบุวันที่รับ Commission' }
  }

  return { valid: true }
}

/**
 * Gets DIRECTOR_LOAN wallet ID for the current user
 */
async function getDirectorLoanWalletId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ wallet_id: string | null; error?: string }> {
  const { data, error } = await supabase
    .from('wallets')
    .select('id')
    .eq('wallet_type', 'DIRECTOR_LOAN')
    .eq('is_active', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found
      return {
        wallet_id: null,
        error: 'ไม่พบ DIRECTOR_LOAN wallet กรุณาสร้าง wallet ประเภท DIRECTOR_LOAN ก่อน',
      }
    }
    return { wallet_id: null, error: error.message }
  }

  return { wallet_id: data.id }
}

/**
 * Creates a commission receipt and optionally creates Director Loan entry in wallet_ledger
 */
export async function createCommissionReceipt(input: CreateCommissionInput): Promise<{
  success: boolean
  data?: CommissionReceipt
  error?: string
  warning?: string
}> {
  try {
    // Validate input
    const validation = validateCommissionInput(input)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'ไม่พบข้อมูล User กรุณา Login ใหม่' }
    }

    // Round amounts to 2 decimals
    const roundedInput = {
      ...input,
      gross_amount: Math.round(input.gross_amount * 100) / 100,
      personal_used_amount: Math.round(input.personal_used_amount * 100) / 100,
      transferred_to_company_amount:
        Math.round(input.transferred_to_company_amount * 100) / 100,
    }

    // Insert commission receipt
    const { data: receipt, error: insertError } = await supabase
      .from('ceo_commission_receipts')
      .insert({
        commission_date: roundedInput.commission_date,
        platform: roundedInput.platform.trim(),
        gross_amount: roundedInput.gross_amount,
        personal_used_amount: roundedInput.personal_used_amount,
        transferred_to_company_amount: roundedInput.transferred_to_company_amount,
        note: roundedInput.note?.trim() || null,
        reference: roundedInput.reference?.trim() || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      // Check for unique constraint violation (idempotency)
      if (insertError.code === '23505') {
        return {
          success: false,
          error: `มี Commission record สำหรับวันที่ ${roundedInput.commission_date} และ Platform "${roundedInput.platform}" อยู่แล้ว`,
        }
      }
      return { success: false, error: insertError.message }
    }

    // If no transfer to company, we're done
    if (roundedInput.transferred_to_company_amount === 0) {
      return { success: true, data: receipt }
    }

    // Get DIRECTOR_LOAN wallet ID
    const { wallet_id, error: walletError } = await getDirectorLoanWalletId(supabase)
    if (walletError || !wallet_id) {
      return {
        success: true,
        data: receipt,
        warning: `Commission record ถูกสร้างแล้ว แต่ไม่สามารถสร้าง Director Loan entry ได้: ${walletError}`,
      }
    }

    // Check idempotency: Has wallet_ledger entry already been created?
    const reference_id = `CEO_COMMISSION:${receipt.id}`
    const { data: existingEntry } = await supabase
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', reference_id)
      .single()

    if (existingEntry) {
      // Entry already exists, skip creation
      return { success: true, data: receipt }
    }

    // Create wallet_ledger entry (Director Loan = Cash IN to company)
    const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
      wallet_id: wallet_id,
      date: roundedInput.commission_date,
      entry_type: 'TOP_UP',
      direction: 'IN',
      amount: roundedInput.transferred_to_company_amount,
      source: 'MANUAL',
      reference_id: reference_id,
      note: `Commission โอนจาก CEO (${roundedInput.platform})`,
      created_by: user.id,
    })

    if (ledgerError) {
      return {
        success: true,
        data: receipt,
        warning: `Commission record ถูกสร้างแล้ว แต่ไม่สามารถสร้าง wallet_ledger entry ได้: ${ledgerError.message}`,
      }
    }

    return { success: true, data: receipt }
  } catch (error) {
    console.error('createCommissionReceipt error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Gets commission receipts with filters and pagination
 */
export async function getCommissionReceipts(filters: CommissionFilters): Promise<{
  success: boolean
  data?: CommissionReceipt[]
  total?: number
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Build query (with bank info for display)
    let query = supabase
      .from('ceo_commission_receipts')
      .select(
        `
        *,
        bank_transactions(
          id,
          description,
          bank_accounts(
            bank_name,
            account_number
          )
        )
      `,
        { count: 'exact' }
      )
      .order('commission_date', { ascending: false })
      .order('created_at', { ascending: false })

    // Apply filters
    if (filters.startDate) {
      query = query.gte('commission_date', filters.startDate)
    }
    if (filters.endDate) {
      query = query.lte('commission_date', filters.endDate)
    }
    if (filters.platform && filters.platform !== 'All') {
      query = query.eq('platform', filters.platform)
    }

    // Apply pagination
    const from = (filters.page - 1) * filters.perPage
    const to = from + filters.perPage - 1
    query = query.range(from, to)

    const { data, error, count } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data || [], total: count || 0 }
  } catch (error) {
    console.error('getCommissionReceipts error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Gets unique platforms from commission receipts (for filter dropdown)
 */
export async function getCommissionPlatforms(): Promise<{
  success: boolean
  data?: string[]
  error?: string
}> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ceo_commission_receipts')
      .select('platform')
      .order('platform')

    if (error) {
      return { success: false, error: error.message }
    }

    // Get unique platforms
    const platforms = [...new Set(data?.map((r) => r.platform) || [])]

    return { success: true, data: platforms }
  } catch (error) {
    console.error('getCommissionPlatforms error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Gets Director Loan balance (total transferred - total repaid)
 * Note: v1 does not have repayment feature, so balance = total transferred
 */
export async function getDirectorLoanTotal(): Promise<{
  success: boolean
  balance?: number
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Get DIRECTOR_LOAN wallet ID
    const { wallet_id, error: walletError } = await getDirectorLoanWalletId(supabase)
    if (walletError || !wallet_id) {
      // No wallet exists yet, balance is 0
      return { success: true, balance: 0 }
    }

    // Calculate balance from wallet_ledger
    const { data, error } = await supabase
      .from('wallet_ledger')
      .select('direction, amount')
      .eq('wallet_id', wallet_id)

    if (error) {
      return { success: false, error: error.message }
    }

    // Calculate: IN - OUT
    let balance = 0
    data?.forEach((entry) => {
      if (entry.direction === 'IN') {
        balance += entry.amount || 0
      } else if (entry.direction === 'OUT') {
        balance -= entry.amount || 0
      }
    })

    return { success: true, balance: Math.round(balance * 100) / 100 }
  } catch (error) {
    console.error('getDirectorLoanTotal error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Gets commission summary (totals)
 */
export async function getCommissionSummary(filters?: {
  startDate?: string
  endDate?: string
  platform?: string
}): Promise<{
  success: boolean
  data?: CommissionSummary
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Build query
    let query = supabase.from('ceo_commission_receipts').select('*')

    // Apply filters
    if (filters?.startDate) {
      query = query.gte('commission_date', filters.startDate)
    }
    if (filters?.endDate) {
      query = query.lte('commission_date', filters.endDate)
    }
    if (filters?.platform && filters.platform !== 'All') {
      query = query.eq('platform', filters.platform)
    }

    const { data, error } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    // Calculate totals
    const summary: CommissionSummary = {
      total_commissions: 0,
      total_personal_used: 0,
      total_transferred: 0,
      director_loan_balance: 0,
    }

    data?.forEach((receipt) => {
      summary.total_commissions += receipt.gross_amount || 0
      summary.total_personal_used += receipt.personal_used_amount || 0
      summary.total_transferred += receipt.transferred_to_company_amount || 0
    })

    // Get Director Loan balance (independent of filters)
    const { balance } = await getDirectorLoanTotal()
    summary.director_loan_balance = balance || 0

    // Round to 2 decimals
    summary.total_commissions = Math.round(summary.total_commissions * 100) / 100
    summary.total_personal_used = Math.round(summary.total_personal_used * 100) / 100
    summary.total_transferred = Math.round(summary.total_transferred * 100) / 100

    return { success: true, data: summary }
  } catch (error) {
    console.error('getCommissionSummary error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Exports commission receipts to CSV
 */
export async function exportCommissionReceipts(filters?: {
  startDate?: string
  endDate?: string
  platform?: string
}): Promise<{
  success: boolean
  csv?: string
  filename?: string
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Build query (no pagination for export, with bank info)
    let query = supabase
      .from('ceo_commission_receipts')
      .select(
        `
        *,
        bank_transactions(
          id,
          description,
          bank_accounts(
            bank_name,
            account_number
          )
        )
      `
      )
      .order('commission_date', { ascending: false })

    // Apply filters
    if (filters?.startDate) {
      query = query.gte('commission_date', filters.startDate)
    }
    if (filters?.endDate) {
      query = query.lte('commission_date', filters.endDate)
    }
    if (filters?.platform && filters.platform !== 'All') {
      query = query.eq('platform', filters.platform)
    }

    const { data, error } = await query

    if (error) {
      return { success: false, error: error.message }
    }

    if (!data || data.length === 0) {
      return { success: false, error: 'ไม่มีข้อมูลสำหรับ export' }
    }

    // Generate CSV with bank info
    const headers = [
      'วันที่รับ Commission',
      'Platform',
      'ยอดรวม (Gross)',
      'ใช้ส่วนตัว',
      'โอนให้บริษัท',
      'บัญชีธนาคาร',
      'Bank Txn Ref',
      'หมายเหตุ',
      'Reference',
      'สร้างเมื่อ',
    ]

    const rows = data.map((receipt: any) => {
      const bankTxn = receipt.bank_transactions
      const bankAccount = bankTxn?.bank_accounts
      const bankInfo = bankAccount
        ? `${bankAccount.bank_name} - ${bankAccount.account_number}`
        : 'Manual Entry'
      const bankTxnRef = bankTxn?.description || '-'

      return [
        receipt.commission_date,
        receipt.platform,
        receipt.gross_amount.toFixed(2),
        receipt.personal_used_amount.toFixed(2),
        receipt.transferred_to_company_amount.toFixed(2),
        bankInfo,
        bankTxnRef,
        receipt.note || '',
        receipt.reference || '',
        formatInTimeZone(new Date(receipt.created_at), BANGKOK_TZ, 'yyyy-MM-dd HH:mm:ss'),
      ]
    })

    // Build CSV string
    const csv = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    // Generate filename with Bangkok timezone
    const timestamp = formatInTimeZone(new Date(), BANGKOK_TZ, 'yyyyMMdd_HHmmss')
    const filename = `ceo_commission_${timestamp}.csv`

    return { success: true, csv, filename }
  } catch (error) {
    console.error('exportCommissionReceipts error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

// ============================================================================
// Commission Source Management (Bank Account Selection)
// ============================================================================

/**
 * Gets user's selected commission source bank accounts
 */
export async function getCommissionSources(): Promise<{
  success: boolean
  data?: CommissionSourceWithAccount[]
  error?: string
}> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ceo_commission_sources')
      .select(
        `
        id,
        created_by,
        bank_account_id,
        created_at,
        bank_accounts!inner(
          id,
          bank_name,
          account_number,
          account_type,
          currency,
          is_active
        )
      `
      )
      .order('created_at', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    // Transform to expected format
    const sources: CommissionSourceWithAccount[] = (data || []).map((row: any) => ({
      id: row.id,
      created_by: row.created_by,
      bank_account_id: row.bank_account_id,
      created_at: row.created_at,
      bank_account: row.bank_accounts,
    }))

    return { success: true, data: sources }
  } catch (error) {
    console.error('getCommissionSources error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Gets all user's bank accounts for source selection
 */
export async function getBankAccountsForSourceSelection(): Promise<{
  success: boolean
  data?: BankAccount[]
  error?: string
}> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('is_active', true)
      .order('bank_name', { ascending: true })
      .order('account_number', { ascending: true })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('getBankAccountsForSourceSelection error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Updates commission sources (bulk replace: delete all + insert selected)
 */
export async function updateCommissionSources(
  selectedBankAccountIds: string[]
): Promise<{
  success: boolean
  message?: string
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'ไม่พบข้อมูล User กรุณา Login ใหม่' }
    }

    // Delete all existing sources for this user
    const { error: deleteError } = await supabase
      .from('ceo_commission_sources')
      .delete()
      .eq('created_by', user.id)

    if (deleteError) {
      return { success: false, error: `ลบข้อมูลเดิมไม่สำเร็จ: ${deleteError.message}` }
    }

    // If no accounts selected, we're done
    if (selectedBankAccountIds.length === 0) {
      return { success: true, message: 'ยกเลิกการเลือกบัญชีทั้งหมดแล้ว' }
    }

    // Insert new selections
    const inserts = selectedBankAccountIds.map((bank_account_id) => ({
      bank_account_id,
      created_by: user.id,
    }))

    const { error: insertError } = await supabase
      .from('ceo_commission_sources')
      .insert(inserts)

    if (insertError) {
      return { success: false, error: `บันทึกไม่สำเร็จ: ${insertError.message}` }
    }

    return {
      success: true,
      message: `บันทึกแหล่งเงิน Commission สำเร็จ (${selectedBankAccountIds.length} บัญชี)`,
    }
  } catch (error) {
    console.error('updateCommissionSources error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

// ============================================================================
// Import from Bank Flow
// ============================================================================

/**
 * Gets candidate bank transactions for CEO commission declaration
 * Only shows transactions from user-selected source accounts
 */
export async function getCandidateBankTransactions(
  filters: CandidateFilters
): Promise<{
  success: boolean
  data?: CandidateBankTransaction[]
  total?: number
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Get user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'ไม่พบข้อมูล User กรุณา Login ใหม่' }
    }

    // Get user's selected commission source accounts
    const { data: sources, error: sourcesError } = await supabase
      .from('ceo_commission_sources')
      .select('bank_account_id')
      .eq('created_by', user.id)

    if (sourcesError) {
      return { success: false, error: `โหลดแหล่งเงินไม่สำเร็จ: ${sourcesError.message}` }
    }

    if (!sources || sources.length === 0) {
      return {
        success: false,
        error: 'กรุณาเลือกบัญชีธนาคารที่เป็นแหล่งเงิน Commission ก่อน',
      }
    }

    const sourceAccountIds = sources.map((s) => s.bank_account_id)

    // Build query for candidate transactions
    let query = supabase
      .from('bank_transactions')
      .select(
        `
        *,
        bank_accounts!inner(
          id,
          bank_name,
          account_number,
          account_type,
          currency
        )
      `
      )
      .in('bank_account_id', sourceAccountIds)
      .gt('deposit', 0) // Money IN only
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })

    // Apply date filters
    if (filters.startDate) {
      query = query.gte('txn_date', filters.startDate)
    }
    if (filters.endDate) {
      query = query.lte('txn_date', filters.endDate)
    }
    if (filters.bank_account_id && filters.bank_account_id !== 'All') {
      query = query.eq('bank_account_id', filters.bank_account_id)
    }

    const { data: transactions, error: txnError } = await query

    if (txnError) {
      return { success: false, error: txnError.message }
    }

    // Get already declared transaction IDs
    const { data: declared, error: declaredError } = await supabase
      .from('ceo_commission_receipts')
      .select('bank_transaction_id')
      .eq('created_by', user.id)
      .not('bank_transaction_id', 'is', null)

    if (declaredError) {
      return {
        success: false,
        error: `ตรวจสอบรายการที่ declare แล้วไม่สำเร็จ: ${declaredError.message}`,
      }
    }

    const declaredIds = new Set(declared?.map((d) => d.bank_transaction_id) || [])

    // Filter out already declared transactions
    const candidates: CandidateBankTransaction[] = (transactions || [])
      .filter((txn) => !declaredIds.has(txn.id))
      .map((txn: any) => ({
        ...txn,
        bank_account: txn.bank_accounts,
      }))

    return { success: true, data: candidates, total: candidates.length }
  } catch (error) {
    console.error('getCandidateBankTransactions error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}

/**
 * Creates CEO commission receipt from bank transaction with idempotency
 * Auto-creates Director Loan wallet TOP_UP if transferred_to_company_amount > 0
 */
export async function createCommissionFromBankTransaction(
  input: CreateCommissionFromBankInput
): Promise<{
  success: boolean
  data?: CommissionReceipt
  error?: string
  warning?: string
}> {
  try {
    // Validate input (reuse existing validation)
    const validation = validateCommissionInput({
      ...input,
      bank_transaction_id: input.bank_transaction_id,
    })
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'ไม่พบข้อมูล User กรุณา Login ใหม่' }
    }

    // Verify bank transaction exists and belongs to user
    const { data: bankTxn, error: bankTxnError } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('id', input.bank_transaction_id)
      .eq('created_by', user.id)
      .single()

    if (bankTxnError || !bankTxn) {
      return { success: false, error: 'ไม่พบรายการธนาคารนี้หรือคุณไม่มีสิทธิ์เข้าถึง' }
    }

    // Verify bank account is in user's commission sources
    const { data: sourceCheck, error: sourceCheckError } = await supabase
      .from('ceo_commission_sources')
      .select('id')
      .eq('created_by', user.id)
      .eq('bank_account_id', bankTxn.bank_account_id)
      .single()

    if (sourceCheckError || !sourceCheck) {
      return {
        success: false,
        error: 'บัญชีธนาคารนี้ไม่ได้ถูกเลือกเป็นแหล่งเงิน Commission',
      }
    }

    // Round amounts
    const roundedInput = {
      ...input,
      gross_amount: Math.round(input.gross_amount * 100) / 100,
      personal_used_amount: Math.round(input.personal_used_amount * 100) / 100,
      transferred_to_company_amount:
        Math.round(input.transferred_to_company_amount * 100) / 100,
    }

    // Insert commission receipt (idempotency enforced by unique constraint)
    const { data: receipt, error: insertError } = await supabase
      .from('ceo_commission_receipts')
      .insert({
        commission_date: roundedInput.commission_date,
        platform: roundedInput.platform.trim(),
        gross_amount: roundedInput.gross_amount,
        personal_used_amount: roundedInput.personal_used_amount,
        transferred_to_company_amount: roundedInput.transferred_to_company_amount,
        note: roundedInput.note?.trim() || null,
        reference: roundedInput.reference?.trim() || null,
        bank_transaction_id: roundedInput.bank_transaction_id,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      // Check for unique constraint violation (idempotency)
      if (insertError.code === '23505') {
        if (insertError.message.includes('bank_txn_unique')) {
          return {
            success: false,
            error: 'รายการธนาคารนี้ถูก declare เป็น Commission ไปแล้ว',
          }
        }
        return {
          success: false,
          error: `มี Commission record สำหรับวันที่ ${roundedInput.commission_date} และ Platform "${roundedInput.platform}" อยู่แล้ว`,
        }
      }
      return { success: false, error: insertError.message }
    }

    // If no transfer to company, we're done
    if (roundedInput.transferred_to_company_amount === 0) {
      return { success: true, data: receipt }
    }

    // Get DIRECTOR_LOAN wallet ID
    const { wallet_id, error: walletError } = await getDirectorLoanWalletId(supabase)
    if (walletError || !wallet_id) {
      return {
        success: true,
        data: receipt,
        warning: `Commission record ถูกสร้างแล้ว แต่ไม่สามารถสร้าง Director Loan entry ได้: ${walletError}`,
      }
    }

    // Check idempotency: Has wallet_ledger entry already been created?
    const reference_id = `CEO_COMMISSION:${receipt.id}`
    const { data: existingEntry } = await supabase
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', reference_id)
      .single()

    if (existingEntry) {
      // Entry already exists, skip creation
      return { success: true, data: receipt }
    }

    // Create wallet_ledger entry (Director Loan = Cash IN to company)
    const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
      wallet_id: wallet_id,
      date: roundedInput.commission_date,
      entry_type: 'TOP_UP',
      direction: 'IN',
      amount: roundedInput.transferred_to_company_amount,
      source: 'MANUAL',
      reference_id: reference_id,
      note: `Commission โอนจาก CEO (${roundedInput.platform}) - Bank Txn: ${bankTxn.description || 'N/A'}`,
      created_by: user.id,
    })

    if (ledgerError) {
      return {
        success: true,
        data: receipt,
        warning: `Commission record ถูกสร้างแล้ว แต่ไม่สามารถสร้าง wallet_ledger entry ได้: ${ledgerError.message}`,
      }
    }

    return { success: true, data: receipt }
  } catch (error) {
    console.error('createCommissionFromBankTransaction error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
    }
  }
}
