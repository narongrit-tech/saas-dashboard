import path from 'node:path'

import { importTikTokAffiliateFile } from '../src/lib/content-ops/tiktok-affiliate-orders'

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npx tsx scripts/import-tiktok-affiliate-orders.ts --file "<path-to-xlsx>" --created-by "<auth_user_uuid>" [--sheet "<sheet-name>"]',
      '',
      'Required flags:',
      '  --file        Absolute or relative path to the TikTok affiliate Excel file',
      '  --created-by  auth.users.id that should own the module-local batch and staged rows',
      '',
      'Optional flags:',
      '  --sheet       Sheet name override (defaults to the first worksheet)',
    ].join('\n')
  )
}

function parseArgs(argv: string[]): { file?: string; createdBy?: string; sheetName?: string; help: boolean } {
  const result: { file?: string; createdBy?: string; sheetName?: string; help: boolean } = {
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--help' || value === '-h') {
      result.help = true
      continue
    }

    if (value === '--file') {
      result.file = argv[index + 1]
      index += 1
      continue
    }

    if (value === '--created-by') {
      result.createdBy = argv[index + 1]
      index += 1
      continue
    }

    if (value === '--sheet') {
      result.sheetName = argv[index + 1]
      index += 1
    }
  }

  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.file || !args.createdBy) {
    printUsage()
    process.exit(args.help ? 0 : 1)
  }

  const result = await importTikTokAffiliateFile({
    filePath: path.resolve(process.cwd(), args.file),
    createdBy: args.createdBy,
    sheetName: args.sheetName,
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
