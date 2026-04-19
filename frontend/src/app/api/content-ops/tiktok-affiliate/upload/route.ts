import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importTikTokAffiliateFile } from '@/lib/content-ops/tiktok-affiliate-orders'

export const maxDuration = 300

function errorResponse(
  status: number,
  code: string,
  message: string,
  stage?: string
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(stage ? { stage } : {}),
      },
    },
    { status }
  )
}

export async function POST(request: NextRequest) {
  // Verify authentication
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return errorResponse(401, 'unauthenticated', 'Unauthenticated', 'auth')
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse(400, 'invalid_form_data', 'Invalid form data', 'request_form')
  }

  const file = formData.get('file') as File | null
  const sheetName = formData.get('sheet_name') as string | null

  if (!file) {
    return errorResponse(400, 'missing_file', 'No file provided', 'request_validation')
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return errorResponse(400, 'unsupported_file_type', 'Only .xlsx files are supported', 'request_validation')
  }

  if (file.size > 50 * 1024 * 1024) {
    return errorResponse(400, 'file_too_large', 'File exceeds 50 MB limit', 'request_validation')
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
      originalFileName: file.name,
      sheetName: sheetName ?? undefined,
    })

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(500, 'import_failed', message, 'import_pipeline')
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined)
  }
}
