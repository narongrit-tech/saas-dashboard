import path from 'node:path'
import fs from 'node:fs'
import crypto from 'crypto'
import { config } from 'dotenv'
import { createServiceClient } from '../src/lib/supabase/service'
import { parseShopeeOrdersXLSX } from '../src/lib/importers/shopee-orders-parser'
import type { ParsedSalesRow } from '../src/types/sales-import'

config({ path: path.resolve(__dirname, '../.env.local') })

const USER_ID  = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
const RAW_DIR  = path.resolve(__dirname, '../../Raw. Data Nimitt Mind')
const FILE     = path.join(RAW_DIR, 'Order/Shopee/Order.all.20260101_20260131.xlsx')
const BATCH_SZ = 200

function orderLineHash(platform: string, extId: string, product: string, qty: number, amount: number): string {
  return crypto
    .createHash('sha256')
    .update([platform, extId, product, qty.toString(), amount.toString()].join('|'))
    .digest('hex')
}

async function main() {
  const supabase = createServiceClient()

  if (!fs.existsSync(FILE)) throw new Error(`File not found: ${FILE}`)

  const buf   = fs.readFileSync(FILE)
  const ab    = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const fHash = crypto.createHash('sha256').update(buf).digest('hex')
  const fName = path.basename(FILE)

  // Idempotency: skip if already imported
  const { data: existing } = await supabase
    .from('import_batches')
    .select('id, inserted_count')
    .eq('file_hash', fHash)
    .eq('marketplace', 'shopee')
    .eq('report_type', 'shopee_orders')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { count } = await supabase
      .from('sales_orders')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', existing.id)
    if ((count ?? 0) > 0) {
      console.log(JSON.stringify({ status: 'already_imported', batchId: existing.id, rows: count }))
      return
    }
  }

  // Parse
  const parsed = parseShopeeOrdersXLSX(ab)
  if (!parsed.success || !parsed.allRows.length) {
    const errs = parsed.errors.map(e => e.message).join('; ')
    throw new Error(`Parse failed: ${errs}`)
  }
  const rows = parsed.allRows
  const dateRange = parsed.dateRange ? `${parsed.dateRange.start} to ${parsed.dateRange.end}` : 'N/A'

  // Create batch
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      file_hash:      fHash,
      marketplace:    'shopee',
      report_type:    'shopee_orders',
      period:         dateRange,
      file_name:      fName,
      row_count:      rows.length,
      inserted_count: 0,
      updated_count:  0,
      skipped_count:  0,
      error_count:    0,
      status:         'processing',
      created_by:     USER_ID,
    })
    .select()
    .single()

  if (batchErr || !batch) throw new Error(`Batch creation failed: ${batchErr?.message}`)

  // Pre-compute order totals for order_amount fallback
  const orderTotalMap = new Map<string, number>()
  for (const r of rows) {
    const key = r.external_order_id || r.order_id
    if (!key) continue
    orderTotalMap.set(key, (orderTotalMap.get(key) ?? 0) + (r.unit_price ?? 0) * (r.quantity ?? 0))
  }

  let inserted = 0
  let skipped  = 0

  for (let i = 0; i < rows.length; i += BATCH_SZ) {
    const chunk = rows.slice(i, i + BATCH_SZ)

    const salesRows = chunk.map((r: ParsedSalesRow) => {
      const key = r.external_order_id || r.order_id || ''
      const resolvedOrderAmount =
        (r.order_amount && r.order_amount > 0)
          ? r.order_amount
          : (orderTotalMap.get(key) ?? null)

      return {
        order_id:         r.order_id,
        marketplace:      r.marketplace,
        channel:          r.channel,
        product_name:     r.product_name,
        sku:              r.sku,
        quantity:         r.quantity,
        unit_price:       r.unit_price,
        total_amount:     r.total_amount,
        order_date:       r.order_date,
        status:           r.status,
        tracking_number:  r.tracking_number,
        order_line_hash:  orderLineHash(
          r.source_platform || r.marketplace || '',
          r.external_order_id || r.order_id || '',
          r.product_name || '',
          r.quantity ?? 0,
          r.total_amount ?? 0,
        ),
        source:           'imported',
        import_batch_id:  batch.id,
        metadata:         r.metadata ?? {},
        created_by:       USER_ID,
        source_platform:  r.source_platform,
        external_order_id: r.external_order_id,
        platform_status:  r.platform_status,
        status_group:     r.status_group,
        payment_status:   r.payment_status,
        paid_at:          r.paid_at,
        shipped_at:       r.shipped_at,
        delivered_at:     r.delivered_at,
        seller_sku:       r.seller_sku,
        order_amount:     resolvedOrderAmount,
      }
    })

    const { data: upserted, error: upErr } = await supabase
      .from('sales_orders')
      .upsert(salesRows, { onConflict: 'order_line_hash', ignoreDuplicates: true })
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

  // Upsert order_financials
  const finMap = new Map<string, object>()
  for (const r of rows) {
    if (!finMap.has(r.order_id)) {
      finMap.set(r.order_id, {
        order_id:        r.order_id,
        marketplace:     r.marketplace,
        import_batch_id: batch.id,
        created_by:      USER_ID,
        order_amount:    r.order_amount || orderTotalMap.get(r.external_order_id || r.order_id) || null,
        shipped_at:      r.shipped_at ?? null,
      })
    }
  }
  if (finMap.size > 0) {
    const { error: finErr } = await supabase
      .from('order_financials')
      .upsert(Array.from(finMap.values()), { onConflict: 'created_by,order_id', ignoreDuplicates: false })
    if (finErr) process.stderr.write(`[WARN] order_financials: ${finErr.message}\n`)
  }

  // Finalize
  await supabase.from('import_batches')
    .update({ status: 'success', inserted_count: inserted, skipped_count: skipped })
    .eq('id', batch.id)

  console.log(JSON.stringify({ success: true, batchId: batch.id, inserted, skipped, dateRange, summary: parsed.summary }))
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
