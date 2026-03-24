'use server'

/**
 * Performance Ads Import - Server Actions (v2 - staging handshake)
 *
 * Problem solved: Passing Uint8Array (10MB XLSX) through Next.js Server Actions
 * caused "Body exceeded 20mb limit" (base64 serialization adds ~33% overhead).
 *
 * Fix: Client parses XLSX locally → sends only parsed DailyAdData[] rows (small JSON)
 *      + file hash to server → server stores in ad_import_staging_rows → returns batchId.
 *      Confirm step: client sends only batchId → server reads staging → imports real tables.
 *
 * Business Rules preserved:
 * - Dedup by file_hash + campaignType + reportDate
 * - Daily breakdown: one record per day per campaign in ad_daily_performance
 * - One wallet_ledger SPEND entry per day (aggregated across campaigns)
 * - Bangkok timezone: dates are already YYYY-MM-DD from client parser
 * - Staging rows cleaned up after successful confirm
 */

import { createClient } from '@/lib/supabase/server'
import { formatBangkok } from '@/lib/bangkok-time'
import type { DailyAdData } from '@/lib/parsers/tiktok-ads-parser'
import crypto from 'crypto'

// ─── Shared Types ─────────────────────────────────────────────────────────────

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

interface PerformanceUpsertRow {
  id?: string
  created_by: string
  marketplace: string
  ad_date: string
  campaign_type: 'product' | 'live'
  campaign_name: string | null
  campaign_id: string | null
  video_id: string | null
  spend: number
  orders: number
  revenue: number
  roi: number
  source_row_hash: string
  source: string
  import_batch_id: string
}

function normalizeForHash(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function makeSourceRowHash(input: {
  campaignName: string | null | undefined
  spend: number
  orders: number
  revenue: number
}): string {
  const content = [
    normalizeForHash(input.campaignName),
    '',
    '',
    Number(input.spend || 0).toFixed(2),
    String(Math.round(Number(input.orders || 0))),
    Number(input.revenue || 0).toFixed(2),
  ].join('|')

  return crypto.createHash('md5').update(content, 'utf8').digest('hex')
}

async function upsertPerformanceChunkWithFallback(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  rows: PerformanceUpsertRow[]
): Promise<{ ok: boolean; insertedCount: number; mode: 'primary' | 'fallback'; error?: string }> {
  const { error: primaryError } = await supabase
    .from('ad_daily_performance')
    .upsert(rows, { onConflict: 'created_by,source_row_hash' })

  if (!primaryError) {
    return { ok: true, insertedCount: rows.length, mode: 'primary' }
  }

  if (primaryError.code !== '42P10') {
    return {
      ok: false,
      insertedCount: 0,
      mode: 'primary',
      error: `[${primaryError.code}] ${primaryError.message}`,
    }
  }

  const uniqueHashes = Array.from(
    new Set(
      rows
        .map((row) => row.source_row_hash)
        .filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)
    )
  )

  if (uniqueHashes.length === 0) {
    return {
      ok: false,
      insertedCount: 0,
      mode: 'fallback',
      error: '[FALLBACK] source_row_hash is empty for all rows',
    }
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('ad_daily_performance')
    .select('id, source_row_hash')
    .in('source_row_hash', uniqueHashes)

  if (existingError) {
    return {
      ok: false,
      insertedCount: 0,
      mode: 'fallback',
      error: `[${existingError.code}] ${existingError.message}`,
    }
  }

  const existingByHash = new Map<string, string>()
  for (const existing of existingRows || []) {
    if (existing?.source_row_hash && existing?.id) {
      existingByHash.set(String(existing.source_row_hash), String(existing.id))
    }
  }

  const mergedRows = rows.map((row) => {
    const existingId = existingByHash.get(row.source_row_hash)
    return existingId ? { ...row, id: existingId } : row
  })

  const { error: fallbackUpsertError } = await supabase
    .from('ad_daily_performance')
    .upsert(mergedRows, { onConflict: 'id' })

  if (fallbackUpsertError) {
    return {
      ok: false,
      insertedCount: 0,
      mode: 'fallback',
      error: `[${fallbackUpsertError.code}] ${fallbackUpsertError.message}`,
    }
  }

  return { ok: true, insertedCount: mergedRows.length, mode: 'fallback' }
}

// ─── Step 1: Preview ──────────────────────────────────────────────────────────

export interface AdsImportPreviewInput {
  fileName: string
  campaignType: 'product' | 'live'
  reportDate: string        // YYYY-MM-DD
  fileHash: string          // SHA-256 hex — computed client-side via Web Crypto
  currency: string
  rows: DailyAdData[]       // Parsed client-side — structured JSON (not binary)
  // Precomputed summary for fast display (avoids re-scanning rows server-side)
  totalSpend: number
  totalGMV: number
  totalOrders: number
  avgROAS: number
  rowCount: number
  daysCount: number
  reportDateRange: string
}

export interface AdsImportPreviewResult {
  success: boolean
  batchId?: string
  sampleRows?: DailyAdData[]   // First 50 rows for display
  error?: string
}

/**
 * Step 1: Create import preview
 * - Validates inputs + dedup check (file_hash + campaignType + reportDate)
 * - Creates import_batch with status='processing' (existing allowed value)
 * - Inserts parsed rows into ad_import_staging_rows (chunked)
 * - Returns { batchId, sampleRows } — payload stays small (<1 KB)
 */
export async function createAdsImportPreview(
  input: AdsImportPreviewInput
): Promise<AdsImportPreviewResult> {
  try {
    // 1. Auth
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Validate inputs
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate)) {
      return { success: false, error: 'Report Date format ต้องเป็น YYYY-MM-DD' }
    }
    const selectedDate = new Date(input.reportDate)
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    if (selectedDate > today) {
      return { success: false, error: 'Report Date ต้องไม่เป็นอนาคต' }
    }
    if (!input.rows.length) {
      return { success: false, error: 'ไม่มีข้อมูล rows — ตรวจสอบไฟล์อีกครั้ง' }
    }

    // 3. Dedup check — only against successfully imported batches
    console.log('[AdsImport][Preview] input-stats', {
      fileName: input.fileName,
      campaignType: input.campaignType,
      reportDate: input.reportDate,
      parsedRowsCount: input.rows.length,
      totalSpend: input.totalSpend,
      totalGMV: input.totalGMV,
      totalOrders: input.totalOrders,
      daysCount: input.daysCount,
      reportDateRange: input.reportDateRange,
    })

    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, file_name, created_at, metadata')
      .eq('file_hash', input.fileHash)
      .eq('report_type', `tiktok_ads_${input.campaignType}`)
      .eq('status', 'success')
      .single()

    if (existingBatch && existingBatch.metadata?.reportDate === input.reportDate) {
      return {
        success: false,
        error: `ไฟล์นี้ถูก import แล้วสำหรับวันที่ ${input.reportDate} (${input.campaignType}) — "${existingBatch.file_name}" เมื่อ ${formatBangkok(
          new Date(existingBatch.created_at),
          'yyyy-MM-dd HH:mm'
        )}`,
      }
    }

    // 4. Derive date range from rows for date_min / date_max / import_scope_key
    const rowDates = input.rows
      .map((r) => r.date)
      .filter((d): d is string => typeof d === 'string' && d.length > 0)
      .sort()
    const dateStart = rowDates[0] ?? input.reportDate
    const dateEnd = rowDates[rowDates.length - 1] ?? input.reportDate
    const importScopeKey = `ads:tiktok:${input.campaignType}:${dateStart}:${dateEnd}`

    // 5. Create import_batch (status='processing' → becomes 'success' after confirm)
    //    'processing' is an existing allowed value — no migration needed for status constraint.
    //    The preview/staging state is tracked by ad_import_staging_rows existence, not by status.
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        marketplace: 'tiktok',
        report_type: `tiktok_ads_${input.campaignType}`,
        period: input.reportDateRange,
        file_name: input.fileName,
        file_hash: input.fileHash,
        row_count: input.rowCount,
        inserted_count: 0,
        status: 'processing',
        date_min: dateStart,
        date_max: dateEnd,
        import_scope_key: importScopeKey,
        metadata: {
          reportDate: input.reportDate,
          adsType: input.campaignType,
          currency: input.currency,
          totalSpend: input.totalSpend,
          totalGMV: input.totalGMV,
          totalOrders: input.totalOrders,
          avgROAS: input.avgROAS,
          daysCount: input.daysCount,
        },
        created_by: user.id,
      })
      .select()
      .single()

    if (batchError || !batch) {
      console.error('Error creating import batch:', batchError)
      return { success: false, error: 'ไม่สามารถสร้าง import batch ได้' }
    }

    // 6. Insert staging rows in chunks of 500
    const CHUNK = 500
    for (let i = 0; i < input.rows.length; i += CHUNK) {
      const chunk = input.rows.slice(i, i + CHUNK).map((row, j) => ({
        created_by: user.id,
        batch_id: batch.id,
        row_index: i + j,
        ad_date: row.date,
        campaign_name: row.campaignName,
        spend: row.spend,
        gmv: row.gmv,
        orders: row.orders,
        roas: row.roas,
      }))

      const { error: stagingError } = await supabase
        .from('ad_import_staging_rows')
        .insert(chunk)

      if (stagingError) {
        console.error('Error inserting staging rows:', stagingError)
        // Cleanup orphaned batch
        await supabase.from('import_batches').delete().eq('id', batch.id)
        return { success: false, error: 'ไม่สามารถบันทึก staging rows ได้' }
      }
    }

    return {
      success: true,
      batchId: batch.id,
      sampleRows: input.rows.slice(0, 50),
    }
  } catch (error) {
    console.error('Unexpected error in createAdsImportPreview:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ─── Step 2: Confirm ──────────────────────────────────────────────────────────

/**
 * Step 2: Confirm import
 * - Accepts only batchId + adsWalletId (no large payload)
 * - Reads staging rows from DB
 * - Inserts to ad_daily_performance (upsert) + wallet_ledger SPEND
 * - Updates batch status='success', deletes staging rows
 */
export async function confirmAdsImport(
  batchId: string,
  adsWalletId: string
): Promise<ActionResult> {
  try {
    // 1. Auth
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }
    }

    // 2. Fetch batch — verify owner + must be in 'processing' state (not yet confirmed)
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .select('id, report_type, file_name, metadata')
      .eq('id', batchId)
      .eq('created_by', user.id)
      .eq('status', 'processing')
      .single()

    if (batchError || !batch) {
      return { success: false, error: 'ไม่พบ import batch หรือ batch ไม่อยู่ในสถานะ processing' }
    }

    const meta = batch.metadata as Record<string, unknown>
    const campaignType = meta?.adsType as 'product' | 'live'
    if (!campaignType) {
      return { success: false, error: 'ไม่พบ campaign type ใน batch metadata' }
    }

    // 3. Verify ADS wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, name, wallet_type')
      .eq('id', adsWalletId)
      .single()

    if (walletError || !wallet) {
      return { success: false, error: 'ไม่พบ wallet ที่เลือก' }
    }
    if (wallet.wallet_type !== 'ADS') {
      return { success: false, error: 'Performance Ads import ต้องใช้กับ ADS Wallet เท่านั้น' }
    }

    // 4. Fetch all staging rows for this batch
    const { data: stagingRows, error: stagingError } = await supabase
      .from('ad_import_staging_rows')
      .select('ad_date, campaign_name, spend, gmv, orders, roas')
      .eq('batch_id', batchId)
      .order('row_index')

    if (stagingError || !stagingRows?.length) {
      return { success: false, error: 'ไม่พบ staging rows สำหรับ batch นี้' }
    }
    const rowsWithDate = stagingRows.filter((row) => !!row.ad_date).length
    const rowsWithCampaign = stagingRows.filter((row) => !!row.campaign_name).length
    const rowsWithSpend = stagingRows.filter((row) => Number(row.spend) > 0).length
    const rowsWithRevenue = stagingRows.filter((row) => Number(row.gmv) > 0).length
    const rowsWithOrders = stagingRows.filter((row) => Number(row.orders) > 0).length
    console.log('[AdsImport][Confirm] staging-stats', {
      batchId,
      campaignType,
      stagingRowsCount: stagingRows.length,
      rowsWithDate,
      rowsWithCampaign,
      rowsWithSpend,
      rowsWithRevenue,
      rowsWithOrders,
    })

    // 5. Upsert ad_daily_performance in chunks
    let perfInsertedCount = 0
    let fallbackChunkCount = 0
    const perfErrors: string[] = []
    const CHUNK = 500
    for (let i = 0; i < stagingRows.length; i += CHUNK) {
      const chunk = stagingRows.slice(i, i + CHUNK)
      const perfRows: PerformanceUpsertRow[] = chunk.map((row) => ({
        created_by: user.id,
        marketplace: 'tiktok',
        ad_date: String(row.ad_date),
        campaign_type: campaignType,
        campaign_name: row.campaign_name,
        campaign_id: null,
        video_id: null,
        spend: Number(row.spend) || 0,
        orders: Number(row.orders) || 0,
        revenue: Number(row.gmv) || 0,
        roi: Number(row.roas) || 0,
        source_row_hash: makeSourceRowHash({
          campaignName: row.campaign_name,
          spend: Number(row.spend) || 0,
          orders: Number(row.orders) || 0,
          revenue: Number(row.gmv) || 0,
        }),
        source: 'imported',
        import_batch_id: batchId,
      }))

      console.log('[AdsImport][Confirm] perf-chunk-prepared', {
        batchId,
        chunkStart: i,
        chunkSize: perfRows.length,
      })

      const result = await upsertPerformanceChunkWithFallback(supabase, user.id, perfRows)
      if (!result.ok) {
        perfErrors.push(`chunk ${Math.floor(i / CHUNK) + 1}: ${result.error ?? 'unknown error'}`)
        console.error('[AdsImport][Confirm] perf-chunk-failed', {
          batchId,
          chunkStart: i,
          chunkSize: perfRows.length,
          error: result.error,
        })
        continue
      }

      if (result.mode === 'fallback') fallbackChunkCount++
      perfInsertedCount += result.insertedCount
      console.log('[AdsImport][Confirm] perf-chunk-upserted', {
        batchId,
        chunkStart: i,
        chunkSize: perfRows.length,
        mode: result.mode,
      })
    }

    if (perfErrors.length > 0 || perfInsertedCount === 0) {
      const reason =
        perfErrors.length > 0
          ? `Performance upsert failed (${perfErrors.join(' | ')})`
          : 'Performance upsert wrote 0 rows'

      await supabase
        .from('import_batches')
        .update({
          status: 'error',
          inserted_count: 0,
          error_count: stagingRows.length,
          notes: reason.slice(0, 500),
        })
        .eq('id', batchId)

      return {
        success: false,
        error: reason,
      }
    }

    // 6. Aggregate spend per day
    const dailySpendMap = new Map<string, number>()
    for (const row of stagingRows) {
      const key = String(row.ad_date)
      dailySpendMap.set(key, (dailySpendMap.get(key) ?? 0) + Number(row.spend))
    }

    let walletInsertedCount = 0
    console.log('[AdsImport][Confirm] wallet-aggregation', {
      batchId,
      walletDaysCount: dailySpendMap.size,
    })
    for (const [date, totalSpend] of Array.from(dailySpendMap.entries())) {
      const note = `${campaignType === 'product' ? 'Product' : 'Live'} Ads Spend - ${date}`
      const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
        wallet_id: adsWalletId,
        date,
        entry_type: 'SPEND',
        direction: 'OUT',
        amount: Math.round(totalSpend * 100) / 100,
        source: 'IMPORTED',
        import_batch_id: batchId,
        reference_id: batch.file_name,
        note,
        created_by: user.id,
      })
      if (ledgerError) {
        console.error('Error creating wallet_ledger entry:', ledgerError)
      } else {
        walletInsertedCount++
      }
    }

    // 7. Mark batch as success
    await supabase
      .from('import_batches')
      .update({
        status: 'success',
        inserted_count: perfInsertedCount,
        notes: `Performance: ${perfInsertedCount} records, Wallet: ${walletInsertedCount} entries, Total: ${meta.totalSpend} ${meta.currency}${fallbackChunkCount > 0 ? ` (fallback chunks: ${fallbackChunkCount})` : ''}`,
      })
      .eq('id', batchId)

    // 8. Delete staging rows (cleanup)
    await supabase
      .from('ad_import_staging_rows')
      .delete()
      .eq('batch_id', batchId)
      .eq('created_by', user.id)

    return {
      success: true,
      data: {
        batchId,
        performanceRecords: perfInsertedCount,
        walletEntries: walletInsertedCount,
        totalSpend: meta.totalSpend,
        totalGMV: meta.totalGMV,
        totalOrders: meta.totalOrders,
        avgROAS: meta.avgROAS,
        daysCount: meta.daysCount,
      },
    }
  } catch (error) {
    console.error('Unexpected error in confirmAdsImport:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    }
  }
}

// ─── Notification: Multi-file import complete ──────────────────────────────────

/**
 * Create a bell notification after a background multi-file ads import completes.
 * Called when the dialog was closed before processing finished.
 */
export async function createAdsImportNotification(
  results: Array<{
    fileName: string
    status: 'done' | 'error'
    spend?: number
    gmv?: number
    orders?: number
    batchId?: string
    error?: string
  }>
): Promise<void> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return

    const done = results.filter((r) => r.status === 'done')
    const failed = results.filter((r) => r.status === 'error')
    const totalSpend = done.reduce((s, r) => s + (r.spend ?? 0), 0)
    const totalGMV = done.reduce((s, r) => s + (r.gmv ?? 0), 0)
    const totalOrders = done.reduce((s, r) => s + (r.orders ?? 0), 0)

    const fmt = (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

    const title = `Import Ads เสร็จสิ้น — ${done.length}/${results.length} ไฟล์`
    const bodyParts = [
      `Spend: ${fmt(totalSpend)} THB`,
      `GMV: ${fmt(totalGMV)} THB`,
      `Orders: ${totalOrders}`,
      failed.length > 0 ? `${failed.length} ไฟล์ล้มเหลว` : null,
    ].filter(Boolean)
    const body = bodyParts.join(' | ')

    const firstBatchId = done.find((r) => r.batchId)?.batchId ?? user.id

    const { error } = await supabase.from('notifications').insert({
      created_by: user.id,
      type: 'ads_import',
      title,
      body,
      entity_type: 'ads_import',
      entity_id: firstBatchId,
      is_read: false,
    })

    if (error) {
      console.error('createAdsImportNotification error:', error)
    }
  } catch (err) {
    console.error('Unexpected error in createAdsImportNotification:', err)
  }
}


