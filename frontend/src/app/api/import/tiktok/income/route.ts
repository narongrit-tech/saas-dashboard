import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  parseIncomeExcel,
  upsertIncomeRows,
  calculateFileHash,
  type ImportResult,
} from '@/lib/importers/tiktok-income';
import { reconcileSettlements } from '@/lib/reconcile/settlement-reconcile';

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
    const allowDuplicate = formData.get('allowDuplicate') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log(`[Income API] Allow duplicate mode: ${allowDuplicate}`);

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .xlsx and .xls files are supported.' },
        { status: 400 }
      );
    }

    // Read file buffer
    console.log(`[Income API] File name: ${file.name}`);
    console.log(`[Income API] File size: ${file.size} bytes`);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[Income API] ArrayBuffer size: ${arrayBuffer.byteLength} bytes`);
    console.log(`[Income API] Buffer length: ${buffer.length} bytes`);

    // CRITICAL CHECK: If buffer is tiny, file was truncated!
    if (buffer.length < 1000) {
      console.error(`[Income API] WARNING: Buffer suspiciously small (${buffer.length} bytes)`);
    }

    // Calculate file hash
    const fileHash = calculateFileHash(buffer);

    // Check for duplicate import (skip if allowDuplicate = true)
    if (!allowDuplicate) {
      const { data: existingBatch } = await supabase
        .from('import_batches')
        .select('id, status, created_at')
        .eq('created_by', user.id)
        .eq('marketplace', 'tiktok')
        .eq('report_type', 'tiktok_income')
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
    } else {
      console.log(`[Income API] Duplicate check skipped (testing mode)`);
    }

    // Create import batch record
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        created_by: user.id,
        marketplace: 'tiktok',
        report_type: 'tiktok_income',
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
      console.log(`[Income Import] Parsing file: ${file.name}`);
      const { rows, warnings } = parseIncomeExcel(buffer);
      console.log(`[Income Import] Total rows parsed: ${rows.length}`);
      console.log(`[Income Import] First 3 Transaction IDs:`, rows.slice(0, 3).map(r => r.txn_id));

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

      // Upsert rows into settlement_transactions
      console.log(`[Income Import] Upserting ${rows.length} rows...`);
      const { insertedCount, updatedCount, errorCount, errors } = await upsertIncomeRows(
        rows,
        batch.id,
        user.id
      );
      console.log(`[Income Import] Results: inserted=${insertedCount}, updated=${updatedCount}, errors=${errorCount}`);

      const skippedCount = rows.length - insertedCount - updatedCount - errorCount;

      // Reconcile with unsettled_transactions
      console.log(`[Income Import] Starting reconciliation...`);
      let reconciledCount = 0;
      let notFoundCount = 0;
      try {
        const reconcileResult = await reconcileSettlements(batch.id, user.id);
        reconciledCount = reconcileResult.reconciledCount;
        notFoundCount = reconcileResult.notFoundInOnholdCount;
      } catch (reconcileError) {
        console.error('Reconciliation failed:', reconcileError);
        warnings.push(
          `Reconciliation failed: ${reconcileError instanceof Error ? reconcileError.message : 'Unknown error'}`
        );
      }

      // Update batch record with results
      const batchStatus = errorCount === rows.length ? 'failed' : 'success';
      const notes = [
        errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        reconciledCount > 0 ? `Reconciled: ${reconciledCount}` : null,
        notFoundCount > 0 ? `Not found in forecast: ${notFoundCount}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      await supabase
        .from('import_batches')
        .update({
          status: batchStatus,
          row_count: rows.length,
          inserted_count: insertedCount,
          updated_count: updatedCount,
          skipped_count: skippedCount,
          error_count: errorCount,
          notes: notes || null,
        })
        .eq('id', batch.id);

      const result: ImportResult & {
        reconciledCount?: number;
        notFoundInForecastCount?: number;
      } = {
        success: batchStatus === 'success',
        batchId: batch.id,
        rowCount: rows.length,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
        errors: errors.slice(0, 10), // Limit to first 10 errors
        warnings,
        reconciledCount,
        notFoundInForecastCount: notFoundCount,
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
