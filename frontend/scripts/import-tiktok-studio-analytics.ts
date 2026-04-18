/**
 * TikTok Studio Analytics — Bulk CLI Importer
 *
 * Usage (from frontend/):
 *
 *   Single file:
 *     npx tsx --env-file .env.local scripts/import-tiktok-studio-analytics.ts \
 *       --file "D:/AI_OS/projects/tiktok-content-registry/data/studio-analytics/normalized/snapshots/studio-analytics-2026-04-18T11-05-16-040Z.analytics-rows.json" \
 *       --created-by "<auth_user_uuid>"
 *
 *   Entire directory (recursively, sorted by filename):
 *     npx tsx --env-file .env.local scripts/import-tiktok-studio-analytics.ts \
 *       --dir "D:/AI_OS/projects/tiktok-content-registry/data/studio-analytics/normalized/snapshots" \
 *       --created-by "<auth_user_uuid>"
 *
 *   Dry run (parse only, no DB write):
 *     npx tsx --env-file .env.local scripts/import-tiktok-studio-analytics.ts \
 *       --dir "D:/AI_OS/projects/tiktok-content-registry/data/studio-analytics/normalized/snapshots" \
 *       --created-by "<auth_user_uuid>" \
 *       --dry-run
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  parseStudioAnalyticsFile,
  previewStudioAnalyticsFile,
  importStudioAnalyticsFile,
} from '../src/lib/content-ops/tiktok-studio-analytics-import'

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: {
    file?: string
    dir?: string
    createdBy?: string
    dryRun: boolean
    help: boolean
    skipEmpty: boolean
  } = { dryRun: false, help: false, skipEmpty: true }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': result.help = true; break
      case '--file':       result.file      = argv[++i]; break
      case '--dir':        result.dir       = argv[++i]; break
      case '--created-by': result.createdBy = argv[++i]; break
      case '--dry-run':    result.dryRun    = true; break
      case '--include-empty': result.skipEmpty = false; break
    }
  }
  return result
}

function usage() {
  console.log(`
Usage:
  npx tsx --env-file .env.local scripts/import-tiktok-studio-analytics.ts --file <path> --created-by <uuid> [--dry-run]
  npx tsx --env-file .env.local scripts/import-tiktok-studio-analytics.ts --dir  <path> --created-by <uuid> [--dry-run]

Flags:
  --file          Path to a single .json snapshot file
  --dir           Path to directory — finds all .analytics-rows.json files recursively, sorted by filename
  --created-by    auth.users.id that owns the import batches
  --dry-run       Parse and preview only — no DB writes
  --include-empty Also import snapshot files that contain 0 rows (skipped by default)
`)
}

// ─── File discovery ───────────────────────────────────────────────────────────

function findJsonFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...findJsonFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.analytics-rows.json')) results.push(full)
  }
  return results.sort()
}

// ─── Single file ──────────────────────────────────────────────────────────────

async function processFile(
  filePath: string,
  createdBy: string,
  dryRun: boolean,
  skipEmpty: boolean,
  index: number,
  total: number
): Promise<{ ok: boolean; inserted: number; invalid: number; skipped: boolean }> {
  const label = `[${index}/${total}] ${path.basename(filePath)}`
  const buf = fs.readFileSync(filePath)

  // Quick-check row count without hitting DB
  const parsed = parseStudioAnalyticsFile(buf)
  if (skipEmpty && parsed.rows.length === 0 && parsed.invalidRowCount === 0) {
    console.log(`  ↷ skip (0 rows)  ${label}`)
    return { ok: true, inserted: 0, invalid: 0, skipped: true }
  }

  if (dryRun) {
    const preview = await previewStudioAnalyticsFile(buf, path.basename(filePath), createdBy)
    const status = preview.ok ? '✓ preview' : '✗ parse-fail'
    const dupNote = preview.isDuplicateFile ? ' (already staged)' : ''
    console.log(
      `  ${status}${dupNote}  rows=${preview.rowCount}  invalid=${preview.invalidRowCount}  ${label}`
    )
    return { ok: preview.ok, inserted: 0, invalid: preview.invalidRowCount, skipped: false }
  }

  const result = await importStudioAnalyticsFile(buf, path.basename(filePath), createdBy)

  if (!result.ok) {
    const stage = result.errors?.[0]?.stage ?? result.stage
    const msg   = result.errors?.[0]?.message ?? 'unknown error'
    console.log(`  ✗ [${stage}] ${msg}  ${label}`)
    return { ok: false, inserted: 0, invalid: result.invalidRowCount, skipped: false }
  }

  if (result.isDuplicateFile) {
    console.log(`  ↩ skip (already staged, batch=${result.existingBatchId?.slice(0, 8)})  ${label}`)
    return { ok: true, inserted: 0, invalid: 0, skipped: true }
  }

  console.log(
    `  ✓ staged  inserted=${result.insertedCount}  invalid=${result.invalidRowCount}  ${label}`
  )
  return { ok: true, inserted: result.insertedCount, invalid: result.invalidRowCount, skipped: false }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || (!args.file && !args.dir) || !args.createdBy) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const files: string[] = args.file
    ? [args.file]
    : findJsonFiles(args.dir!)

  if (files.length === 0) {
    console.error('No .analytics-rows.json files found.')
    process.exit(1)
  }

  console.log(`\nTikTok Studio Analytics Import`)
  console.log(`mode      : ${args.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`)
  console.log(`files     : ${files.length}`)
  console.log(`created_by: ${args.createdBy}`)
  console.log(`skip empty: ${args.skipEmpty}`)
  console.log('')

  const summary = { ok: 0, fail: 0, skipped: 0, inserted: 0, invalid: 0 }

  for (let i = 0; i < files.length; i++) {
    const r = await processFile(files[i], args.createdBy!, args.dryRun, args.skipEmpty, i + 1, files.length)
    if (r.skipped)    summary.skipped++
    else if (r.ok)    summary.ok++
    else              summary.fail++
    summary.inserted += r.inserted
    summary.invalid  += r.invalid
  }

  console.log(`
─────────────────────────────────────
  files processed : ${files.length}
  staged ok       : ${summary.ok}
  skipped         : ${summary.skipped}
  failed          : ${summary.fail}
  rows inserted   : ${summary.inserted}
  rows invalid    : ${summary.invalid}
─────────────────────────────────────`)

  if (summary.fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
