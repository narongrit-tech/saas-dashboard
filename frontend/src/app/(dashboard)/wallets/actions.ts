'use server'

import { createClient } from '@/lib/supabase/server'
import {
  CreateLedgerInput,
  UpdateLedgerInput,
  WalletType,
  LedgerSource,
} from '@/types/wallets'
import { formatBangkok, getBangkokNow } from '@/lib/bangkok-time'

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

/**
 * CRITICAL BUSINESS RULES FOR WALLET LEDGER
 *
 * 1. ADS Wallet Rules:
 *    - SPEND entries MUST be source=IMPORTED (from Ads Report ONLY)
 *    - SPEND entries MUST have import_batch_id
 *    - TOP_UP entries MUST be source=MANUAL
 *    - Manual SPEND creation is BLOCKED
 *
 * 2. SUBSCRIPTION Wallet Rules:
 *    - SPEND entries CAN be source=MANUAL
 *    - TOP_UP entries MUST be source=MANUAL
 *
 * 3. General Rules:
 *    - TOP_UP → direction=IN
 *    - SPEND → direction=OUT
 *    - REFUND → direction=IN
 *    - ADJUSTMENT → direction depends on context (IN or OUT)
 */

/**
 * Validate wallet ledger entry against business rules
 * @param walletType - Type of wallet (ADS, SUBSCRIPTION, OTHER)
 * @param entryType - Type of entry (TOP_UP, SPEND, REFUND, ADJUSTMENT)
 * @param direction - Direction of entry (IN, OUT)
 * @param source - Source of entry (MANUAL, IMPORTED)
 * @param importBatchId - Import batch ID (required for IMPORTED source)
 * @returns Validation result
 */
function validateLedgerEntry(
  walletType: WalletType,
  entryType: string,
  direction: string,
  source: LedgerSource,
  importBatchId?: string | null
): { valid: boolean; error?: string } {
  // Rule 1: Validate entry_type and direction combinations
  if (entryType === 'TOP_UP' && direction !== 'IN') {
    return {
      valid: false,
      error: 'TOP_UP ต้องเป็น direction=IN เท่านั้น (เพิ่มเงินเข้า wallet)',
    }
  }

  if (entryType === 'SPEND' && direction !== 'OUT') {
    return {
      valid: false,
      error: 'SPEND ต้องเป็น direction=OUT เท่านั้น (เงินออกจาก wallet)',
    }
  }

  if (entryType === 'REFUND' && direction !== 'IN') {
    return {
      valid: false,
      error: 'REFUND ต้องเป็น direction=IN เท่านั้น (เงินคืนเข้า wallet)',
    }
  }

  // Rule 2: ADS Wallet specific rules
  if (walletType === 'ADS') {
    // CRITICAL: ADS Wallet SPEND must be IMPORTED only
    if (entryType === 'SPEND' && source === 'MANUAL') {
      return {
        valid: false,
        error:
          '❌ ห้ามสร้าง SPEND แบบ Manual สำหรับ ADS Wallet - ค่า Ad Spend ต้องมาจาก Ads Report เท่านั้น (IMPORTED)',
      }
    }

    // If SPEND and IMPORTED, must have import_batch_id
    if (entryType === 'SPEND' && source === 'IMPORTED' && !importBatchId) {
      return {
        valid: false,
        error: 'SPEND จาก Ads Report ต้องมี import_batch_id',
      }
    }

    // TOP_UP must be MANUAL
    if (entryType === 'TOP_UP' && source !== 'MANUAL') {
      return {
        valid: false,
        error: 'TOP_UP สำหรับ ADS Wallet ต้องเป็น MANUAL เท่านั้น',
      }
    }
  }

  // Rule 3: General - TOP_UP should be MANUAL (across all wallet types)
  if (entryType === 'TOP_UP' && source !== 'MANUAL') {
    return {
      valid: false,
      error: 'TOP_UP ควรเป็น MANUAL (การเติมเงินโดยผู้ใช้)',
    }
  }

  // Rule 4: If source is IMPORTED, must have import_batch_id
  if (source === 'IMPORTED' && !importBatchId) {
    return {
      valid: false,
      error: 'รายการที่ import ต้องมี import_batch_id',
    }
  }

  return { valid: true }
}

/**
 * Create wallet ledger entry
 * Enforces strict business rules for ADS vs SUBSCRIPTION wallets
 */
export async function createWalletLedgerEntry(
  input: CreateLedgerInput
): Promise<ActionResult> {
  try {
    // 1. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Validate input
    if (!input.wallet_id) {
      return { success: false, error: 'กรุณาเลือก wallet' }
    }

    if (!input.date) {
      return { success: false, error: 'กรุณาระบุวันที่' }
    }

    if (input.amount <= 0) {
      return { success: false, error: 'จำนวนเงินต้องมากกว่า 0' }
    }

    // 3. Get wallet info to check wallet_type
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, name, wallet_type')
      .eq('id', input.wallet_id)
      .single()

    if (walletError || !wallet) {
      return { success: false, error: 'ไม่พบ wallet ที่เลือก' }
    }

    // 4. Apply business rules validation
    // Manual entries always have source='MANUAL'
    const source: LedgerSource = 'MANUAL'
    const validation = validateLedgerEntry(
      wallet.wallet_type as WalletType,
      input.entry_type,
      input.direction,
      source,
      null // No import_batch_id for manual entries
    )

    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // 5. Round amount to 2 decimal places (currency precision)
    const roundedAmount = Math.round(input.amount * 100) / 100

    // 6. Insert ledger entry
    const { data: insertedEntry, error: insertError } = await supabase
      .from('wallet_ledger')
      .insert({
        wallet_id: input.wallet_id,
        date: input.date,
        entry_type: input.entry_type,
        direction: input.direction,
        amount: roundedAmount,
        source: source,
        reference_id: input.reference_id || null,
        note: input.note || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting ledger entry:', insertError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${insertError.message}` }
    }

    return { success: true, data: insertedEntry }
  } catch (error) {
    console.error('Unexpected error in createWalletLedgerEntry:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Update wallet ledger entry
 * Cannot change wallet_id or source (immutable)
 */
export async function updateWalletLedgerEntry(
  entryId: string,
  input: UpdateLedgerInput
): Promise<ActionResult> {
  try {
    // 1. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Validate input
    if (!input.date) {
      return { success: false, error: 'กรุณาระบุวันที่' }
    }

    if (input.amount <= 0) {
      return { success: false, error: 'จำนวนเงินต้องมากกว่า 0' }
    }

    // 3. Get existing entry to check ownership and wallet type
    const { data: existing, error: fetchError } = await supabase
      .from('wallet_ledger')
      .select('id, wallet_id, source, import_batch_id, created_by, wallets(wallet_type)')
      .eq('id', entryId)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'ไม่พบรายการที่ต้องการแก้ไข' }
    }

    // Check ownership
    if (existing.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' }
    }

    // Prevent editing imported entries (they should come from reports only)
    if (existing.source === 'IMPORTED') {
      return {
        success: false,
        error: 'ไม่สามารถแก้ไขรายการที่ import มาได้ - ต้องแก้ไขจาก source file แล้ว re-import',
      }
    }

    // 4. Validate against business rules
    const walletType = (existing.wallets as any)?.wallet_type as WalletType
    const validation = validateLedgerEntry(
      walletType,
      input.entry_type,
      input.direction,
      existing.source as LedgerSource,
      existing.import_batch_id
    )

    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // 5. Round amount
    const roundedAmount = Math.round(input.amount * 100) / 100

    // 6. Update entry
    const { data: updatedEntry, error: updateError } = await supabase
      .from('wallet_ledger')
      .update({
        date: input.date,
        entry_type: input.entry_type,
        direction: input.direction,
        amount: roundedAmount,
        reference_id: input.reference_id || null,
        note: input.note || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating ledger entry:', updateError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${updateError.message}` }
    }

    return { success: true, data: updatedEntry }
  } catch (error) {
    console.error('Unexpected error in updateWalletLedgerEntry:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Delete wallet ledger entry
 * Cannot delete imported entries (source=IMPORTED)
 */
export async function deleteWalletLedgerEntry(entryId: string): Promise<ActionResult> {
  try {
    // 1. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Get existing entry to check ownership and source
    const { data: existing, error: fetchError } = await supabase
      .from('wallet_ledger')
      .select('id, source, created_by')
      .eq('id', entryId)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'ไม่พบรายการที่ต้องการลบ' }
    }

    // Check ownership
    if (existing.created_by !== user.id) {
      return { success: false, error: 'คุณไม่มีสิทธิ์ลบรายการนี้' }
    }

    // Prevent deleting imported entries
    if (existing.source === 'IMPORTED') {
      return {
        success: false,
        error: 'ไม่สามารถลบรายการที่ import มาได้ - ข้อมูลจาก report เท่านั้น',
      }
    }

    // 3. Hard delete
    const { error: deleteError } = await supabase
      .from('wallet_ledger')
      .delete()
      .eq('id', entryId)

    if (deleteError) {
      console.error('Error deleting ledger entry:', deleteError)
      return { success: false, error: `เกิดข้อผิดพลาด: ${deleteError.message}` }
    }

    return { success: true, data: { deletedId: entryId } }
  } catch (error) {
    console.error('Unexpected error in deleteWalletLedgerEntry:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

/**
 * Export wallet ledger to CSV
 * Respects filters (wallet_id, date range, entry_type, source)
 */
interface ExportFilters {
  wallet_id: string
  startDate?: string
  endDate?: string
  entry_type?: string
  source?: string
}

interface ExportResult {
  success: boolean
  error?: string
  csv?: string
  filename?: string
}

export async function exportWalletLedger(filters: ExportFilters): Promise<ExportResult> {
  try {
    // 1. Authenticate user
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Get wallet info
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('name')
      .eq('id', filters.wallet_id)
      .single()

    if (walletError || !wallet) {
      return { success: false, error: 'ไม่พบ wallet' }
    }

    // 3. Build query with filters
    let query = supabase
      .from('wallet_ledger')
      .select('*')
      .eq('wallet_id', filters.wallet_id)
      .order('date', { ascending: false })

    // Apply date filters
    if (filters.startDate) {
      query = query.gte('date', filters.startDate)
    }

    if (filters.endDate) {
      query = query.lte('date', filters.endDate)
    }

    // Apply entry_type filter
    if (filters.entry_type && filters.entry_type !== 'All') {
      query = query.eq('entry_type', filters.entry_type)
    }

    // Apply source filter
    if (filters.source && filters.source !== 'All') {
      query = query.eq('source', filters.source)
    }

    // Limit to prevent memory issues
    query = query.limit(10000)

    const { data: entries, error: fetchError } = await query

    if (fetchError) {
      console.error('Error fetching entries for export:', fetchError)
      return { success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' }
    }

    if (!entries || entries.length === 0) {
      return { success: false, error: 'ไม่พบข้อมูลที่จะ export' }
    }

    // 4. Generate CSV content
    const headers = [
      'Date',
      'Entry Type',
      'Direction',
      'Amount',
      'Source',
      'Reference ID',
      'Note',
      'Created At',
    ]

    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) return ''
      const str = String(value)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const rows = entries.map((entry) => {
      return [
        escapeCSV(entry.date),
        escapeCSV(entry.entry_type),
        escapeCSV(entry.direction),
        escapeCSV(entry.amount),
        escapeCSV(entry.source),
        escapeCSV(entry.reference_id || ''),
        escapeCSV(entry.note || ''),
        escapeCSV(entry.created_at),
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')

    // 5. Generate filename with Bangkok timezone
    const now = getBangkokNow()
    const dateStr = formatBangkok(now, 'yyyyMMdd-HHmmss')
    const walletName = wallet.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const filename = `wallet-${walletName}-${dateStr}.csv`

    return {
      success: true,
      csv: csvContent,
      filename,
    }
  } catch (error) {
    console.error('Unexpected error in exportWalletLedger:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}
