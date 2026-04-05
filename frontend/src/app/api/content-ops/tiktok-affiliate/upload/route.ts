import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importTikTokAffiliateFile } from '@/lib/content-ops/tiktok-affiliate-orders'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  // Verify authentication
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const sheetName = formData.get('sheet_name') as string | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Only .xlsx files are supported' }, { status: 400 })
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 50 MB limit' }, { status: 400 })
  }

  // Write to temp file
  const tmpId = crypto.randomUUID()
  const tmpPath = path.join(os.tmpdir(), `tiktok-affiliate-${tmpId}.xlsx`)

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(tmpPath, buffer)

    const result = await importTikTokAffiliateFile({
      filePath: tmpPath,
      createdBy: user.id,
      sheetName: sheetName ?? undefined,
    })

    return NextResponse.json({ success: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined)
  }
}
