import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  parseOnholdExcel,
  upsertOnholdRows,
  calculateFileHash,
  type ImportResult,
} from '@/lib/importers/tiktok-onhold';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds timeout

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .xlsx and .xls files are supported.' },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Calculate file hash
    const fileHash = calculateFileHash(buffer);

    // Check for duplicate import
    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, status, created_at')
      .eq('created_by', user.id)
      .eq('marketplace', 'tiktok')
      .eq('report_type', 'tiktok_onhold')
      .eq('file_hash', fileHash)
      .eq('status', 'success')
      .single();

    if (existingBatch) {
      return NextResponse.json({
        success: false,
        error: 'Duplicate file',
        message: `This file has already been imported successfully on ${new Date(existingBatch.created_at).toLocaleString('th-TH')}`,
        batchId: existingBatch.id,
      });
    }

    // Create import batch record
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        created_by: user.id,
        marketplace: 'tiktok',
        report_type: 'tiktok_onhold',
        period: null,
        file_name: file.name,
        file_hash: fileHash,
        status: 'processing',
      })
      .select()
      .single();

    if (batchError || !batch) {
      console.error('Failed to create import batch:', batchError);
      return NextResponse.json(
        { error: 'Failed to create import batch', details: batchError?.message },
        { status: 500 }
      );
    }

    try {
      // Parse Excel file
      console.log(`[Onhold Import] Parsing file: ${file.name}`);
      const { rows, warnings } = parseOnholdExcel(buffer);
      console.log(`[Onhold Import] Total rows parsed: ${rows.length}`);
      console.log(`[Onhold Import] First 3 Transaction IDs:`, rows.slice(0, 3).map(r => r.txn_id));

      if (rows.length === 0) {
        // Mark batch as failed
        await supabase
          .from('import_batches')
          .update({
            status: 'failed',
            notes: 'No valid rows found in file',
            row_count: 0,
          })
          .eq('id', batch.id);

        return NextResponse.json({
          success: false,
          error: 'No valid rows found in file',
          warnings,
        });
      }

      // Upsert rows
      console.log(`[Onhold Import] Upserting ${rows.length} rows...`);
      const { insertedCount, updatedCount, errorCount, errors } = await upsertOnholdRows(
        rows,
        batch.id,
        user.id
      );
      console.log(`[Onhold Import] Results: inserted=${insertedCount}, updated=${updatedCount}, errors=${errorCount}`);

      const skippedCount = rows.length - insertedCount - updatedCount - errorCount;

      // Update batch record with results
      const batchStatus = errorCount === rows.length ? 'failed' : 'success';
      await supabase
        .from('import_batches')
        .update({
          status: batchStatus,
          row_count: rows.length,
          inserted_count: insertedCount,
          updated_count: updatedCount,
          skipped_count: skippedCount,
          error_count: errorCount,
          notes: errors.length > 0 ? errors.slice(0, 10).join('; ') : null,
        })
        .eq('id', batch.id);

      const result: ImportResult = {
        success: batchStatus === 'success',
        batchId: batch.id,
        rowCount: rows.length,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
        errors: errors.slice(0, 10), // Limit to first 10 errors
        warnings,
      };

      return NextResponse.json(result);
    } catch (parseError) {
      // Mark batch as failed
      await supabase
        .from('import_batches')
        .update({
          status: 'failed',
          notes: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
        })
        .eq('id', batch.id);

      console.error('Failed to parse/import file:', parseError);
      return NextResponse.json(
        {
          error: 'Failed to parse file',
          details: parseError instanceof Error ? parseError.message : 'Unknown error',
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
