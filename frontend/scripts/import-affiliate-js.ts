/**
 * import-affiliate-js.ts
 *
 * Full import pipeline: parse XLSX → stage rows → JS normalize → upsert facts.
 * Replaces the normalize_tiktok_affiliate_order_batch() RPC which times out
 * on large files (12,000+ rows) due to PL/pgSQL EXCEPTION-block overhead.
 *
 * Usage:
 *   npx tsx scripts/import-affiliate-js.ts --file "<path>" --created-by "<uuid>"
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { parseTikTokAffiliateWorkbook } from '../src/lib/content-ops/tiktok-affiliate-orders'

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function trimNull(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return (t === '' || t === '-' || t === '--' || t === 'N/A' || t === 'n/a' || t === 'NULL' || t === 'null') ? null : t
}

function parseMoney(v: string | null | undefined): number | null {
  const c = trimNull(v); if (!c) return null
  const s = c.replace(/\s+/g, '').replace(/,/g, '').replace(/^[฿$€£¥]/, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = parseFloat(s); if (n < 0) return null
  return Math.round(n * 100) / 100
}

function parseRate(v: string | null | undefined): number | null {
  const c = trimNull(v); if (!c) return null
  let s = c.replace(/\s+/g, '').replace(/,/g, '')
  let pct = false
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1) }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  let n = parseFloat(s)
  if (pct) n /= 100
  else if (n > 1 && n <= 100) n /= 100
  if (n < 0 || n > 1) return null
  return Math.round(n * 1_000_000) / 1_000_000
}

function parseCount(v: string | null | undefined): number | null {
  const c = trimNull(v); if (!c) return null
  const s = c.replace(/\s+/g, '').replace(/,/g, '')
  if (!/^\d+$/.test(s)) return null
  return parseInt(s, 10)
}

function parseTimestamp(v: string | null | undefined): string | null {
  const c = trimNull(v); if (!c || c === '/') return null
  const m = c.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (m) {
    const [, dd, mm, yyyy, hh, mi, ss = '00'] = m
    return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh - 7, +mi, +ss)).toISOString()
  }
  const d2 = c.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (d2) { const [, dd, mm, yyyy] = d2; return new Date(Date.UTC(+yyyy, +mm - 1, +dd, -7, 0, 0)).toISOString() }
  const iso = new Date(c); if (!isNaN(iso.getTime())) return iso.toISOString()
  return null
}

function normStatus(v: string | null | undefined): string {
  const c = (trimNull(v) || '').toLowerCase().replace(/\s+/g, '')
  return ({ settled: 'settled', pending: 'pending', awaitingpayment: 'awaiting_payment', ineligible: 'ineligible' } as Record<string,string>)[c] || 'unknown'
}

function normContentType(v: string | null | undefined): string {
  const c = (trimNull(v) || '').toLowerCase()
  return ({ live: 'live', video: 'video', showcase: 'showcase' } as Record<string,string>)[c] || 'other'
}

function normAttribution(orderType: string | null | undefined, indirect: string | null | undefined): string {
  if ((trimNull(indirect) || '').toLowerCase().replace(/\s+/g, '') === 'indirect') return 'indirect'
  const o = (trimNull(orderType) || '').toLowerCase().replace(/\s+/g, '')
  if (o === 'shopadsorder') return 'shop_ads'
  if (o === 'affiliateorder') return 'affiliate'
  return 'unknown'
}

function statusRank(s: string): number {
  return ({ settled: 3, ineligible: 3, pending: 2, awaiting_payment: 1 } as Record<string,number>)[s] || 0
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || !args.includes('--file') || !args.includes('--created-by')) {
    console.log('Usage: npx tsx scripts/import-affiliate-js.ts --file "<path>" --created-by "<uuid>"')
    process.exit(args.includes('--help') ? 0 : 1)
  }

  const filePath = path.resolve(process.cwd(), args[args.indexOf('--file') + 1])
  const createdBy = args[args.indexOf('--created-by') + 1]
  const sheetIdx = args.indexOf('--sheet')
  const sheetName = sheetIdx !== -1 ? args[sheetIdx + 1] : undefined

  const supabase = createServiceClient()

  console.log(`\nFile: ${filePath}`)

  // ── STEP 1: Parse ──────────────────────────────────────────────────────────
  const fileBuffer = await fs.readFile(filePath)
  const fileName = path.basename(filePath)
  const sourceFileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const workbook = parseTikTokAffiliateWorkbook(fileBuffer, fileName, sheetName)
  console.log(`Parsed: ${workbook.rowCount} rows, sheet: ${workbook.sheetName}`)

  // ── STEP 2: Create batch ───────────────────────────────────────────────────
  const { data: batch, error: batchErr } = await supabase
    .from('tiktok_affiliate_import_batches')
    .insert({
      created_by: createdBy,
      source_file_name: workbook.fileName,
      source_sheet_name: workbook.sheetName,
      source_file_hash: sourceFileHash,
      raw_row_count: workbook.rowCount,
      staged_row_count: 0,
      normalized_row_count: 0,
      skipped_row_count: 0,
      error_count: 0,
      status: 'processing',
      metadata: { header_row_number: workbook.headerRowNumber, workbook_headers: workbook.headers },
    })
    .select('id')
    .single()

  if (batchErr || !batch) throw new Error(batchErr?.message || 'Failed to create batch')
  const batchId = batch.id
  console.log(`Batch ID: ${batchId}`)

  try {
    // ── STEP 3: Stage rows ─────────────────────────────────────────────────
    const stagingRows = workbook.rows.map((row) => ({
      created_by: createdBy,
      import_batch_id: batchId,
      source_file_name: workbook.fileName,
      source_sheet_name: workbook.sheetName,
      source_row_number: row.sourceRowNumber,
      source_file_hash: sourceFileHash,
      order_id: row.orderId || null,
      sku_id: row.skuId || null,
      product_name: row.productName || null,
      product_id: row.productId || null,
      price_text: row.priceText || null,
      items_sold_text: row.itemsSoldText || null,
      items_refunded_text: row.itemsRefundedText || null,
      shop_name: row.shopName || null,
      shop_code: row.shopCode || null,
      affiliate_partner: row.affiliatePartner || null,
      agency: row.agency || null,
      currency: row.currency || null,
      order_type: row.orderType || null,
      order_settlement_status: row.orderSettlementStatus || null,
      indirect_flag: row.indirectFlag || null,
      commission_type: row.commissionType || null,
      content_type: row.contentType || null,
      content_id: row.contentId || null,
      standard_rate_text: row.standardRateText || null,
      shop_ads_rate_text: row.shopAdsRateText || null,
      tiktok_bonus_rate_text: row.tiktokBonusRateText || null,
      partner_bonus_rate_text: row.partnerBonusRateText || null,
      revenue_sharing_portion_rate_text: row.revenueSharingPortionRateText || null,
      gmv_text: row.gmvText || null,
      est_commission_base_text: row.estCommissionBaseText || null,
      est_standard_commission_text: row.estStandardCommissionText || null,
      est_shop_ads_commission_text: row.estShopAdsCommissionText || null,
      est_bonus_text: row.estBonusText || null,
      est_affiliate_partner_bonus_text: row.estAffiliatePartnerBonusText || null,
      est_iva_text: row.estIvaText || null,
      est_isr_text: row.estIsrText || null,
      est_pit_text: row.estPitText || null,
      est_revenue_sharing_portion_text: row.estRevenueSharingPortionText || null,
      actual_commission_base_text: row.actualCommissionBaseText || null,
      standard_commission_text: row.standardCommissionText || null,
      shop_ads_commission_text: row.shopAdsCommissionText || null,
      bonus_text: row.bonusText || null,
      affiliate_partner_bonus_text: row.affiliatePartnerBonusText || null,
      tax_isr_text: row.taxIsrText || null,
      tax_iva_text: row.taxIvaText || null,
      tax_pit_text: row.taxPitText || null,
      shared_with_partner_text: row.sharedWithPartnerText || null,
      total_final_earned_amount_text: row.totalFinalEarnedAmountText || null,
      order_date_text: row.orderDateText || null,
      commission_settlement_date_text: row.commissionSettlementDateText || null,
      raw_payload: row.rawPayload,
    }))

    process.stdout.write('Staging')
    const STAGE_CHUNK = 500
    for (let i = 0; i < stagingRows.length; i += STAGE_CHUNK) {
      const { error } = await supabase.from('tiktok_affiliate_order_raw_staging').insert(stagingRows.slice(i, i + STAGE_CHUNK))
      if (error) throw new Error(`Staging insert failed: ${error.message}`)
      process.stdout.write('.')
    }
    console.log(` [${stagingRows.length} rows]`)

    await supabase.from('tiktok_affiliate_import_batches').update({ status: 'staged', staged_row_count: stagingRows.length }).eq('id', batchId)

    // ── STEP 4: JS Normalize ───────────────────────────────────────────────
    process.stdout.write('Normalizing')
    const normalized: { key: string; row: typeof stagingRows[0] & { order_settlement_status_norm: string; status_rank: number } }[] = []
    let missingKey = 0

    for (const s of stagingRows) {
      const orderId = trimNull(s.order_id)
      const skuId = trimNull(s.sku_id)
      const productId = trimNull(s.product_id)
      const contentId = trimNull(s.content_id)
      if (!orderId || !skuId || !productId || !contentId) { missingKey++; continue }
      const status = normStatus(s.order_settlement_status)
      normalized.push({
        key: `${createdBy}|${orderId}|${skuId}|${productId}|${contentId}`,
        row: { ...s, order_id: orderId, sku_id: skuId, product_id: productId, content_id: contentId, order_settlement_status_norm: status, status_rank: statusRank(status) },
      })
      if (normalized.length % 1000 === 0) process.stdout.write('.')
    }

    // Winner selection
    const bestMap = new Map<string, typeof normalized[0]['row']>()
    for (const { key, row } of normalized) {
      const existing = bestMap.get(key)
      if (!existing || row.status_rank > existing.status_rank) { bestMap.set(key, row); continue }
      if (row.status_rank === existing.status_rank && row.order_id > existing.order_id) bestMap.set(key, row)
    }
    const winners = [...bestMap.values()]
    const dupNonWinner = normalized.length - winners.length
    console.log(` [${winners.length} winners, ${missingKey} missing keys, ${dupNonWinner} dup non-winners]`)

    // ── STEP 5: Upsert facts ───────────────────────────────────────────────
    process.stdout.write('Upserting facts')
    const UPSERT_CHUNK = 500
    for (let i = 0; i < winners.length; i += UPSERT_CHUNK) {
      const chunk = winners.slice(i, i + UPSERT_CHUNK).map((s) => {
        const orderId = s.order_id as string
        const skuId = s.sku_id as string
        const productId = s.product_id as string
        const contentId = s.content_id as string
        const currency = (trimNull(s.currency) || '').toUpperCase() || null
        const status = s.order_settlement_status_norm
        const contentType = normContentType(s.content_type)
        const attributionType = normAttribution(s.order_type, s.indirect_flag)
        const price = parseMoney(s.price_text)
        const itemsSold = parseCount(s.items_sold_text)
        const itemsRefunded = parseCount(s.items_refunded_text)
        const gmv = parseMoney(s.gmv_text)
        const commActualStd = parseMoney(s.standard_commission_text)
        const commActualShopAds = parseMoney(s.shop_ads_commission_text)
        const commActualBonus = parseMoney(s.bonus_text)
        const commActualAffilBonus = parseMoney(s.affiliate_partner_bonus_text)
        const totalEarned = parseMoney(s.total_final_earned_amount_text)
        const totalCommission = Math.round(((commActualStd||0)+(commActualShopAds||0)+(commActualBonus||0)+(commActualAffilBonus||0))*100)/100

        const hashInput = [
          orderId, skuId, productId, contentId,
          contentType, trimNull(s.product_name)||'',
          trimNull(s.shop_name)||'', trimNull(s.shop_code)||'',
          trimNull(s.affiliate_partner)||'', trimNull(s.agency)||'',
          currency||'', trimNull(s.currency)||'',
          parseTimestamp(s.order_date_text)||'', parseTimestamp(s.commission_settlement_date_text)||'',
          status, s.order_settlement_status||'', s.order_type||'',
        ].join('|')
        const hash = crypto.createHash('md5').update(hashInput).digest('hex')

        return {
          created_by: createdBy,
          import_batch_id: batchId,
          staging_row_id: null as null,
          normalized_row_version_hash: hash,
          source_platform: 'tiktok_affiliate',
          order_id: orderId, sku_id: skuId, product_id: productId, content_id: contentId,
          content_type: contentType, content_type_raw: trimNull(s.content_type),
          product_name: trimNull(s.product_name), shop_name: trimNull(s.shop_name),
          shop_code: trimNull(s.shop_code), affiliate_partner: trimNull(s.affiliate_partner),
          agency: trimNull(s.agency), currency, currency_raw: trimNull(s.currency),
          order_date: parseTimestamp(s.order_date_text),
          commission_settlement_date: parseTimestamp(s.commission_settlement_date_text),
          order_settlement_status: status, order_settlement_status_raw: trimNull(s.order_settlement_status),
          is_successful: status === 'settled', is_cancelled: status === 'ineligible',
          is_eligible_for_commission: status === 'settled' || status === 'pending',
          attribution_type: attributionType, order_type_raw: trimNull(s.order_type),
          is_indirect: (trimNull(s.indirect_flag)||'').toLowerCase().replace(/\s+/g,'') === 'indirect',
          commission_type_raw: trimNull(s.commission_type),
          price, items_sold: itemsSold, items_refunded: itemsRefunded, gmv,
          commission_rate_standard: parseRate(s.standard_rate_text),
          commission_rate_shop_ads: parseRate(s.shop_ads_rate_text),
          commission_rate_tiktok_bonus: parseRate(s.tiktok_bonus_rate_text),
          commission_rate_partner_bonus: parseRate(s.partner_bonus_rate_text),
          commission_rate_revenue_share: parseRate(s.revenue_sharing_portion_rate_text),
          commission_base_est: parseMoney(s.est_commission_base_text),
          commission_est_standard: parseMoney(s.est_standard_commission_text),
          commission_est_shop_ads: parseMoney(s.est_shop_ads_commission_text),
          commission_est_bonus: parseMoney(s.est_bonus_text),
          commission_est_affiliate_partner_bonus: parseMoney(s.est_affiliate_partner_bonus_text),
          commission_est_iva: parseMoney(s.est_iva_text),
          commission_est_isr: parseMoney(s.est_isr_text),
          commission_est_pit: parseMoney(s.est_pit_text),
          commission_est_revenue_share: parseMoney(s.est_revenue_sharing_portion_text),
          commission_base_actual: parseMoney(s.actual_commission_base_text),
          commission_actual_standard: commActualStd,
          commission_actual_shop_ads: commActualShopAds,
          commission_actual_bonus: commActualBonus,
          commission_actual_affiliate_partner_bonus: commActualAffilBonus,
          shared_with_partner_amount: parseMoney(s.shared_with_partner_text),
          tax_isr_amount: parseMoney(s.tax_isr_text),
          tax_iva_amount: parseMoney(s.tax_iva_text),
          tax_pit_amount: parseMoney(s.tax_pit_text),
          total_commission_amount: totalCommission || null,
          total_earned_amount: totalEarned,
          raw_payload: s.raw_payload,
        }
      })

      const { error } = await supabase.from('content_order_facts').upsert(chunk, {
        onConflict: 'created_by,order_id,sku_id,product_id,content_id',
        ignoreDuplicates: false,
      })
      if (error) throw new Error(`Upsert chunk ${i}: ${error.message}`)
      process.stdout.write('.')
    }
    console.log(` [${winners.length} rows]`)

    // ── STEP 6: Update batch ───────────────────────────────────────────────
    await supabase.from('tiktok_affiliate_import_batches').update({
      status: 'normalized',
      normalized_row_count: winners.length,
      skipped_row_count: missingKey,
      metadata: {
        header_row_number: workbook.headerRowNumber,
        workbook_headers: workbook.headers,
        js_normalizer: true,
        valid_candidate_row_count: normalized.length,
        winner_row_count: winners.length,
        missing_key_row_count: missingKey,
        duplicate_non_winner_row_count: dupNonWinner,
      },
    }).eq('id', batchId)

    console.log('\n=== IMPORT COMPLETE ===')
    const result = { batchId, fileName, rawRowCount: workbook.rowCount, stagedRowCount: stagingRows.length, winnerRowCount: winners.length, missingKeyRowCount: missingKey, duplicateNonWinnerRowCount: dupNonWinner, status: 'normalized' }
    console.log(JSON.stringify(result, null, 2))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabase.from('tiktok_affiliate_import_batches').update({ status: 'failed', notes: msg }).eq('id', batchId)
    throw err
  }
}

main().catch((err) => { console.error('FATAL:', err instanceof Error ? err.message : err); process.exit(1) })
