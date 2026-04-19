export type TikTokStudioImportStatus = 'ready' | 'empty' | 'error'
export type TikTokStudioCompletionStatus = 'completed' | 'stopped'
export type TikTokStudioStopReason =
  | 'max_rows_reached'
  | 'max_scroll_rounds_reached'
  | 'no_new_rows_limit_reached'
export type TikTokStudioImportSource =
  | 'local_registry'
  | 'sample_fallback'
  | 'shared_source'
  | 'missing'

export interface TikTokStudioContentItem {
  post_url: string
  post_id: string | null
  platform: 'tiktok'
  caption: string
  created_at: string | null
  first_seen_at: string
  last_seen_at: string
  latest_snapshot_id: string
}

export interface TikTokStudioContentMetricSnapshot {
  snapshot_id: string
  snapshot_row_index: number
  post_url: string
  platform: 'tiktok'
  scraped_at: string
  privacy: string | null
  views_total: number | null
  likes_total: number | null
  comments_total: number | null
  is_pinned: boolean
  duration: string | null
}

export interface TikTokStudioSnapshotManifestEntry {
  snapshot_id: string
  source: 'tiktok_studio_visible_rows'
  snapshot_version: number
  page_url: string
  scraped_at: string
  row_count: number
  content_item_count: number
  metric_snapshot_count: number
  harvested_batch_count?: number
  completion_status?: TikTokStudioCompletionStatus
  stop_reason?: TikTokStudioStopReason
  extraction_scope?: 'visible_rows_only' | 'multi_batch_scroll'
  dedupe_key: 'post_url'
  import_status: TikTokStudioImportStatus
  raw_snapshot_path: string
  normalized_content_items_path: string
  normalized_metric_snapshots_path: string
}

export interface TikTokStudioSnapshotManifest {
  source: 'tiktok_studio_snapshot_registry'
  manifest_version: number
  generated_at: string
  latest_snapshot_id: string | null
  dedupe_key: 'post_url'
  total_snapshots: number
  total_content_items: number
  total_metric_snapshots: number
  global_content_items_path: string
  global_metric_snapshots_path: string
  snapshots: TikTokStudioSnapshotManifestEntry[]
}

export interface TikTokStudioImportedContentRecord extends TikTokStudioContentItem {
  latest_metrics: TikTokStudioContentMetricSnapshot | null
}

export interface TikTokStudioLatestImport {
  status: TikTokStudioImportStatus
  errorMessage: string | null
  source: TikTokStudioImportSource
  registryRoot: string | null
  manifestPath: string | null
  manifest: TikTokStudioSnapshotManifest | null
  latestSnapshot: TikTokStudioSnapshotManifestEntry | null
  rawSnapshotPath: string | null
  snapshotContentItemsPath: string | null
  snapshotMetricSnapshotsPath: string | null
  snapshotHistory: TikTokStudioSnapshotManifestEntry[]
  items: TikTokStudioImportedContentRecord[]
}
