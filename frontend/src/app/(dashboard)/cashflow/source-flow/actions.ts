'use server'

import { createClient } from '@/lib/supabase/server'
import { toCSVRow } from '@/lib/csv'
import { buildSankeyPayload } from '@/lib/sankey-transformer'
import type {
  RawTxnForSankey,
  SankeyPayload,
  SankeyTxnRow,
  InflowSource,
  OutflowCategory,
  CashflowNodeClassification,
} from '@/types/cashflow-sankey'
import { INFLOW_SOURCE_LABELS, OUTFLOW_CATEGORY_LABELS } from '@/types/cashflow-sankey'

// ============================================================================
// Internal helpers
// ============================================================================

interface BankAccountInfo {
  id:             string
  bank_name:      string
  account_number: string
}

/** Chunk an array into slices of at most `size` elements. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/** Fetch all bank_accounts owned by the user (active and inactive). */
async function fetchBankAccounts(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ accounts: BankAccountInfo[]; error?: string }> {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, account_number')
    .order('bank_name', { ascending: true })

  if (error) return { accounts: [], error: error.message }
  return { accounts: (data ?? []) as BankAccountInfo[] }
}

/**
 * Paginated fetch of all bank_transactions in the given date range.
 * Optionally filtered to a single bank_account_id.
 * Excludes rows where both deposit and withdrawal are 0.
 */
async function fetchAllTransactions(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  from: string,
  to: string,
  bankAccountId?: string,
): Promise<{ rows: Array<{ id: string; bank_account_id: string; deposit: number; withdrawal: number; txn_date: string; description: string | null }>; error?: string }> {
  const PAGE_SIZE = 1000
  const allRows: Array<{ id: string; bank_account_id: string; deposit: number; withdrawal: number; txn_date: string; description: string | null }> = []
  let page = 0

  while (true) {
    let query = supabase
      .from('bank_transactions')
      .select('id, bank_account_id, deposit, withdrawal, txn_date, description')
      .gte('txn_date', from)
      .lte('txn_date', to)
      .order('txn_date', { ascending: true })
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)

    // Exclude rows where both amounts are zero (use OR: deposit>0 OR withdrawal>0)
    query = query.or('deposit.gt.0,withdrawal.gt.0')

    const { data, error } = await query
    if (error) return { rows: [], error: error.message }

    const batch = (data ?? []) as Array<{ id: string; bank_account_id: string; deposit: number; withdrawal: number; txn_date: string; description: string | null }>
    allRows.push(...batch)

    if (batch.length < PAGE_SIZE) break
    page++
  }

  return { rows: allRows }
}

/**
 * Batch-fetch cashflow_node_classifications for a set of transaction IDs.
 * Returns a map keyed by bank_transaction_id.
 */
async function fetchClassifications(
  supabase: ReturnType<typeof createClient>,
  txnIds: string[],
): Promise<Map<string, Pick<CashflowNodeClassification, 'inflow_source' | 'outflow_category' | 'outflow_sub' | 'note'>>> {
  const classMap = new Map<string, Pick<CashflowNodeClassification, 'inflow_source' | 'outflow_category' | 'outflow_sub' | 'note'>>()
  if (txnIds.length === 0) return classMap

  const CHUNK_SIZE = 200
  for (const chunk of chunkArray(txnIds, CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('cashflow_node_classifications')
      .select('bank_transaction_id, inflow_source, outflow_category, outflow_sub, note')
      .in('bank_transaction_id', chunk)

    if (error) {
      console.error('[fetchClassifications] error:', error.message)
      continue
    }

    for (const row of data ?? []) {
      classMap.set(row.bank_transaction_id as string, {
        inflow_source:    (row.inflow_source    as InflowSource    | null) ?? null,
        outflow_category: (row.outflow_category as OutflowCategory | null) ?? null,
        outflow_sub:      (row.outflow_sub      as string          | null) ?? null,
        note:             (row.note             as string          | null) ?? null,
      })
    }
  }

  return classMap
}

// ============================================================================
// getSankeyData
// ============================================================================

export async function getSankeyData(params: {
  from: string
  to: string
  bankAccountId?: string
}): Promise<{ success: boolean; data?: SankeyPayload; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { from, to, bankAccountId } = params

    // 1. Fetch bank accounts for this user
    const { accounts, error: acctError } = await fetchBankAccounts(supabase, user.id)
    if (acctError) return { success: false, error: `ดึงข้อมูล bank accounts ล้มเหลว: ${acctError}` }

    // 2. Paginated fetch of all transactions in range
    const { rows: rawRows, error: txnError } = await fetchAllTransactions(
      supabase, user.id, from, to, bankAccountId,
    )
    if (txnError) return { success: false, error: `ดึงข้อมูล transactions ล้มเหลว: ${txnError}` }

    // 3. Batch-fetch classifications for all transaction IDs
    const txnIds = rawRows.map(r => r.id)
    const classMap = await fetchClassifications(supabase, txnIds)

    // 4. Merge into RawTxnForSankey[]
    const transactions: RawTxnForSankey[] = rawRows.map(r => {
      const cls = classMap.get(r.id)
      return {
        id:               r.id,
        bank_account_id:  r.bank_account_id,
        deposit:          Math.max(0, r.deposit  || 0),
        withdrawal:       Math.max(0, r.withdrawal || 0),
        txn_date:         r.txn_date,
        description:      r.description ?? null,
        inflow_source:    cls?.inflow_source    ?? null,
        outflow_category: cls?.outflow_category ?? null,
        outflow_sub:      cls?.outflow_sub      ?? null,
      }
    })

    // 5. Build Sankey payload
    const payload = buildSankeyPayload(transactions, accounts, from, to)

    return { success: true, data: payload }
  } catch (error) {
    console.error('[getSankeyData] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// getSankeyDrilldown
// ============================================================================

export async function getSankeyDrilldown(params: {
  txnIds: string[]
  bankAccountId?: string
}): Promise<{ success: boolean; data?: SankeyTxnRow[]; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { txnIds } = params
    if (!txnIds || txnIds.length === 0) return { success: true, data: [] }

    // 1. Fetch the bank_transactions for given IDs (in chunks of 200)
    const CHUNK_SIZE = 200
    const txnRows: Array<{ id: string; bank_account_id: string; deposit: number; withdrawal: number; txn_date: string; description: string | null }> = []

    for (const chunk of chunkArray(txnIds, CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('id, bank_account_id, deposit, withdrawal, txn_date, description')
        .in('id', chunk)

      if (error) throw new Error(`ดึงข้อมูล transactions ล้มเหลว: ${error.message}`)
      txnRows.push(...((data ?? []) as typeof txnRows))
    }

    // 2. Fetch bank_accounts for user (to resolve bank_name)
    const { accounts, error: acctError } = await fetchBankAccounts(supabase, user.id)
    if (acctError) throw new Error(`ดึงข้อมูล bank accounts ล้มเหลว: ${acctError}`)
    const acctMap = new Map(accounts.map(a => [a.id, a]))

    // 3. Fetch classifications for these IDs
    const fetchedIds = txnRows.map(r => r.id)
    const classMap = await fetchClassifications(supabase, fetchedIds)

    // 4. Merge into SankeyTxnRow[]
    const result: SankeyTxnRow[] = txnRows.map(r => {
      const cls   = classMap.get(r.id)
      const acct  = acctMap.get(r.bank_account_id)
      return {
        id:               r.id,
        txn_date:         r.txn_date,
        description:      r.description ?? null,
        deposit:          Math.max(0, r.deposit   || 0),
        withdrawal:       Math.max(0, r.withdrawal || 0),
        bank_account_id:  r.bank_account_id,
        bank_name:        acct?.bank_name ?? r.bank_account_id,
        inflow_source:    cls?.inflow_source    ?? null,
        outflow_category: cls?.outflow_category ?? null,
        outflow_sub:      cls?.outflow_sub      ?? null,
        note:             cls?.note             ?? null,
      }
    })

    return { success: true, data: result }
  } catch (error) {
    console.error('[getSankeyDrilldown] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// upsertNodeClassification
// ============================================================================

export async function upsertNodeClassification(params: {
  bank_transaction_id: string
  inflow_source?:    InflowSource    | null
  outflow_category?: OutflowCategory | null
  outflow_sub?:      string          | null
  note?:             string          | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { bank_transaction_id, inflow_source, outflow_category, outflow_sub, note } = params

    // Validate: cannot set both inflow_source and outflow_category simultaneously
    if (inflow_source && outflow_category) {
      return { success: false, error: 'ไม่สามารถตั้งค่า inflow_source และ outflow_category พร้อมกันได้' }
    }

    // If both are null/undefined: delete any existing classification for this transaction
    if (!inflow_source && !outflow_category) {
      const { error: delError } = await supabase
        .from('cashflow_node_classifications')
        .delete()
        .eq('bank_transaction_id', bank_transaction_id)
        .eq('created_by', user.id)

      if (delError) return { success: false, error: `ลบ classification ล้มเหลว: ${delError.message}` }
      return { success: true }
    }

    // Upsert the classification row
    const { error: upsertError } = await supabase
      .from('cashflow_node_classifications')
      .upsert(
        {
          bank_transaction_id,
          inflow_source:    inflow_source    ?? null,
          outflow_category: outflow_category ?? null,
          outflow_sub:      outflow_sub      ?? null,
          note:             note             ?? null,
          created_by:       user.id,
        },
        { onConflict: 'bank_transaction_id,created_by' },
      )

    if (upsertError) return { success: false, error: `บันทึก classification ล้มเหลว: ${upsertError.message}` }
    return { success: true }
  } catch (error) {
    console.error('[upsertNodeClassification] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}

// ============================================================================
// exportSankeyCSV
// ============================================================================

export async function exportSankeyCSV(params: {
  from: string
  to: string
  bankAccountId?: string
}): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { from, to, bankAccountId } = params

    // 1. Fetch all transactions in range
    const { rows: rawRows, error: txnError } = await fetchAllTransactions(
      supabase, user.id, from, to, bankAccountId,
    )
    if (txnError) return { success: false, error: `ดึงข้อมูล transactions ล้มเหลว: ${txnError}` }

    // 2. Fetch bank accounts for name resolution
    const { accounts, error: acctError } = await fetchBankAccounts(supabase, user.id)
    if (acctError) return { success: false, error: `ดึงข้อมูล bank accounts ล้มเหลว: ${acctError}` }
    const acctMap = new Map(accounts.map(a => [a.id, a]))

    // 3. Batch-fetch classifications
    const txnIds = rawRows.map(r => r.id)
    const classMap = await fetchClassifications(supabase, txnIds)

    // 4. Build CSV rows
    const headers = [
      'Date',
      'Bank Account',
      'Description',
      'Deposit',
      'Withdrawal',
      'Direction',
      'Source/Category',
      'Sub Label',
      'Note',
    ]

    const lines: string[] = [toCSVRow(headers)]

    for (const r of rawRows) {
      const cls  = classMap.get(r.id)
      const acct = acctMap.get(r.bank_account_id)
      const acctLabel = acct
        ? `${acct.bank_name} (...${acct.account_number?.slice(-4) ?? '????'})`
        : r.bank_account_id

      const deposit    = Math.max(0, r.deposit    || 0)
      const withdrawal = Math.max(0, r.withdrawal || 0)

      let direction    = ''
      let sourceOrCat  = ''

      if (deposit > 0 && withdrawal === 0) {
        direction   = 'Inflow'
        sourceOrCat = cls?.inflow_source
          ? INFLOW_SOURCE_LABELS[cls.inflow_source] ?? cls.inflow_source
          : 'Unclassified Inflow'
      } else if (withdrawal > 0 && deposit === 0) {
        direction   = 'Outflow'
        sourceOrCat = cls?.outflow_category
          ? OUTFLOW_CATEGORY_LABELS[cls.outflow_category] ?? cls.outflow_category
          : 'Unclassified Outflow'
      } else if (deposit > 0 && withdrawal > 0) {
        direction   = 'Both'
        sourceOrCat = ''
      }

      lines.push(toCSVRow([
        r.txn_date,
        acctLabel,
        r.description ?? '',
        deposit    || '',
        withdrawal || '',
        direction,
        sourceOrCat,
        cls?.outflow_sub ?? '',
        cls?.note        ?? '',
      ]))
    }

    const csv      = lines.join('\n')
    const filename = `source-flow-${from}-${to}.csv`

    return { success: true, csv, filename }
  } catch (error) {
    console.error('[exportSankeyCSV] error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด' }
  }
}
