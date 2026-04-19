/**
 * normalize-staged-batch.ts
 *
 * JS-based normalizer for tiktok_affiliate_order_raw_staging → content_order_facts.
 * Replaces the normalize_tiktok_affiliate_order_batch() RPC which times out for large batches
 * due to PL/pgSQL EXCEPTION blocks and correlated subqueries.
 *
 * Usage:
 *   npx tsx scripts/normalize-staged-batch.ts --batch-id <uuid>
 *   npx tsx scripts/normalize-staged-batch.ts --batch-id <uuid> --dry-run
 */

import crypto from 'node:crypto'
import path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ─── Supabase client ──────────────────────────────────────────────────────────

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ─── Parse helpers (JS equivalents of DB functions) ──────────────────────────

function trimNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const t = value.trim()
  if (t === '' || t === '-' || t === '--' || t === 'N/A' || t === 'n/a' || t === 'NULL' || t === 'null') return null
  return t
}

function parseMoney(value: string | null | undefined): number | null {
  const c = trimNull(value)
  if (!c) return null
  const s = c.replace(/\s+/g, '').replace(/,/g, '').replace(/^[฿$€£¥]/, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = parseFloat(s)
  if (n < 0) return null
  return Math.round(n * 100) / 100
}

function parseRate(value: string | null | undefined): number | null {
  const c = trimNull(value)
  if (!c) return null
  let s = c.replace(/\s+/g, '').replace(/,/g, '')
  let hasPercent = false
  if (s.endsWith('%')) { hasPercent = true; s = s.slice(0, -1) }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  let n = parseFloat(s)
  if (hasPercent) n = n / 100
  else if (n > 1 && n <= 100) n = n / 100
  if (n < 0 || n > 1) return null
  return Math.round(n * 1_000_000) / 1_000_000
}

function parseCount(value: string | null | undefined): number | null {
  const c = trimNull(value)
  if (!c) return null
  const s = c.replace(/\s+/g, '').replace(/,/g, '')
  if (!/^\d+$/.test(s)) return null
  return parseInt(s, 10)
}

function parseTimestamp(value: string | null | undefined): string | null {
  const c = trimNull(value)
  if (!c || c === '/') return null
  // DD/MM/YYYY HH24:MI:SS or DD/MM/YYYY HH24:MI or DD/MM/YYYY
  const full = c.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (full) {
    const [, dd, mm, yyyy, hh, mi, ss = '00'] = full
    // TikTok times are Bangkok (UTC+7) → convert to UTC for TIMESTAMPTZ storage
    const utcMs = Date.UTC(+yyyy, +mm - 1, +dd, +hh - 7, +mi, +ss)
    return new Date(utcMs).toISOString()
  }
  const dateOnly = c.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dateOnly) {
    const [, dd, mm, yyyy] = dateOnly
    const utcMs = Date.UTC(+yyyy, +mm - 1, +dd, -7, 0, 0)
    return new Date(utcMs).toISOString()
  }
  // ISO fallback
  const d = new Date(c)
  if (!isNaN(d.getTime())) return d.toISOString()
  return null
}

function normalizeStatus(value: string | null | undefined): string {
  const c = (trimNull(value) || '').toLowerCase().replace(/\s+/g, '')
  const map: Record<string, string> = {
    settled: 'settled',
    pending: 'pending',
    awaitingpayment: 'awaiting_payment',
    ineligible: 'ineligible',
  }
  return map[c] || 'unknown'
}

function normalizeContentType(value: string | null | undefined): string {
  const c = (trimNull(value) || '').toLowerCase()
  const map: Record<string, string> = { live: 'live', video: 'video', showcase: 'showcase' }
  return map[c] || 'other'
}

function normalizeAttributionType(orderType: string | null | undefined, indirectFlag: string | null | undefined): string {
  const indirect = (trimNull(indirectFlag) || '').toLowerCase().replace(/\s+/g, '')
  if (indirect === 'indirect') return 'indirect'
  const order = (trimNull(orderType) || '').toLowerCase().replace(/\s+/g, '')
  if (order === 'shopadsorder') return 'shop_ads'
  if (order === 'affiliateorder') return 'affiliate'
  return 'unknown'
}

function statusRank(status: string): number {
  const ranks: Record<string, number> = { settled: 3, ineligible: 3, pending: 2, awaiting_payment: 1 }
  return ranks[status] || 0
}

// ─── Row normalization ────────────────────────────────────────────────────────

interface StagingRow {
  id: string
  created_at: string
  created_by: string
  import_batch_id: string
  source_row_number: number
  raw_payload: Record<string, unknown>
  order_id: string | null
  sku_id: string | null
  product_name: string | null
  product_id: string | null
  price_text: string | null
  items_sold_text: string | null
  items_refunded_text: string | null
  shop_name: string | null
  shop_code: string | null
  affiliate_partner: string | null
  agency: string | null
  currency: string | null
  order_type: string | null
  order_settlement_status: string | null
  indirect_flag: string | null
  commission_type: string | null
  content_type: string | null
  content_id: string | null
  standard_rate_text: string | null
  shop_ads_rate_text: string | null
  tiktok_bonus_rate_text: string | null
  partner_bonus_rate_text: string | null
  revenue_sharing_portion_rate_text: string | null
  gmv_text: string | null
  est_commission_base_text: string | null
  est_standard_commission_text: string | null
  est_shop_ads_commission_text: string | null
  est_bonus_text: string | null
  est_affiliate_partner_bonus_text: string | null
  est_iva_text: string | null
  est_isr_text: string | null
  est_pit_text: string | null
  est_revenue_sharing_portion_text: string | null
  actual_commission_base_text: string | null
  standard_commission_text: string | null
  shop_ads_commission_text: string | null
  bonus_text: string | null
  affiliate_partner_bonus_text: string | null
  tax_isr_text: string | null
  tax_iva_text: string | null
  tax_pit_text: string | null
  shared_with_partner_text: string | null
  total_final_earned_amount_text: string | null
  order_date_text: string | null
  commission_settlement_date_text: string | null
}

interface NormalizedRow {
  staging_row_id: string
  staging_created_at: string
  created_by: string
  import_batch_id: string
  order_id: string
  sku_id: string
  product_id: string
  content_id: string
  order_settlement_status: string
  status_rank: number
  normalized_row_version_hash: string
  // All other fields for INSERT
  [key: string]: unknown
}

function normalizeRow(s: StagingRow): NormalizedRow | null {
  const orderId = trimNull(s.order_id)
  const skuId = trimNull(s.sku_id)
  const productId = trimNull(s.product_id)
  const contentId = trimNull(s.content_id)

  if (!orderId || !skuId || !productId || !contentId) return null

  const currency = (trimNull(s.currency) || '').toUpperCase() || null
  const orderSettlementStatus = normalizeStatus(s.order_settlement_status)
  const contentType = normalizeContentType(s.content_type)
  const attributionType = normalizeAttributionType(s.order_type, s.indirect_flag)
  const indirect = (trimNull(s.indirect_flag) || '').toLowerCase().replace(/\s+/g, '') === 'indirect'

  const price = parseMoney(s.price_text)
  const itemsSold = parseCount(s.items_sold_text)
  const itemsRefunded = parseCount(s.items_refunded_text)
  const gmv = parseMoney(s.gmv_text)

  const commRateStd = parseRate(s.standard_rate_text)
  const commRateShopAds = parseRate(s.shop_ads_rate_text)
  const commRateTiktokBonus = parseRate(s.tiktok_bonus_rate_text)
  const commRatePartnerBonus = parseRate(s.partner_bonus_rate_text)
  const commRateRevenueShare = parseRate(s.revenue_sharing_portion_rate_text)

  const commBaseEst = parseMoney(s.est_commission_base_text)
  const commEstStd = parseMoney(s.est_standard_commission_text)
  const commEstShopAds = parseMoney(s.est_shop_ads_commission_text)
  const commEstBonus = parseMoney(s.est_bonus_text)
  const commEstAffilBonus = parseMoney(s.est_affiliate_partner_bonus_text)
  const commEstIva = parseMoney(s.est_iva_text)
  const commEstIsr = parseMoney(s.est_isr_text)
  const commEstPit = parseMoney(s.est_pit_text)
  const commEstRevenueShare = parseMoney(s.est_revenue_sharing_portion_text)

  const commBaseActual = parseMoney(s.actual_commission_base_text)
  const commActualStd = parseMoney(s.standard_commission_text)
  const commActualShopAds = parseMoney(s.shop_ads_commission_text)
  const commActualBonus = parseMoney(s.bonus_text)
  const commActualAffilBonus = parseMoney(s.affiliate_partner_bonus_text)
  const sharedWithPartner = parseMoney(s.shared_with_partner_text)
  const taxIsr = parseMoney(s.tax_isr_text)
  const taxIva = parseMoney(s.tax_iva_text)
  const taxPit = parseMoney(s.tax_pit_text)
  const totalEarned = parseMoney(s.total_final_earned_amount_text)

  const orderDate = parseTimestamp(s.order_date_text)
  const settlementDate = parseTimestamp(s.commission_settlement_date_text)

  const totalCommission = Math.round(((commActualStd || 0) + (commActualShopAds || 0) + (commActualBonus || 0) + (commActualAffilBonus || 0)) * 100) / 100

  // Compute version hash (same field order as SQL function)
  const hashInput = [
    orderId, skuId, productId, contentId,
    contentType, trimNull(s.product_name) || '',
    trimNull(s.shop_name) || '', trimNull(s.shop_code) || '',
    trimNull(s.affiliate_partner) || '', trimNull(s.agency) || '',
    currency || '', trimNull(s.currency) || '',
    orderDate || '', settlementDate || '',
    orderSettlementStatus, s.order_settlement_status || '',
    s.order_type || '',
    attributionType, indirect.toString(),
    s.commission_type || '',
    price?.toString() || '', itemsSold?.toString() || '',
    itemsRefunded?.toString() || '', gmv?.toString() || '',
    commRateStd?.toString() || '', commRateShopAds?.toString() || '',
    commRateTiktokBonus?.toString() || '', commRatePartnerBonus?.toString() || '',
    commRateRevenueShare?.toString() || '',
    commBaseEst?.toString() || '', commEstStd?.toString() || '',
    commEstShopAds?.toString() || '', commEstBonus?.toString() || '',
    commEstAffilBonus?.toString() || '', commEstIva?.toString() || '',
    commEstIsr?.toString() || '', commEstPit?.toString() || '',
    commEstRevenueShare?.toString() || '',
    commBaseActual?.toString() || '', commActualStd?.toString() || '',
    commActualShopAds?.toString() || '', commActualBonus?.toString() || '',
    commActualAffilBonus?.toString() || '', sharedWithPartner?.toString() || '',
    taxIsr?.toString() || '', taxIva?.toString() || '', taxPit?.toString() || '',
    totalCommission.toString(),
    totalEarned?.toString() || '',
  ].join('|')

  const normalized_row_version_hash = crypto.createHash('md5').update(hashInput).digest('hex')

  return {
    staging_row_id: s.id,
    staging_created_at: s.created_at,
    created_by: s.created_by,
    import_batch_id: s.import_batch_id,
    order_id: orderId,
    sku_id: skuId,
    product_id: productId,
    content_id: contentId,
    order_settlement_status: orderSettlementStatus,
    status_rank: statusRank(orderSettlementStatus),
    normalized_row_version_hash,
    // DB insert fields
    source_platform: 'tiktok_affiliate',
    content_type: contentType,
    content_type_raw: trimNull(s.content_type),
    product_name: trimNull(s.product_name),
    shop_name: trimNull(s.shop_name),
    shop_code: trimNull(s.shop_code),
    affiliate_partner: trimNull(s.affiliate_partner),
    agency: trimNull(s.agency),
    currency: currency,
    currency_raw: trimNull(s.currency),
    order_date: orderDate,
    commission_settlement_date: settlementDate,
    order_settlement_status_raw: trimNull(s.order_settlement_status),
    is_successful: orderSettlementStatus === 'settled',
    is_cancelled: orderSettlementStatus === 'ineligible',
    is_eligible_for_commission: orderSettlementStatus === 'settled' || orderSettlementStatus === 'pending',
    attribution_type: attributionType,
    order_type_raw: trimNull(s.order_type),
    is_indirect: indirect,
    commission_type_raw: trimNull(s.commission_type),
    price,
    items_sold: itemsSold,
    items_refunded: itemsRefunded,
    gmv,
    commission_rate_standard: commRateStd,
    commission_rate_shop_ads: commRateShopAds,
    commission_rate_tiktok_bonus: commRateTiktokBonus,
    commission_rate_partner_bonus: commRatePartnerBonus,
    commission_rate_revenue_share: commRateRevenueShare,
    commission_base_est: commBaseEst,
    commission_est_standard: commEstStd,
    commission_est_shop_ads: commEstShopAds,
    commission_est_bonus: commEstBonus,
    commission_est_affiliate_partner_bonus: commEstAffilBonus,
    commission_est_iva: commEstIva,
    commission_est_isr: commEstIsr,
    commission_est_pit: commEstPit,
    commission_est_revenue_share: commEstRevenueShare,
    commission_base_actual: commBaseActual,
    commission_actual_standard: commActualStd,
    commission_actual_shop_ads: commActualShopAds,
    commission_actual_bonus: commActualBonus,
    commission_actual_affiliate_partner_bonus: commActualAffilBonus,
    shared_with_partner_amount: sharedWithPartner,
    tax_isr_amount: taxIsr,
    tax_iva_amount: taxIva,
    tax_pit_amount: taxPit,
    total_commission_amount: totalCommission || null,
    total_earned_amount: totalEarned,
    raw_payload: s.raw_payload,
  }
}

// ─── Winner selection ─────────────────────────────────────────────────────────

function selectWinners(rows: NormalizedRow[]): NormalizedRow[] {
  const best = new Map<string, NormalizedRow>()
  for (const row of rows) {
    const key = `${row.created_by}|${row.order_id}|${row.sku_id}|${row.product_id}|${row.content_id}`
    const existing = best.get(key)
    if (!existing) { best.set(key, row); continue }
    // Prefer higher status rank, then more recent staging created_at, then higher staging_row_id (lexicographic)
    if (row.status_rank > existing.status_rank) { best.set(key, row); continue }
    if (row.status_rank === existing.status_rank) {
      if (row.staging_created_at > existing.staging_created_at) { best.set(key, row); continue }
      if (row.staging_created_at === existing.staging_created_at && row.staging_row_id > existing.staging_row_id) {
        best.set(key, row)
      }
    }
  }
  return [...best.values()]
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npx tsx scripts/normalize-staged-batch.ts --batch-id <uuid> [--dry-run]')
    process.exit(0)
  }

  const batchId = args[args.indexOf('--batch-id') + 1]
  const dryRun = args.includes('--dry-run')

  if (!batchId) {
    console.error('ERROR: --batch-id is required')
    process.exit(1)
  }

  const supabase = createServiceClient()

  // Verify batch exists and is in a re-normalizable state
  const { data: batch, error: batchErr } = await supabase
    .from('tiktok_affiliate_import_batches')
    .select('id, created_by, status, source_file_name, raw_row_count, staged_row_count')
    .eq('id', batchId)
    .single()

  if (batchErr || !batch) {
    console.error('ERROR: batch not found or inaccessible:', batchErr?.message)
    process.exit(1)
  }

  if (!['staged', 'failed', 'normalized'].includes(batch.status)) {
    console.error(`ERROR: batch status is '${batch.status}', expected staged/failed/normalized`)
    process.exit(1)
  }

  console.log(`Batch: ${batchId}`)
  console.log(`File:  ${batch.source_file_name}`)
  console.log(`Status: ${batch.status} | Raw: ${batch.raw_row_count} | Staged: ${batch.staged_row_count}`)
  console.log(`Dry run: ${dryRun}`)

  // Page through staging rows
  const PAGE_SIZE = 1000
  let offset = 0
  const allRows: StagingRow[] = []

  process.stdout.write('Reading staging rows')
  while (true) {
    const { data, error } = await supabase
      .from('tiktok_affiliate_order_raw_staging')
      .select('*')
      .eq('import_batch_id', batchId)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('source_row_number', { ascending: true })

    if (error) throw new Error(`Failed to read staging: ${error.message}`)
    if (!data || data.length === 0) break
    allRows.push(...(data as StagingRow[]))
    process.stdout.write('.')
    offset += PAGE_SIZE
    if (data.length < PAGE_SIZE) break
  }
  console.log(` [${allRows.length} rows]`)

  if (allRows.length === 0) {
    console.error('ERROR: no staging rows found for this batch')
    process.exit(1)
  }

  // Normalize
  process.stdout.write('Normalizing')
  const normalized: NormalizedRow[] = []
  let missingKey = 0
  for (const row of allRows) {
    const n = normalizeRow(row)
    if (!n) { missingKey++; continue }
    normalized.push(n)
    if (normalized.length % 1000 === 0) process.stdout.write('.')
  }
  console.log(` [${normalized.length} valid, ${missingKey} missing keys]`)

  // Select winners
  const winners = selectWinners(normalized)
  const duplicateNonWinner = normalized.length - winners.length
  console.log(`Winners: ${winners.length} | Duplicate non-winners: ${duplicateNonWinner}`)

  if (dryRun) {
    console.log('DRY RUN — no DB writes. Exiting.')
    process.exit(0)
  }

  // Upsert winners in chunks
  const CHUNK_SIZE = 500
  let upserted = 0
  process.stdout.write('Upserting to content_order_facts')

  for (let i = 0; i < winners.length; i += CHUNK_SIZE) {
    const chunk = winners.slice(i, i + CHUNK_SIZE).map((w) => ({
      created_by: w.created_by as string,
      import_batch_id: w.import_batch_id as string,
      staging_row_id: w.staging_row_id as string,
      normalized_row_version_hash: w.normalized_row_version_hash as string,
      source_platform: w.source_platform as string,
      order_id: w.order_id as string,
      sku_id: w.sku_id as string,
      product_id: w.product_id as string,
      content_id: w.content_id as string,
      content_type: w.content_type as string | null,
      content_type_raw: w.content_type_raw as string | null,
      product_name: w.product_name as string | null,
      shop_name: w.shop_name as string | null,
      shop_code: w.shop_code as string | null,
      affiliate_partner: w.affiliate_partner as string | null,
      agency: w.agency as string | null,
      currency: w.currency as string | null,
      currency_raw: w.currency_raw as string | null,
      order_date: w.order_date as string | null,
      commission_settlement_date: w.commission_settlement_date as string | null,
      order_settlement_status: w.order_settlement_status as string,
      order_settlement_status_raw: w.order_settlement_status_raw as string | null,
      is_successful: w.is_successful as boolean,
      is_cancelled: w.is_cancelled as boolean,
      is_eligible_for_commission: w.is_eligible_for_commission as boolean,
      attribution_type: w.attribution_type as string,
      order_type_raw: w.order_type_raw as string | null,
      is_indirect: w.is_indirect as boolean,
      commission_type_raw: w.commission_type_raw as string | null,
      price: w.price as number | null,
      items_sold: w.items_sold as number | null,
      items_refunded: w.items_refunded as number | null,
      gmv: w.gmv as number | null,
      commission_rate_standard: w.commission_rate_standard as number | null,
      commission_rate_shop_ads: w.commission_rate_shop_ads as number | null,
      commission_rate_tiktok_bonus: w.commission_rate_tiktok_bonus as number | null,
      commission_rate_partner_bonus: w.commission_rate_partner_bonus as number | null,
      commission_rate_revenue_share: w.commission_rate_revenue_share as number | null,
      commission_base_est: w.commission_base_est as number | null,
      commission_est_standard: w.commission_est_standard as number | null,
      commission_est_shop_ads: w.commission_est_shop_ads as number | null,
      commission_est_bonus: w.commission_est_bonus as number | null,
      commission_est_affiliate_partner_bonus: w.commission_est_affiliate_partner_bonus as number | null,
      commission_est_iva: w.commission_est_iva as number | null,
      commission_est_isr: w.commission_est_isr as number | null,
      commission_est_pit: w.commission_est_pit as number | null,
      commission_est_revenue_share: w.commission_est_revenue_share as number | null,
      commission_base_actual: w.commission_base_actual as number | null,
      commission_actual_standard: w.commission_actual_standard as number | null,
      commission_actual_shop_ads: w.commission_actual_shop_ads as number | null,
      commission_actual_bonus: w.commission_actual_bonus as number | null,
      commission_actual_affiliate_partner_bonus: w.commission_actual_affiliate_partner_bonus as number | null,
      shared_with_partner_amount: w.shared_with_partner_amount as number | null,
      tax_isr_amount: w.tax_isr_amount as number | null,
      tax_iva_amount: w.tax_iva_amount as number | null,
      tax_pit_amount: w.tax_pit_amount as number | null,
      total_commission_amount: w.total_commission_amount as number | null,
      total_earned_amount: w.total_earned_amount as number | null,
      raw_payload: w.raw_payload as Record<string, unknown>,
    }))

    const { error } = await supabase
      .from('content_order_facts')
      .upsert(chunk, {
        onConflict: 'created_by,order_id,sku_id,product_id,content_id',
        ignoreDuplicates: false,
      })

    if (error) throw new Error(`Upsert failed at offset ${i}: ${error.message}`)
    upserted += chunk.length
    process.stdout.write('.')
  }
  console.log(` [${upserted} upserted]`)

  // Update batch status
  const { error: updateErr } = await supabase
    .from('tiktok_affiliate_import_batches')
    .update({
      status: 'normalized',
      normalized_row_count: winners.length,
      skipped_row_count: missingKey,
      metadata: {
        js_normalizer: true,
        valid_candidate_row_count: normalized.length,
        winner_row_count: winners.length,
        missing_key_row_count: missingKey,
        duplicate_non_winner_row_count: duplicateNonWinner,
      },
    })
    .eq('id', batchId)

  if (updateErr) throw new Error(`Failed to update batch: ${updateErr.message}`)

  console.log('\n=== NORMALIZATION COMPLETE ===')
  console.log(`Batch ID:           ${batchId}`)
  console.log(`Staging rows read:  ${allRows.length}`)
  console.log(`Valid candidates:   ${normalized.length}`)
  console.log(`Winners upserted:   ${winners.length}`)
  console.log(`Missing keys:       ${missingKey}`)
  console.log(`Duplicate losers:   ${duplicateNonWinner}`)
}

main().catch((err) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
