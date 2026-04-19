/**
 * TikTok Video Performance Export — Import Layer
 *
 * Consumes ParseResult from tiktok-video-performance-export.ts.
 * Handles: preview, batch creation, staging insert, status finalization.
 *
 * Stage separation:
 *   parse → validate (done by parser)
 *   preview → batch_create → insert → finalize (this module)
 *
 * DB tables:
 *   tiktok_video_perf_import_batches
 *   tiktok_video_perf_stats
 *
 * Uses createServiceClient (service role) — bypasses RLS for server-side writes.
 * Auth is verified by the calling API route before this module is invoked.
 */

import crypto from 'node:crypto'

import { createServiceClient } from '../supabase/service'
import { syncPerfStatsBatch } from './video-master-sync'
import {
  parseTikTokVideoPerformanceExport,
  type NormalizedTikTokVideoStatRow,
  type ParseError,
  type ParseMeta,
  type TikTokVideoPerformanceParseOptions,
} from './tiktok-video-performance-export'

// ─── Preview types ────────────────────────────────────────────────────────────

export interface TikTokVideoPerformancePreviewResult {
  ok: boolean
  stage: 'preview'
  fileName: string
  fileHash: string
  isDuplicateFile: boolean
  existingBatchId: string | null
  sheetName: string | undefined
  dateRangeRaw: string | undefined
  headerRowIndex: number
  detectedHeaders: string[]
  rowCount: number
  invalidRowCount: number
  duplicateVideoIdCount: number
  duplicateVideoIds: string[]
  sampleRows: NormalizedTikTokVideoStatRow[]
  parseErrors: ParseError[] | undefined
  meta: ParseMeta
}

// ─── Import types ─────────────────────────────────────────────────────────────

export interface TikTokVideoPerformanceImportResult {
  ok: boolean
  stage: string
  batchId: string
  fileName: string
  fileHash: string
  isDuplicateFile: boolean
  existingBatchId: string | null
  sheetName: string | undefined
  dateRangeRaw: string | undefined
  rowCount: number
  insertedCount: number
  invalidRowCount: number
  duplicateVideoIdCount: number
  duplicateVideoIds: string[]
  batchStatus: string
  errors?: Array<{ code: string; message: string; stage?: string }>
}

// ─── Internal DB row types ────────────────────────────────────────────────────

type BatchInsert = {
  created_by: string
  source_platform: string
  source_report_type: string
  source_file_name: string
  source_sheet_name: string
  source_file_hash: string
  date_range_raw: string | null
  status: string
  raw_row_count: number
  staged_row_count: number
  invalid_row_count: number
  duplicate_video_id_count: number
  metadata: Record<string, unknown>
}

type StatRowInsert = {
  created_by: string
  import_batch_id: string
  source: string
  source_file: string
  video_id_raw: string
  video_title: string
  posted_at_raw: string
  posted_at: string | null
  duration_raw: string | null
  duration_sec: number | null
  gmv_total_raw: string | null
  gmv_total: number | null
  gmv_direct_raw: string | null
  gmv_direct: number | null
  views_raw: string | null
  views: number | null
  units_sold_raw: string | null
  units_sold: number | null
  ctr_raw: string | null
  ctr: number | null
  watch_full_rate_raw: string | null
  watch_full_rate: number | null
  new_followers_raw: string | null
  new_followers: number | null
  raw_payload: Record<string, unknown>
  source_row_number: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function nullable<T>(v: T | undefined): T | null {
  return v === undefined ? null : v
}

function toStatRow(
  row: NormalizedTikTokVideoStatRow,
  batchId: string,
  createdBy: string,
  fileName: string,
  rowIndex: number
): StatRowInsert {
  return {
    created_by: createdBy,
    import_batch_id: batchId,
    source: 'tiktok_video_performance_export',
    source_file: fileName,
    video_id_raw: row.videoIdRaw,
    video_title: row.videoTitle,
    posted_at_raw: row.postedAtRaw,
    posted_at: nullable(row.postedAt),
    duration_raw: nullable(row.durationRaw) || null,
    duration_sec: nullable(row.durationSec),
    gmv_total_raw: nullable(row.gmvTotalRaw),
    gmv_total: nullable(row.gmvTotal),
    gmv_direct_raw: nullable(row.gmvDirectRaw),
    gmv_direct: nullable(row.gmvDirect),
    views_raw: nullable(row.viewsRaw),
    views: nullable(row.views),
    units_sold_raw: nullable(row.unitsSoldRaw),
    units_sold: nullable(row.unitsSold),
    ctr_raw: nullable(row.ctrRaw),
    ctr: nullable(row.ctr),
    watch_full_rate_raw: nullable(row.watchFullRateRaw),
    watch_full_rate: nullable(row.watchFullRate),
    new_followers_raw: nullable(row.newFollowersRaw),
    new_followers: nullable(row.newFollowers),
    raw_payload: {
      videoIdRaw: row.videoIdRaw,
      videoTitle: row.videoTitle,
      postedAtRaw: row.postedAtRaw,
      durationRaw: row.durationRaw,
      gmvTotalRaw: row.gmvTotalRaw,
      gmvDirectRaw: row.gmvDirectRaw,
      viewsRaw: row.viewsRaw,
      unitsSoldRaw: row.unitsSoldRaw,
      ctrRaw: row.ctrRaw,
      watchFullRateRaw: row.watchFullRateRaw,
      newFollowersRaw: row.newFollowersRaw,
    },
    source_row_number: rowIndex,
  }
}

const CHUNK_SIZE = 500

async function insertStatRows(
  supabase: ReturnType<typeof createServiceClient>,
  rows: StatRowInsert[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const { error } = await supabase.from('tiktok_video_perf_stats').insert(chunk)
    if (error) {
      throw new Error(`Staging insert failed (chunk ${Math.floor(i / CHUNK_SIZE) + 1}): ${error.message}`)
    }
  }
}

// ─── Preview (no DB writes) ───────────────────────────────────────────────────

/**
 * Parse and summarize a file without writing to the database.
 * Returns parse health, duplicate info, and a sample of rows.
 * Safe to call repeatedly — idempotent.
 */
export async function previewTikTokVideoPerformanceFile(
  fileBuffer: Buffer,
  fileName: string,
  createdBy: string,
  options?: TikTokVideoPerformanceParseOptions
): Promise<TikTokVideoPerformancePreviewResult> {
  const supabase = createServiceClient()
  const fileHash = sha256(fileBuffer)

  // Check if this file was already imported by this user
  const { data: existing } = await supabase
    .from('tiktok_video_perf_import_batches')
    .select('id')
    .eq('created_by', createdBy)
    .eq('source_file_hash', fileHash)
    .eq('status', 'staged')
    .limit(1)
    .maybeSingle()

  const parsed = parseTikTokVideoPerformanceExport(fileBuffer, options)

  // Count distinct source rows excluded for missing required fields.
  // One invalid row may produce multiple MISSING_REQUIRED_VALUE errors (one per field),
  // so we deduplicate by row number.
  const invalidRowNumbers = new Set(
    parsed.errors
      ?.filter((e) => e.code === 'MISSING_REQUIRED_VALUE' && e.row !== undefined)
      .map((e) => e.row) ?? []
  )
  const invalidRowCount = invalidRowNumbers.size
  const dupIds = parsed.meta.duplicateVideoIds ?? []

  return {
    ok: parsed.ok,
    stage: 'preview',
    fileName,
    fileHash,
    isDuplicateFile: Boolean(existing),
    existingBatchId: existing?.id ?? null,
    sheetName: parsed.meta.sheetName,
    dateRangeRaw: parsed.meta.dateRangeRaw,
    headerRowIndex: parsed.meta.headerRowIndex,
    detectedHeaders: parsed.meta.detectedHeaders,
    rowCount: parsed.meta.rowCount,
    invalidRowCount,
    duplicateVideoIdCount: dupIds.length,
    duplicateVideoIds: dupIds,
    sampleRows: (parsed.data ?? []).slice(0, 5),
    parseErrors: parsed.errors,
    meta: parsed.meta,
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Full import pipeline:
 *   1. parse
 *   2. validate (done by parser)
 *   3. check duplicate file
 *   4. create batch record (status: processing)
 *   5. insert valid rows into staging (chunked)
 *   6. finalize batch (status: staged)
 *   7. return import summary
 *
 * On any error after batch creation: set batch status to 'failed', then throw.
 */
export async function importTikTokVideoPerformanceFile(
  fileBuffer: Buffer,
  fileName: string,
  createdBy: string,
  options?: TikTokVideoPerformanceParseOptions
): Promise<TikTokVideoPerformanceImportResult> {
  const supabase = createServiceClient()
  const fileHash = sha256(fileBuffer)

  // ── 1. Parse ──────────────────────────────────────────────────────────────
  const parsed = parseTikTokVideoPerformanceExport(fileBuffer, options)

  if (!parsed.ok) {
    const fatalError = parsed.errors?.[0]
    return {
      ok: false,
      stage: 'parse',
      batchId: '',
      fileName,
      fileHash,
      isDuplicateFile: false,
      existingBatchId: null,
      sheetName: parsed.meta.sheetName,
      dateRangeRaw: parsed.meta.dateRangeRaw,
      rowCount: 0,
      insertedCount: 0,
      invalidRowCount: 0,
      duplicateVideoIdCount: 0,
      duplicateVideoIds: [],
      batchStatus: 'failed',
      errors: [
        {
          code: fatalError?.code ?? 'PARSE_FAILED',
          message: fatalError?.message ?? 'Parser returned ok:false',
          stage: 'parse',
        },
      ],
    }
  }

  // ── 2. Check for duplicate file ───────────────────────────────────────────
  const { data: existing } = await supabase
    .from('tiktok_video_perf_import_batches')
    .select('id')
    .eq('created_by', createdBy)
    .eq('source_file_hash', fileHash)
    .eq('status', 'staged')
    .limit(1)
    .maybeSingle()

  const isDuplicateFile = Boolean(existing)
  const existingBatchId: string | null = existing?.id ?? null

  const validRows = parsed.data ?? []
  const invalidRowNumbers = new Set(
    parsed.errors
      ?.filter((e) => e.code === 'MISSING_REQUIRED_VALUE' && e.row !== undefined)
      .map((e) => e.row) ?? []
  )
  const invalidRowCount = invalidRowNumbers.size
  const dupIds = parsed.meta.duplicateVideoIds ?? []

  // ── 3. Create batch record ─────────────────────────────────────────────────
  const batchInsert: BatchInsert = {
    created_by: createdBy,
    source_platform: 'tiktok_creator',
    source_report_type: 'video_performance_export',
    source_file_name: fileName,
    source_sheet_name: parsed.meta.sheetName ?? 'Sheet1',
    source_file_hash: fileHash,
    date_range_raw: parsed.meta.dateRangeRaw ?? null,
    status: 'processing',
    raw_row_count: parsed.meta.rowCount + invalidRowCount,
    staged_row_count: 0,
    invalid_row_count: invalidRowCount,
    duplicate_video_id_count: dupIds.length,
    metadata: {
      detectedHeaders: parsed.meta.detectedHeaders,
      headerRowIndex: parsed.meta.headerRowIndex,
      duplicateVideoIds: dupIds,
      isDuplicateFile,
      existingBatchId,
      parseErrorCount: parsed.errors?.length ?? 0,
    },
  }

  const { data: batch, error: batchError } = await supabase
    .from('tiktok_video_perf_import_batches')
    .insert(batchInsert)
    .select('id')
    .single()

  if (batchError || !batch) {
    return {
      ok: false,
      stage: 'batch_create',
      batchId: '',
      fileName,
      fileHash,
      isDuplicateFile,
      existingBatchId,
      sheetName: parsed.meta.sheetName,
      dateRangeRaw: parsed.meta.dateRangeRaw,
      rowCount: validRows.length,
      insertedCount: 0,
      invalidRowCount,
      duplicateVideoIdCount: dupIds.length,
      duplicateVideoIds: dupIds,
      batchStatus: 'failed',
      errors: [
        {
          code: 'BATCH_CREATE_FAILED',
          message: batchError?.message ?? 'Failed to create import batch record',
          stage: 'batch_create',
        },
      ],
    }
  }

  const batchId = batch.id

  // ── 4. Insert valid rows ───────────────────────────────────────────────────
  try {
    if (validRows.length > 0) {
      const statRows = validRows.map((row, i) =>
        toStatRow(row, batchId, createdBy, fileName, i + 1)
      )
      await insertStatRows(supabase, statRows)
    }

    // ── 5. Finalize batch ──────────────────────────────────────────────────
    await supabase
      .from('tiktok_video_perf_import_batches')
      .update({
        status: 'staged',
        staged_row_count: validRows.length,
      })
      .eq('id', batchId)

    syncPerfStatsBatch(supabase, createdBy, batchId).catch(() => {})

    return {
      ok: true,
      stage: 'finalize',
      batchId,
      fileName,
      fileHash,
      isDuplicateFile,
      existingBatchId,
      sheetName: parsed.meta.sheetName,
      dateRangeRaw: parsed.meta.dateRangeRaw,
      rowCount: validRows.length,
      insertedCount: validRows.length,
      invalidRowCount,
      duplicateVideoIdCount: dupIds.length,
      duplicateVideoIds: dupIds,
      batchStatus: 'staged',
      errors:
        parsed.errors && parsed.errors.length > 0
          ? parsed.errors.map((e) => ({ code: e.code, message: e.message }))
          : undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown insert error'

    await supabase
      .from('tiktok_video_perf_import_batches')
      .update({ status: 'failed', notes: message })
      .eq('id', batchId)

    return {
      ok: false,
      stage: 'insert',
      batchId,
      fileName,
      fileHash,
      isDuplicateFile,
      existingBatchId,
      sheetName: parsed.meta.sheetName,
      dateRangeRaw: parsed.meta.dateRangeRaw,
      rowCount: validRows.length,
      insertedCount: 0,
      invalidRowCount,
      duplicateVideoIdCount: dupIds.length,
      duplicateVideoIds: dupIds,
      batchStatus: 'failed',
      errors: [{ code: 'INSERT_FAILED', message, stage: 'insert' }],
    }
  }
}
