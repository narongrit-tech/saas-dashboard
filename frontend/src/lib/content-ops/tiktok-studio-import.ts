import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

import sampleContentItemsJson from './sample-data/tiktok-studio/normalized/snapshots/studio-sample-2026-04-02T15-38-35-486Z.content-items.json'
import sampleMetricSnapshotsJson from './sample-data/tiktok-studio/normalized/snapshots/studio-sample-2026-04-02T15-38-35-486Z.metric-snapshots.json'
import sampleManifestJson from './sample-data/tiktok-studio/registry/snapshot-manifest.json'
import type {
  TikTokStudioContentItem,
  TikTokStudioContentMetricSnapshot,
  TikTokStudioImportedContentRecord,
  TikTokStudioLatestImport,
  TikTokStudioSnapshotManifest,
  TikTokStudioSnapshotManifestEntry,
} from '@/lib/content-ops/tiktok-studio-types'

export type {
  TikTokStudioContentItem,
  TikTokStudioContentMetricSnapshot,
  TikTokStudioImportedContentRecord,
  TikTokStudioImportSource,
  TikTokStudioImportStatus,
  TikTokStudioLatestImport,
  TikTokStudioSnapshotManifest,
  TikTokStudioSnapshotManifestEntry,
} from '@/lib/content-ops/tiktok-studio-types'

const SAMPLE_DATA_ROOT = 'src/lib/content-ops/sample-data/tiktok-studio'

export async function getTikTokStudioLatestImport(): Promise<TikTokStudioLatestImport> {
  // Resolution order is explicit for demo safety:
  // 1. Workstation/local registry when present
  // 2. Checked-in sample snapshot fallback
  const localRegistry = await resolveLocalStudioRegistry()

  if (localRegistry) {
    const localImport = await tryLoadRegistry(localRegistry, 'local_registry')

    if (localImport) {
      return localImport
    }
  }

  const sampleImport = loadCheckedInSampleImport()

  if (sampleImport) {
    return sampleImport
  }

  return createEmptyImportState()
}

interface ResolvedStudioRegistry {
  registryRoot: string
  manifestPath: string
}

function buildImportedContentRecords(
  contentItems: TikTokStudioContentItem[],
  metricSnapshots: TikTokStudioContentMetricSnapshot[]
): TikTokStudioImportedContentRecord[] {
  const itemByPostUrl = new Map(contentItems.map((item) => [item.post_url, item]))
  const records: TikTokStudioImportedContentRecord[] = []
  const seenPostUrls = new Set<string>()

  for (const metricSnapshot of [...metricSnapshots].sort(
    (left, right) => left.snapshot_row_index - right.snapshot_row_index
  )) {
    if (seenPostUrls.has(metricSnapshot.post_url)) {
      continue
    }

    seenPostUrls.add(metricSnapshot.post_url)
    const contentItem = itemByPostUrl.get(metricSnapshot.post_url)

    records.push({
      post_url: metricSnapshot.post_url,
      post_id: contentItem?.post_id ?? extractPostId(metricSnapshot.post_url),
      platform: 'tiktok',
      caption: contentItem?.caption ?? '(untitled TikTok post)',
      created_at: contentItem?.created_at ?? null,
      first_seen_at: contentItem?.first_seen_at ?? metricSnapshot.scraped_at,
      last_seen_at: contentItem?.last_seen_at ?? metricSnapshot.scraped_at,
      latest_snapshot_id: contentItem?.latest_snapshot_id ?? metricSnapshot.snapshot_id,
      latest_metrics: metricSnapshot,
    })
  }

  for (const contentItem of contentItems) {
    if (seenPostUrls.has(contentItem.post_url)) {
      continue
    }

    records.push({
      ...contentItem,
      latest_metrics: null,
    })
  }

  return records
}

function createEmptyImportState(): TikTokStudioLatestImport {
  return {
    status: 'empty',
    errorMessage: null,
    source: 'missing',
    registryRoot: null,
    manifestPath: null,
    manifest: null,
    latestSnapshot: null,
    rawSnapshotPath: null,
    snapshotContentItemsPath: null,
    snapshotMetricSnapshotsPath: null,
    snapshotHistory: [],
    items: [],
  }
}

function extractPostId(postUrl: string): string | null {
  const segments = postUrl.split('/').filter(Boolean)
  return segments.at(-1) ?? null
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

function resolveLatestSnapshot(
  manifest: TikTokStudioSnapshotManifest
): TikTokStudioSnapshotManifestEntry | null {
  if (manifest.latest_snapshot_id) {
    const latest = manifest.snapshots.find(
      (snapshot) => snapshot.snapshot_id === manifest.latest_snapshot_id
    )

    if (latest) {
      return latest
    }
  }

  return manifest.snapshots[0] ?? null
}

function loadCheckedInSampleImport(): TikTokStudioLatestImport | null {
  const manifest = sampleManifestJson as TikTokStudioSnapshotManifest
  const latestSnapshot = resolveLatestSnapshot(manifest)

  if (!latestSnapshot) {
    return null
  }

  const contentItems = sampleContentItemsJson as TikTokStudioContentItem[]
  const metricSnapshots = sampleMetricSnapshotsJson as TikTokStudioContentMetricSnapshot[]

  return {
    status:
      latestSnapshot.import_status === 'ready' && metricSnapshots.length === 0
        ? 'empty'
        : latestSnapshot.import_status,
    errorMessage: null,
    source: 'sample_fallback',
    registryRoot: SAMPLE_DATA_ROOT,
    manifestPath: `${SAMPLE_DATA_ROOT}/registry/snapshot-manifest.json`,
    manifest,
    latestSnapshot,
    rawSnapshotPath: `${SAMPLE_DATA_ROOT}/${latestSnapshot.raw_snapshot_path}`,
    snapshotContentItemsPath: `${SAMPLE_DATA_ROOT}/${latestSnapshot.normalized_content_items_path}`,
    snapshotMetricSnapshotsPath: `${SAMPLE_DATA_ROOT}/${latestSnapshot.normalized_metric_snapshots_path}`,
    snapshotHistory: manifest.snapshots,
    items: buildImportedContentRecords(contentItems, metricSnapshots),
  }
}

async function resolveLocalStudioRegistry(): Promise<ResolvedStudioRegistry | null> {
  const registryRoots = [
    path.resolve(process.cwd(), '..', '..', 'tiktok-content-registry'),
    path.resolve(process.cwd(), '..', 'tiktok-content-registry'),
    path.resolve(process.cwd(), 'projects', 'tiktok-content-registry'),
  ]

  for (const registryRoot of [...new Set(registryRoots)]) {
    const manifestPath = path.join(
      registryRoot,
      'data',
      'studio-content',
      'registry',
      'snapshot-manifest.json'
    )

    if (await pathExists(manifestPath)) {
      return {
        registryRoot,
        manifestPath,
      }
    }
  }

  return null
}

async function tryLoadRegistry(
  registry: ResolvedStudioRegistry,
  source: 'local_registry'
): Promise<TikTokStudioLatestImport | null> {
  try {
    const manifest = await readJsonFile<TikTokStudioSnapshotManifest>(registry.manifestPath)
    const latestSnapshot = resolveLatestSnapshot(manifest)

    if (!latestSnapshot) {
      return {
        ...createEmptyImportState(),
        source,
        registryRoot: registry.registryRoot,
        manifestPath: registry.manifestPath,
        manifest,
      }
    }

    const snapshotContentItemsPath = path.resolve(
      registry.registryRoot,
      latestSnapshot.normalized_content_items_path
    )
    const snapshotMetricSnapshotsPath = path.resolve(
      registry.registryRoot,
      latestSnapshot.normalized_metric_snapshots_path
    )
    const rawSnapshotPath = path.resolve(registry.registryRoot, latestSnapshot.raw_snapshot_path)
    const [contentItems, metricSnapshots] = await Promise.all([
      readJsonFile<TikTokStudioContentItem[]>(snapshotContentItemsPath),
      readJsonFile<TikTokStudioContentMetricSnapshot[]>(snapshotMetricSnapshotsPath),
    ])

    return {
      status:
        latestSnapshot.import_status === 'ready' && metricSnapshots.length === 0
          ? 'empty'
          : latestSnapshot.import_status,
      errorMessage: null,
      source,
      registryRoot: registry.registryRoot,
      manifestPath: registry.manifestPath,
      manifest,
      latestSnapshot,
      rawSnapshotPath,
      snapshotContentItemsPath,
      snapshotMetricSnapshotsPath,
      snapshotHistory: manifest.snapshots,
      items: buildImportedContentRecords(contentItems, metricSnapshots),
    }
  } catch {
    return null
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
