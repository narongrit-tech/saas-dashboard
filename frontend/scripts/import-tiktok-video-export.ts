/**
 * TikTok Video Performance Export — Bulk CLI Importer
 *
 * Usage (from frontend/):
 *
 *   Single file:
 *     npx tsx scripts/import-tiktok-video-export.ts \
 *       --file "D:/AI_OS/projects/bot-runner/downloads/video-analysis/2025-10/video-analysis_2025-10-23.xlsx" \
 *       --created-by "<auth_user_uuid>"
 *
 *   Entire directory (recursively, sorted by date):
 *     npx tsx scripts/import-tiktok-video-export.ts \
 *       --dir "D:/AI_OS/projects/bot-runner/downloads/video-analysis" \
 *       --created-by "<auth_user_uuid>"
 *
 *   Dry run (parse only, no DB write):
 *     npx tsx scripts/import-tiktok-video-export.ts \
 *       --dir "D:/AI_OS/projects/bot-runner/downloads/video-analysis" \
 *       --created-by "<auth_user_uuid>" \
 *       --dry-run
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  previewTikTokVideoPerformanceFile,
  importTikTokVideoPerformanceFile,
} from '../src/lib/content-ops/tiktok-video-performance-import'

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: {
    file?: string
    dir?: string
    createdBy?: string
    dryRun: boolean
    help: boolean
  } = { dryRun: false, help: false }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': result.help = true; break
      case '--file':    result.file      = argv[++i]; break
      case '--dir':     result.dir       = argv[++i]; break
      case '--created-by': result.createdBy = argv[++i]; break
      case '--dry-run': result.dryRun    = true; break
    }
  }
  return result
}

function usage() {
  console.log(`
Usage:
  npx tsx scripts/import-tiktok-video-export.ts --file <path> --created-by <uuid> [--dry-run]
  npx tsx scripts/import-tiktok-video-export.ts --dir  <path> --created-by <uuid> [--dry-run]

Flags:
  --file        Path to a single .xlsx file
  --dir         Path to directory — finds all .xlsx files recursively, sorted by filename
  --created-by  auth.users.id that owns the import batches
  --dry-run     Parse and preview only — no DB writes
`)
}

// ─── File discovery ───────────────────────────────────────────────────────────

function findXlsxFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...findXlsxFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.xlsx')) results.push(full)
  }
  return results.sort()
}

// ─── Single file import ───────────────────────────────────────────────────────

async function processFile(
  filePath: string,
  createdBy: string,
  dryRun: boolean,
  index: number,
  total: number
): Promise<{ ok: boolean; inserted: number; invalid: number; dups: number; skipped: boolean }> {
  const label = `[${index}/${total}] ${path.basename(filePath)}`
  const buf = fs.readFileSync(filePath)

  if (dryRun) {
    const preview = await previewTikTokVideoPerformanceFile(buf, path.basename(filePath), createdBy)
    const status = preview.ok ? '✓ preview' : '✗ parse-fail'
    const dupNote = preview.isDuplicateFile ? ' (already staged)' : ''
    console.log(
      `  ${status}${dupNote}  rows=${preview.rowCount}  invalid=${preview.invalidRowCount}  dups=${preview.duplicateVideoIdCount}  ${label}`
    )
    return { ok: preview.ok, inserted: 0, invalid: preview.invalidRowCount, dups: preview.duplicateVideoIdCount, skipped: false }
  }

  const result = await importTikTokVideoPerformanceFile(buf, path.basename(filePath), createdBy)

  if (!result.ok) {
    const stage = result.errors?.[0]?.stage ?? result.stage
    const msg   = result.errors?.[0]?.message ?? 'unknown error'
    console.log(`  ✗ [${stage}] ${msg}  ${label}`)
    return { ok: false, inserted: 0, invalid: result.invalidRowCount, dups: result.duplicateVideoIdCount, skipped: false }
  }

  if (result.isDuplicateFile) {
    console.log(`  ↩ skip (already staged, batch=${result.existingBatchId?.slice(0, 8)})  ${label}`)
    return { ok: true, inserted: 0, invalid: 0, dups: 0, skipped: true }
  }

  const dupNote = result.duplicateVideoIdCount > 0 ? `  dup_ids=${result.duplicateVideoIdCount}` : ''
  console.log(
    `  ✓ staged  inserted=${result.insertedCount}  invalid=${result.invalidRowCount}${dupNote}  ${label}`
  )
  return { ok: true, inserted: result.insertedCount, invalid: result.invalidRowCount, dups: result.duplicateVideoIdCount, skipped: false }
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
    : findXlsxFiles(args.dir!)

  if (files.length === 0) {
    console.error('No .xlsx files found.')
    process.exit(1)
  }

  console.log(`\nTikTok Video Performance Import`)
  console.log(`mode      : ${args.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`)
  console.log(`files     : ${files.length}`)
  console.log(`created_by: ${args.createdBy}`)
  console.log('')

  const summary = { ok: 0, fail: 0, skipped: 0, inserted: 0, invalid: 0, dups: 0 }

  for (let i = 0; i < files.length; i++) {
    const r = await processFile(files[i], args.createdBy!, args.dryRun, i + 1, files.length)
    if (r.skipped)    summary.skipped++
    else if (r.ok)    summary.ok++
    else              summary.fail++
    summary.inserted += r.inserted
    summary.invalid  += r.invalid
    summary.dups     += r.dups
  }

  console.log(`
─────────────────────────────────────
  files processed : ${files.length}
  staged ok       : ${summary.ok}
  skipped (dup)   : ${summary.skipped}
  failed          : ${summary.fail}
  rows inserted   : ${summary.inserted}
  rows invalid    : ${summary.invalid}
  duplicate IDs   : ${summary.dups}
─────────────────────────────────────`)

  if (summary.fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
