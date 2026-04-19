import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importStudioAnalyticsFile } from '@/lib/content-ops/tiktok-studio-analytics-import'

export const maxDuration = 300

function errorResponse(status: number, code: string, message: string, stage?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(stage ? { stage } : {}) } },
    { status }
  )
}

export async function POST(request: NextRequest) {
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

  if (!file) {
    return errorResponse(400, 'missing_file', 'No file provided', 'request_validation')
  }
  if (!file.name.toLowerCase().endsWith('.json')) {
    return errorResponse(400, 'unsupported_file_type', 'Only .json files are supported', 'request_validation')
  }
  if (file.size > 50 * 1024 * 1024) {
    return errorResponse(400, 'file_too_large', 'File exceeds 50 MB limit', 'request_validation')
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await importStudioAnalyticsFile(buffer, file.name, user.id)
    const status = result.ok ? 200 : 422
    return NextResponse.json({ ok: result.ok, result }, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(500, 'import_failed', message, 'import_pipeline')
  }
}
