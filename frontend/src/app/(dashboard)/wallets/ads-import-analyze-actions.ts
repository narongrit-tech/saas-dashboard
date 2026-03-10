'use server'

/**
 * Ads Import Analyze Actions
 *
 * analyzeAdsImportFile — DB read only (no staging). Returns a suggestion per file:
 *   SKIP   — identical file_hash already imported successfully
 *   REPLACE — same scope key OR full date overlap found → safe to roll back + re-import
 *   REVIEW — partial date overlap → user must choose
 *   APPEND  — no overlap → safe to add alongside existing data
 *
 * rollbackBatches — calls rollback_import_batch RPC for each old batch ID
 *                   used before REPLACE imports to clear old data cleanly
 */

import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExistingBatchInfo {
  id: string
  fileName: string
  dateMin: string | null
  dateMax: string | null
  scopeKey: string | null
  status: string
  createdAt: string
  totalSpend: number | null
}

export interface AnalyzeResult {
  suggestion: 'APPEND' | 'REPLACE' | 'SKIP' | 'REVIEW'
  reason: string
  scopeKey: string
  existingBatches: ExistingBatchInfo[]
}

export interface AnalyzeInput {
  fileHash: string
  campaignType: 'product' | 'live'
  dateStart: string   // YYYY-MM-DD (first date in parsed daily breakdown)
  dateEnd: string     // YYYY-MM-DD (last date in parsed daily breakdown)
}

// ─── analyzeAdsImportFile ─────────────────────────────────────────────────────

/**
 * Analyze a single ads file against existing successful imports.
 * DB read only — no writes, no staging.
 */
export async function analyzeAdsImportFile(
  input: AnalyzeInput
): Promise<AnalyzeResult> {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    // Return APPEND as safe fallback — actual auth check happens in createAdsImportPreview
    return {
      suggestion: 'APPEND',
      reason: 'ไม่สามารถตรวจสอบได้ — กรุณา login ใหม่',
      scopeKey: '',
      existingBatches: [],
    }
  }

  const { fileHash, campaignType, dateStart, dateEnd } = input
  const reportType = `tiktok_ads_${campaignType}` as const
  const scopeKey = `ads:tiktok:${campaignType}:${dateStart}:${dateEnd}`

  // ── Step 1: File hash dedup check (exact same file already imported) ─────────
  const { data: hashMatch } = await supabase
    .from('import_batches')
    .select('id, file_name, date_min, date_max, import_scope_key, status, created_at, metadata')
    .eq('file_hash', fileHash)
    .eq('report_type', reportType)
    .eq('created_by', user.id)
    .eq('status', 'success')
    .maybeSingle()

  if (hashMatch) {
    return {
      suggestion: 'SKIP',
      reason: `ไฟล์นี้ถูก import แล้ว (${hashMatch.file_name ?? 'ไม่ทราบชื่อ'} — ${hashMatch.date_min ?? '?'} ถึง ${hashMatch.date_max ?? '?'})`,
      scopeKey,
      existingBatches: [
        {
          id: hashMatch.id,
          fileName: hashMatch.file_name ?? '',
          dateMin: hashMatch.date_min,
          dateMax: hashMatch.date_max,
          scopeKey: hashMatch.import_scope_key,
          status: hashMatch.status,
          createdAt: hashMatch.created_at,
          totalSpend: (hashMatch.metadata as Record<string, unknown> | null)?.totalSpend as number | null ?? null,
        },
      ],
    }
  }

  // ── Step 2: Scope key match (same campaign type + exact date range) ──────────
  const { data: scopeMatches } = await supabase
    .from('import_batches')
    .select('id, file_name, date_min, date_max, import_scope_key, status, created_at, metadata')
    .eq('import_scope_key', scopeKey)
    .eq('created_by', user.id)
    .eq('status', 'success')

  if (scopeMatches && scopeMatches.length > 0) {
    return {
      suggestion: 'REPLACE',
      reason: `มีข้อมูล import สำหรับช่วงวันที่เดียวกัน (${dateStart} ถึง ${dateEnd}) อยู่แล้ว — จะ rollback และ import ใหม่`,
      scopeKey,
      existingBatches: scopeMatches.map((b) => ({
        id: b.id,
        fileName: b.file_name ?? '',
        dateMin: b.date_min,
        dateMax: b.date_max,
        scopeKey: b.import_scope_key,
        status: b.status,
        createdAt: b.created_at,
        totalSpend: (b.metadata as Record<string, unknown> | null)?.totalSpend as number | null ?? null,
      })),
    }
  }

  // ── Step 3: Date overlap detection ──────────────────────────────────────────
  const { data: overlapBatches } = await supabase
    .from('import_batches')
    .select('id, file_name, date_min, date_max, import_scope_key, status, created_at, metadata')
    .eq('report_type', reportType)
    .eq('created_by', user.id)
    .eq('status', 'success')
    .lte('date_min', dateEnd)
    .gte('date_max', dateStart)

  if (!overlapBatches || overlapBatches.length === 0) {
    return {
      suggestion: 'APPEND',
      reason: 'ไม่มีข้อมูลซ้อนทับ — สามารถ import เพิ่มได้',
      scopeKey,
      existingBatches: [],
    }
  }

  const existingBatchInfos: ExistingBatchInfo[] = overlapBatches.map((b) => ({
    id: b.id,
    fileName: b.file_name ?? '',
    dateMin: b.date_min,
    dateMax: b.date_max,
    scopeKey: b.import_scope_key,
    status: b.status,
    createdAt: b.created_at,
    totalSpend: (b.metadata as Record<string, unknown> | null)?.totalSpend as number | null ?? null,
  }))

  // Check if any existing batch fully covers the new file's date range
  const fullCoverBatch = overlapBatches.find(
    (b) => b.date_min != null && b.date_max != null &&
      b.date_min <= dateStart && b.date_max >= dateEnd
  )

  if (fullCoverBatch) {
    return {
      suggestion: 'REPLACE',
      reason: `ช่วงวันที่ (${dateStart} – ${dateEnd}) ถูกครอบคลุมโดย batch ที่มีอยู่แล้ว — จะ rollback และ import ใหม่`,
      scopeKey,
      existingBatches: existingBatchInfos,
    }
  }

  // Partial overlap
  return {
    suggestion: 'REVIEW',
    reason: `พบข้อมูลซ้อนทับบางส่วน (${overlapBatches.length} batch) — กรุณาตรวจสอบและเลือก APPEND หรือ REPLACE`,
    scopeKey,
    existingBatches: existingBatchInfos,
  }
}

// ─── rollbackBatches ──────────────────────────────────────────────────────────

export interface RollbackResult {
  success: boolean
  results: Array<{ batchId: string; ok: boolean; error?: string }>
}

/**
 * Roll back multiple import batches before a REPLACE import.
 * Calls rollback_import_batch RPC (SECURITY DEFINER, uses auth.uid()).
 */
export async function rollbackBatches(batchIds: string[]): Promise<RollbackResult> {
  if (batchIds.length === 0) {
    return { success: true, results: [] }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      success: false,
      results: batchIds.map((id) => ({
        batchId: id,
        ok: false,
        error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่',
      })),
    }
  }

  const results: Array<{ batchId: string; ok: boolean; error?: string }> = []
  let allOk = true

  for (const batchId of batchIds) {
    const { data, error } = await supabase.rpc('rollback_import_batch', {
      p_batch_id: batchId,
    })

    if (error) {
      results.push({ batchId, ok: false, error: error.message })
      allOk = false
      continue
    }

    const result = data as { success: boolean; error?: string } | null
    if (!result?.success) {
      results.push({ batchId, ok: false, error: result?.error ?? 'rollback ล้มเหลว' })
      allOk = false
    } else {
      results.push({ batchId, ok: true })
    }
  }

  return { success: allOk, results }
}
