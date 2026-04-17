import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { previewTikTokAffiliateFile } from '@/lib/content-ops/tiktok-affiliate-orders'

export const maxDuration = 60

function errorResponse(status: number, code: string, message: string, stage?: string) {
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
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

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

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const preview = await previewTikTokAffiliateFile(buffer, file.name, user.id, sheetName ?? undefined)
    return NextResponse.json({ ok: true, preview })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(500, 'preview_failed', message, 'preview_pipeline')
  }
}
