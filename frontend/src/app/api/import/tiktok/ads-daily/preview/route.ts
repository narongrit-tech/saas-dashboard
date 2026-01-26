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
    const reportDateStr = formData.get('reportDate') as string | null;
    const adsType = formData.get('adsType') as 'product' | 'live' | null;
    const skipZeroRowsStr = formData.get('skipZeroRows') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีไฟล์' },
        { status: 400 }
      );
    }

    // Validate reportDate format (YYYY-MM-DD)
    let reportDate: Date | undefined;
    if (reportDateStr) {
      const dateMatch = reportDateStr.match(/^\d{4}-\d{2}-\d{2}$/);
      if (!dateMatch) {
        return NextResponse.json(
          { success: false, error: 'Report Date format ต้องเป็น YYYY-MM-DD' },
          { status: 400 }
        );
      }
      reportDate = new Date(reportDateStr + 'T00:00:00.000Z');
    }

    // Validate adsType
    if (adsType && !['product', 'live'].includes(adsType)) {
      return NextResponse.json(
        { success: false, error: 'Ads Type ต้องเป็น product หรือ live เท่านั้น' },
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

    // Parse skipZeroRows flag (default: true)
    const skipZeroRows = skipZeroRowsStr !== 'false'; // true unless explicitly "false"

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[Ads Preview] Processing file: ${file.name} (${buffer.length} bytes), reportDate: ${reportDateStr}, adsType: ${adsType}, skipZeroRows: ${skipZeroRows}`);

    // Preview file with skipZeroRows flag
    const preview = previewAdsExcel(buffer, file.name, reportDate, adsType || undefined, skipZeroRows);

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
