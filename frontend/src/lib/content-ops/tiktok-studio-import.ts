import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

export interface TikTokStudioImportRow {
  post_url: string
  caption: string
  created_at: string | null
  privacy: string | null
  views_total: number | null
  likes_total: number | null
  comments_total: number | null
  is_pinned: boolean
  duration: string | null
  platform: 'tiktok'
  scraped_at: string
}

export interface TikTokStudioImportSnapshot {
  source: 'tiktok_studio_visible_rows'
  snapshot_version: 1
  page_url: string
  generated_at: string
  row_count: number
  extraction_scope: 'visible_rows_only'
  selector_version: string
  rows: TikTokStudioImportRow[]
}

export async function getTikTokStudioImportSnapshot(): Promise<{
  snapshot: TikTokStudioImportSnapshot | null
  snapshotPath: string | null
}> {
  const snapshotPath = await resolveSnapshotPath()

  if (!snapshotPath) {
    return {
      snapshot: null,
      snapshotPath: null,
    }
  }

  try {
    const raw = await readFile(snapshotPath, 'utf8')
    const parsed = JSON.parse(raw) as TikTokStudioImportSnapshot

    return {
      snapshot: parsed,
      snapshotPath,
    }
  } catch {
    return {
      snapshot: null,
      snapshotPath,
    }
  }
}

async function resolveSnapshotPath(): Promise<string | null> {
  const candidates = [
    path.resolve(
      process.cwd(),
      '..',
      '..',
      'tiktok-content-registry',
      'data',
      'studio-content',
      'visible-content.snapshot.json'
    ),
    path.resolve(
      process.cwd(),
      '..',
      'tiktok-content-registry',
      'data',
      'studio-content',
      'visible-content.snapshot.json'
    ),
    path.resolve(
      process.cwd(),
      'projects',
      'tiktok-content-registry',
      'data',
      'studio-content',
      'visible-content.snapshot.json'
    ),
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return null
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
