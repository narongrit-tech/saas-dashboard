import path from 'node:path'
import fs from 'node:fs'
import crypto from 'crypto'
import { config } from 'dotenv'
import { createServiceClient } from '../src/lib/supabase/service'
import { parseShopeeBalanceXLSX, ShopeeBalanceTransaction } from '../src/lib/importers/shopee-balance-parser'

config({ path: path.resolve(__dirname, '../.env.local') })

const USER_ID  = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
const RAW_DIR  = path.resolve(__dirname, '../../Raw. Data Nimitt Mind')
const FILE     = path.join(RAW_DIR, 'Order/Shopee/Settle/my_balance_transaction_report.shopee.20260101_20260525.xlsx')
const BATCH_SZ = 200

// Same hash algorithm as shopee-wallet-parser.ts (FNV-1a + djb2 + length)
function makeTxnHash(occurredAt: string, txType: string, direction: string, amount: number, refId: string | null, balanceAfter: number | null): string {
  const input = ['shopee', occurredAt, txType, direction, amount.toFixed(2), refId ?? '', balanceAfter != null ? balanceAfter.toFixed(2) : ''].join('|')

  let h1 = 0x811c9dc5
  for (let i = 0; i < input.length; i++) { h1 ^= input.charCodeAt(i); h1 = (h1 * 0x01000193) >>> 0 }

  let h2 = 5381
  for (let i = 0; i < input.length; i++) { h2 = (((h2 << 5) + h2) ^ input.charCodeAt(i)) >>> 0 }

  let h3 = input.length
  for (let i = 0; i < input.length; i += 7) { h3 = (h3 * 31 + input.charCodeAt(i)) >>> 0 }

  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0')
}

function refType(refNo: string | null, txType: string): 'shopee_order' | 'shopee_withdrawal' | 'shopee_other' {
  if (refNo) return 'shopee_order'
  if (txType.includes('การถอนเงิน') || txType.toLowerCase().includes('withdrawal')) return 'shopee_withdrawal'
  return 'shopee_other'
}

async function main() {
  const supabase = createServiceClient()

  if (!fs.existsSync(FILE)) throw new Error(`File not found: ${FILE}`)

  const buf   = fs.readFileSync(FILE)
  const ab    = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const fHash = crypto.createHash('sha256').update(buf).digest('hex')
  const fName = path.basename(FILE)

  // Idempotency
  const { data: existing } = await supabase
    .from('import_batches')
    .select('id')
    .eq('file_hash', fHash)
    .eq('marketplace', 'shopee')
    .eq('report_type', 'shopee_wallet_transactions')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { count } = await supabase
      .from('marketplace_wallet_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', existing.id)
    if ((count ?? 0) > 0) {
      console.log(JSON.stringify({ status: 'already_imported', batchId: existing.id, rows: count }))
      return
    }
  }

  // Parse
  const parsed = parseShopeeBalanceXLSX(ab)
  if (!parsed.success || !parsed.rows.length) {
    const errs = parsed.errors.map(e => e.message).join('; ')
    throw new Error(`Parse failed: ${errs}`)
  }
  const rows = parsed.rows
  const dates = rows.map(r => r.occurred_at.substring(0, 10)).sort()
  const dateRange = `${dates[0]} to ${dates[dates.length - 1]}`

  // Create batch
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      file_hash:      fHash,
      marketplace:    'shopee',
      report_type:    'shopee_wallet_transactions',
      period:         dateRange,
      file_name:      fName,
      row_count:      rows.length,
      inserted_count: 0,
      skipped_count:  0,
      error_count:    0,
      status:         'processing',
      created_by:     USER_ID,
    })
    .select()
    .single()

  if (batchErr || !batch) throw new Error(`Batch creation failed: ${batchErr?.message}`)

  let inserted = 0
  let skipped  = 0

  for (let i = 0; i < rows.length; i += BATCH_SZ) {
    const chunk = rows.slice(i, i + BATCH_SZ) as ShopeeBalanceTransaction[]

    const txnRows = chunk.map((tx: ShopeeBalanceTransaction) => {
      const direction: 'credit' | 'debit' = tx.amount >= 0 ? 'credit' : 'debit'
      const absAmt = Math.abs(tx.amount)
      const txHash = makeTxnHash(tx.occurred_at, tx.transaction_type, direction, absAmt, tx.ref_no, tx.balance)

      return {
        platform:          'shopee',
        occurred_at:       tx.occurred_at,
        transaction_type:  tx.transaction_type,
        direction,
        amount:            absAmt,
        currency:          'THB',
        ref_type:          refType(tx.ref_no, tx.transaction_type),
        ref_id:            tx.ref_no,
        description:       tx.transaction_mode,
        status:            tx.status,
        balance_after:     tx.balance,
        import_batch_id:   batch.id,
        source_file_name:  fName,
        source_row_number: tx.source_row_number,
        txn_hash:          txHash,
        created_by:        USER_ID,
      }
    })

    const { data: upserted, error: upErr } = await supabase
      .from('marketplace_wallet_transactions')
      .upsert(txnRows, { onConflict: 'platform,txn_hash', ignoreDuplicates: true })
      .select('id')

    if (upErr) {
      await supabase.from('import_batches')
        .update({ status: 'failed', notes: upErr.message })
        .eq('id', batch.id)
      throw new Error(`Upsert failed: ${upErr.message}`)
    }

    const n = upserted?.length ?? 0
    inserted += n
    skipped  += chunk.length - n
    process.stdout.write(`\r  ${Math.min(i + BATCH_SZ, rows.length)}/${rows.length} (ins=${inserted} skip=${skipped})`)
  }
  process.stdout.write('\n')

  // Finalize
  await supabase.from('import_batches')
    .update({
      status:         'success',
      inserted_count: inserted,
      skipped_count:  skipped,
      metadata:       { walletSummary: parsed.summary },
    })
    .eq('id', batch.id)

  console.log(JSON.stringify({ success: true, batchId: batch.id, inserted, skipped, dateRange, summary: parsed.summary }))
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
