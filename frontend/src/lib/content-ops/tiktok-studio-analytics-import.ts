/**
 * TikTok Studio Analytics — Import Layer
 *
 * Consumes JSON snapshot files produced by the TikTok Studio analytics scraper.
 * Each file is an array of analytics rows, one per video, captured at a point in time.
 *
 * DB tables:
 *   tiktok_studio_analytics_batches
 *   tiktok_studio_analytics_rows
 *
 * Join key to video perf data:
 *   tiktok_studio_analytics_rows.post_id = tiktok_video_perf_stats.video_id_raw
 *
 * Uses createServiceClient (service role) — bypasses RLS for server-side writes.
 * Auth is verified by the calling API route before this module is invoked.
 */

import crypto from 'node:crypto'

import { createServiceClient } from '../supabase/service'

// ─── Raw row shape (from JSON file) ──────────────────────────────────────────

interface RawAnalyticsRow {
  snapshot_id?: unknown
  post_id?: unknown
  scraped_at?: unknown
  post_url?: unknown
  video_title?: unknown
  caption?: unknown
  posted_at_raw?: unknown
  posted_at?: unknown
  updated_at_raw?: unknown
  updated_at?: unknown
  headline_video_views?: unknown
  headline_likes_total?: unknown
  headline_comments_total?: unknown
  headline_shares_total?: unknown
  headline_saves_total?: unknown
  total_play_time_seconds?: unknown
  average_watch_time_seconds?: unknown
  watched_full_video_rate?: unknown
  new_followers?: unknown
  est_rewards_amount?: unknown
  retention_rate_note?: unknown
  traffic_sources?: unknown
  [key: string]: unknown
}

// ─── Normalized row ───────────────────────────────────────────────────────────

export interface NormalizedStudioAnalyticsRow {
  snapshotId: string
  postId: string
  scrapedAt: string
  postUrl: string | null
  videoTitle: string | null
  caption: string | null
  postedAtRaw: string | null
  postedAt: string | null
  updatedAtRaw: string | null
  updatedAt: string | null
  headlineVideoViews: number | null
  headlineLikesTotal: number | null
  headlineCommentsTotal: number | null
  headlineSharesTotal: number | null
  headlineSavesTotal: number | null
  totalPlayTimeSeconds: number | null
  averageWatchTimeSeconds: number | null
  watchedFullVideoRate: number | null  // 0–1 decimal (raw % ÷ 100)
  newFollowers: number | null
  estRewardsAmount: number | null
  retentionRateNote: string | null
  trafficSources: Array<{ name: string; share_raw: string; share: number }> | null
  rawPayload: Record<string, unknown>
}

// ─── Parse result ─────────────────────────────────────────────────────────────

export interface StudioAnalyticsParseResult {
  ok: boolean
  rows: NormalizedStudioAnalyticsRow[]
  invalidRowCount: number
  snapshotId: string | null
  scrapedAt: string | null
  parseErrors: string[]
}

// ─── Preview / Import result types ───────────────────────────────────────────

export interface StudioAnalyticsPreviewResult {
  ok: boolean
  stage: 'preview'
  fileName: string
  fileHash: string
  isDuplicateFile: boolean
  existingBatchId: string | null
  snapshotId: string | null
  scrapedAt: string | null
  rowCount: number
  invalidRowCount: number
  sampleRows: NormalizedStudioAnalyticsRow[]
  parseErrors: string[]
}

export interface StudioAnalyticsImportResult {
  ok: boolean
  stage: string
  batchId: string
  fileName: string
  fileHash: string
  isDuplicateFile: boolean
  existingBatchId: string | null
  snapshotId: string | null
  scrapedAt: string | null
  rowCount: number
  insertedCount: number
  invalidRowCount: number
  batchStatus: string
  errors?: Array<{ code: string; message: string; stage?: string }>
}

// ─── DB row type ──────────────────────────────────────────────────────────────

type DbRow = {
  created_by: string
  import_batch_id: string
  snapshot_id: string
  scraped_at: string
  post_id: string
  post_url: string | null
  video_title: string | null
  caption: string | null
  posted_at_raw: string | null
  posted_at: string | null
  updated_at_raw: string | null
  updated_at: string | null
  headline_video_views: number | null
  headline_likes_total: number | null
  headline_comments_total: number | null
  headline_shares_total: number | null
  headline_saves_total: number | null
  total_play_time_seconds: number | null
  average_watch_time_seconds: number | null
  watched_full_video_rate: number | null
  new_followers: number | null
  est_rewards_amount: number | null
  retention_rate_note: string | null
  traffic_sources: unknown
  raw_payload: Record<string, unknown>
  source_row_number: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' ? v : String(v)
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? null : n
}

function toDbRow(
  row: NormalizedStudioAnalyticsRow,
  batchId: string,
  createdBy: string,
  index: number
): DbRow {
  return {
    created_by: createdBy,
    import_batch_id: batchId,
    snapshot_id: row.snapshotId,
    scraped_at: row.scrapedAt,
    post_id: row.postId,
    post_url: row.postUrl,
    video_title: row.videoTitle,
    caption: row.caption,
    posted_at_raw: row.postedAtRaw,
    posted_at: row.postedAt,
    updated_at_raw: row.updatedAtRaw,
    updated_at: row.updatedAt,
    headline_video_views: row.headlineVideoViews,
    headline_likes_total: row.headlineLikesTotal,
    headline_comments_total: row.headlineCommentsTotal,
    headline_shares_total: row.headlineSharesTotal,
    headline_saves_total: row.headlineSavesTotal,
    total_play_time_seconds: row.totalPlayTimeSeconds,
    average_watch_time_seconds: row.averageWatchTimeSeconds,
    watched_full_video_rate: row.watchedFullVideoRate,
    new_followers: row.newFollowers,
    est_rewards_amount: row.estRewardsAmount,
    retention_rate_note: row.retentionRateNote,
    traffic_sources: row.trafficSources ?? null,
    raw_payload: row.rawPayload,
    source_row_number: index,
  }
}

const CHUNK_SIZE = 500

async function insertRows(
  supabase: ReturnType<typeof createServiceClient>,
  rows: DbRow[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const { error } = await supabase.from('tiktok_studio_analytics_rows').insert(chunk)
    if (error) {
      throw new Error(`Staging insert failed (chunk ${Math.floor(i / CHUNK_SIZE) + 1}): ${error.message}`)
    }
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseStudioAnalyticsFile(buf: Buffer): StudioAnalyticsParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(buf.toString('utf-8'))
  } catch (e) {
    return {
      ok: false,
      rows: [],
      invalidRowCount: 0,
      snapshotId: null,
      scrapedAt: null,
      parseErrors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      rows: [],
      invalidRowCount: 0,
      snapshotId: null,
      scrapedAt: null,
      parseErrors: ['Expected a JSON array at root level'],
    }
  }

  const rows: NormalizedStudioAnalyticsRow[] = []
  const parseErrors: string[] = []
  let invalidRowCount = 0
  let snapshotId: string | null = null
  let scrapedAt: string | null = null

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as RawAnalyticsRow
    const rowLabel = `row ${i + 1}`

    const postId = str(raw.post_id)
    const snapshotIdVal = str(raw.snapshot_id)
    const scrapedAtVal = str(raw.scraped_at)

    if (!postId) {
      parseErrors.push(`${rowLabel}: missing post_id — skipped`)
      invalidRowCount++
      continue
    }
    if (!scrapedAtVal) {
      parseErrors.push(`${rowLabel}: missing scraped_at (post_id=${postId}) — skipped`)
      invalidRowCount++
      continue
    }

    if (!snapshotId && snapshotIdVal) snapshotId = snapshotIdVal
    if (!scrapedAt) scrapedAt = scrapedAtVal

    const watchedRaw = num(raw.watched_full_video_rate)

    rows.push({
      snapshotId: snapshotIdVal ?? snapshotId ?? '',
      postId,
      scrapedAt: scrapedAtVal,
      postUrl: str(raw.post_url),
      videoTitle: str(raw.video_title),
      caption: str(raw.caption),
      postedAtRaw: str(raw.posted_at_raw),
      postedAt: str(raw.posted_at),
      updatedAtRaw: str(raw.updated_at_raw),
      updatedAt: str(raw.updated_at),
      headlineVideoViews: num(raw.headline_video_views),
      headlineLikesTotal: num(raw.headline_likes_total),
      headlineCommentsTotal: num(raw.headline_comments_total),
      headlineSharesTotal: num(raw.headline_shares_total),
      headlineSavesTotal: num(raw.headline_saves_total),
      totalPlayTimeSeconds: num(raw.total_play_time_seconds),
      averageWatchTimeSeconds: num(raw.average_watch_time_seconds),
      watchedFullVideoRate: watchedRaw !== null ? parseFloat((watchedRaw / 100).toFixed(6)) : null,
      newFollowers: num(raw.new_followers),
      estRewardsAmount: num(raw.est_rewards_amount),
      retentionRateNote: str(raw.retention_rate_note),
      trafficSources: Array.isArray(raw.traffic_sources)
        ? (raw.traffic_sources as Array<{ name: string; share_raw: string; share: number }>)
        : null,
      rawPayload: raw as Record<string, unknown>,
    })
  }

  return {
    ok: true,
    rows,
    invalidRowCount,
    snapshotId,
    scrapedAt,
    parseErrors,
  }
}

// ─── Preview (no DB writes) ───────────────────────────────────────────────────

export async function previewStudioAnalyticsFile(
  fileBuffer: Buffer,
  fileName: string,
  createdBy: string
): Promise<StudioAnalyticsPreviewResult> {
  const supabase = createServiceClient()
  const fileHash = sha256(fileBuffer)

  const { data: existing } = await supabase
    .from('tiktok_studio_analytics_batches')
    .select('id')
    .eq('created_by', createdBy)
    .eq('source_file_hash', fileHash)
    .eq('status', 'staged')
    .limit(1)
    .maybeSingle()

  const parsed = parseStudioAnalyticsFile(fileBuffer)

  return {
    ok: parsed.ok,
    stage: 'preview',
    fileName,
    fileHash,
    isDuplicateFile: Boolean(existing),
    existingBatchId: existing?.id ?? null,
    snapshotId: parsed.snapshotId,
    scrapedAt: parsed.scrapedAt,
    rowCount: parsed.rows.length,
    invalidRowCount: parsed.invalidRowCount,
    sampleRows: parsed.rows.slice(0, 5),
    parseErrors: parsed.parseErrors,
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

export async function importStudioAnalyticsFile(
  fileBuffer: Buffer,
  fileName: string,
  createdBy: string
): Promise<StudioAnalyticsImportResult> {
  const supabase = createServiceClient()
  const fileHash = sha256(fileBuffer)

  // ── 1. Parse ──────────────────────────────────────────────────────────────
  const parsed = parseStudioAnalyticsFile(fileBuffer)

  if (!parsed.ok) {
    return {
      ok: false,
      stage: 'parse',
      batchId: '',
      fileName,
      fileHash,
      isDuplicateFile: false,
      existingBatchId: null,
      snapshotId: null,
      scrapedAt: null,
      rowCount: 0,
      insertedCount: 0,
      invalidRowCount: 0,
      batchStatus: 'failed',
      errors: [{ code: 'PARSE_FAILED', message: parsed.parseErrors[0] ?? 'Parser returned ok:false', stage: 'parse' }],
    }
  }

  // ── 2. Check duplicate file ───────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('tiktok_studio_analytics_batches')
    .select('id')
    .eq('created_by', createdBy)
    .eq('source_file_hash', fileHash)
    .eq('status', 'staged')
    .limit(1)
    .maybeSingle()

  const isDuplicateFile = Boolean(existing)
  const existingBatchId: string | null = existing?.id ?? null

  // ── 3. Create batch ───────────────────────────────────────────────────────
  const { data: batch, error: batchError } = await supabase
    .from('tiktok_studio_analytics_batches')
    .insert({
      created_by: createdBy,
      snapshot_id: parsed.snapshotId,
      source_file_name: fileName,
      source_file_hash: fileHash,
      scraped_at: parsed.scrapedAt,
      status: 'processing',
      raw_row_count: parsed.rows.length + parsed.invalidRowCount,
      staged_row_count: 0,
      invalid_row_count: parsed.invalidRowCount,
      metadata: {
        isDuplicateFile,
        existingBatchId,
        parseErrorCount: parsed.parseErrors.length,
      },
    })
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
      snapshotId: parsed.snapshotId,
      scrapedAt: parsed.scrapedAt,
      rowCount: parsed.rows.length,
      insertedCount: 0,
      invalidRowCount: parsed.invalidRowCount,
      batchStatus: 'failed',
      errors: [{ code: 'BATCH_CREATE_FAILED', message: batchError?.message ?? 'Failed to create batch', stage: 'batch_create' }],
    }
  }

  const batchId = batch.id

  // ── 4. Insert rows + finalize ─────────────────────────────────────────────
  try {
    if (parsed.rows.length > 0) {
      const dbRows = parsed.rows.map((row, i) => toDbRow(row, batchId, createdBy, i + 1))
      await insertRows(supabase, dbRows)
    }

    await supabase
      .from('tiktok_studio_analytics_batches')
      .update({ status: 'staged', staged_row_count: parsed.rows.length })
      .eq('id', batchId)

    return {
      ok: true,
      stage: 'finalize',
      batchId,
      fileName,
      fileHash,
      isDuplicateFile,
      existingBatchId,
      snapshotId: parsed.snapshotId,
      scrapedAt: parsed.scrapedAt,
      rowCount: parsed.rows.length,
      insertedCount: parsed.rows.length,
      invalidRowCount: parsed.invalidRowCount,
      batchStatus: 'staged',
      errors: parsed.parseErrors.length > 0
        ? parsed.parseErrors.map(msg => ({ code: 'PARSE_WARNING', message: msg }))
        : undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown insert error'

    await supabase
      .from('tiktok_studio_analytics_batches')
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
      snapshotId: parsed.snapshotId,
      scrapedAt: parsed.scrapedAt,
      rowCount: parsed.rows.length,
      insertedCount: 0,
      invalidRowCount: parsed.invalidRowCount,
      batchStatus: 'failed',
      errors: [{ code: 'INSERT_FAILED', message, stage: 'insert' }],
    }
  }
}
