import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { previewAdsExcel, AdsImportError } from '@/lib/importers/tiktok-ads-daily';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีไฟล์' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json(
        { success: false, error: 'ไฟล์ต้องเป็น .xlsx หรือ .xls เท่านั้น' },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[Ads Preview] Processing file: ${file.name} (${buffer.length} bytes)`);

    // Preview file
    const preview = previewAdsExcel(buffer, file.name);

    console.log(`[Ads Preview] Success: ${preview.summary.totalRows} rows, type: ${preview.summary.campaignType}`);

    return NextResponse.json(preview);
  } catch (error) {
    console.error('[Ads Preview] Error:', error);

    // Handle structured errors
    if (error instanceof AdsImportError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 400 }
      );
    }

    // Handle generic errors
    return NextResponse.json(
      {
        success: false,
        error: 'ไม่สามารถ preview ไฟล์ได้',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
