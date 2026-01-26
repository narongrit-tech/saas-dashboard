import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  parseAdsExcel,
  upsertAdRows,
  calculateFileHash,
  AdsImportError,
  type AdImportResult,
} from '@/lib/importers/tiktok-ads-daily';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds timeout

// Batch insert config
const BATCH_SIZE = 1000;

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
    const reportDateStr = formData.get('reportDate') as string | null;
    const adsType = formData.get('adsType') as 'product' | 'live' | null;
    const skipZeroRowsStr = formData.get('skipZeroRows') as string | null;

    // Parse skipZeroRows flag (default: true)
    const skipZeroRows = skipZeroRowsStr !== 'false'; // true unless explicitly "false"

    console.log('[CONFIRM] Step 1: Received payload', {
      fileName: file?.name,
      fileSize: file?.size,
      reportDate: reportDateStr,
      adsType,
      skipZeroRows,
    });

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate reportDate format (YYYY-MM-DD)
    let reportDate: Date | undefined;
    if (reportDateStr) {
      const dateMatch = reportDateStr.match(/^\d{4}-\d{2}-\d{2}$/);
      if (!dateMatch) {
        return NextResponse.json(
          { error: 'Report Date format must be YYYY-MM-DD' },
          { status: 400 }
        );
      }
      reportDate = new Date(reportDateStr + 'T00:00:00.000Z');
    }

    // Validate adsType
    if (adsType && !['product', 'live'].includes(adsType)) {
      return NextResponse.json(
        { error: 'Ads Type must be product or live' },
        { status: 400 }
      );
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

    console.log('[CONFIRM] Step 2: Checking for duplicate import...', {
      fileHash: fileHash.substring(0, 16) + '...',
      reportType: 'tiktok_ads_daily',
    });

    // Check for duplicate import (file_hash + report_type ONLY)
    // NOTE: ตรงกับ unique index: idx_import_batches_unique_file
    // IMPORTANT: Exclude failed/rolled_back/deleted batches (allow re-import after rollback or purge)
    const { data: existingBatch } = await supabase
      .from('import_batches')
      .select('id, status, created_at, metadata, file_name')
      .eq('created_by', user.id)
      .eq('file_hash', fileHash)
      .eq('report_type', 'tiktok_ads_daily')
      .not('status', 'in', '("failed","rolled_back","deleted")') // Exclude failed/rolled_back/deleted
      .single();

    if (existingBatch) {
      console.log('[CONFIRM] Duplicate import detected', {
        existingBatchId: existingBatch.id,
        importedAt: existingBatch.created_at,
      });

      return NextResponse.json({
        success: false,
        code: 'DUPLICATE_IMPORT',
        error: 'นำเข้าซ้ำ',
        message: `ไฟล์นี้ถูก import แล้วเมื่อ ${new Date(existingBatch.created_at).toLocaleString('th-TH')}`,
        details: {
          existingBatchId: existingBatch.id,
          importedAt: existingBatch.created_at,
          previousFileName: existingBatch.file_name,
        },
      }, { status: 400 });
    }

    console.log('[CONFIRM] Step 3: Creating import batch...');

    // Ensure metadata is always an object
    const metadata: Record<string, any> = {};
    if (reportDateStr) metadata.reportDate = reportDateStr;
    if (adsType) metadata.adsType = adsType;
    if (file?.name) metadata.fileName = file.name;

    console.log('[CONFIRM] Step 3.1: Batch metadata prepared', { metadata });

    // Create import batch record with metadata
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        created_by: user.id,
        marketplace: 'tiktok',
        report_type: 'tiktok_ads_daily',
        period: 'DAILY',
        file_name: file.name,
        file_hash: fileHash,
        status: 'processing',
        metadata, // Always an object
      })
      .select()
      .single();

    if (batchError || !batch) {
      console.error('[CONFIRM] Failed to create import batch:', {
        error: batchError,
        code: batchError?.code,
        message: batchError?.message,
        details: batchError?.details,
        hint: batchError?.hint,
      });

      // Handle specific Postgres error codes
      if (batchError?.code === '23505') {
        // Unique constraint violation
        return NextResponse.json({
          success: false,
          code: 'DUPLICATE_IMPORT',
          error: 'นำเข้าซ้ำ',
          message: 'ไฟล์นี้ถูกนำเข้าแล้ว',
          details: {
            step: 'create_batch',
            constraint: batchError.details,
            hint: 'กรุณาตรวจสอบประวัติการนำเข้าหรือใช้ไฟล์อื่น',
          },
        }, { status: 409 });
      }

      if (batchError?.code === '42P01') {
        // Table not found
        return NextResponse.json({
          success: false,
          code: 'DB_ERROR',
          error: 'Table not found',
          message: 'ไม่พบตาราง import_batches',
          details: {
            step: 'create_batch',
            hint: 'กรุณารัน migration สร้างตาราง',
          },
        }, { status: 500 });
      }

      if (batchError?.code === '42703') {
        // Column not found
        return NextResponse.json({
          success: false,
          code: 'DB_ERROR',
          error: 'Column not found',
          message: 'schema import_batches ไม่ครบ (ขาด metadata column)',
          details: {
            step: 'create_batch',
            dbCode: batchError.code,
            dbMessage: batchError.message,
            hint: 'กรุณารัน migration-020-import-batches-metadata.sql',
          },
        }, { status: 500 });
      }

      if (batchError?.code === '23502') {
        // NOT NULL constraint violation
        return NextResponse.json({
          success: false,
          code: 'DB_ERROR',
          error: 'NOT NULL constraint',
          message: 'ข้อมูลไม่ครบ (missing required field)',
          details: {
            step: 'create_batch',
            dbCode: batchError.code,
            dbMessage: batchError.message,
            hint: batchError.hint,
          },
        }, { status: 500 });
      }

      // Generic DB error
      return NextResponse.json({
        success: false,
        code: 'DB_ERROR',
        error: 'ไม่สามารถสร้าง import batch ได้',
        message: batchError?.message || 'Database error',
        details: {
          step: 'create_batch',
          dbError: batchError?.message,
          dbCode: batchError?.code,
          hint: batchError?.hint,
        },
      }, { status: 500 });
    }

    console.log('[CONFIRM] Batch created successfully', { batchId: batch.id });

    try {
      console.log('[CONFIRM] Step 4: Parsing Excel file...', {
        reportDate: reportDateStr,
        adsType,
        skipZeroRows,
      });

      // Parse Excel file with reportDate, adsType, and skipZeroRows
      const parseResult = parseAdsExcel(buffer, reportDate, adsType || undefined, skipZeroRows);

      console.log(`[CONFIRM] Parsed ${parseResult.totalRows} rows (kept: ${parseResult.keptRows.length}, skipped: ${parseResult.skippedAllZeroRows})`);

      if (parseResult.keptRows.length === 0) {
        // Mark batch as failed
        await supabase
          .from('import_batches')
          .update({
            status: 'failed',
            notes: 'No valid rows found in file',
            row_count: 0,
          })
          .eq('id', batch.id);

        return NextResponse.json(
          {
            success: false,
            error: 'ไม่พบข้อมูลที่ valid ในไฟล์',
            message: 'File contains no valid rows after parsing',
            warnings: parseResult.warnings,
          },
          { status: 400 }
        );
      }

      console.log('[CONFIRM] Step 5: Inserting ad performance rows...', {
        rowCount: parseResult.keptRows.length,
        totalRowsInFile: parseResult.totalRows,
        skippedAllZeroRows: parseResult.skippedAllZeroRows,
      });

      // Upsert rows to ad_daily_performance (use keptRows only)
      const { insertedCount, updatedCount, errorCount, errors } = await upsertAdRows(
        parseResult.keptRows,
        batch.id,
        user.id
      );

      const skippedCount = parseResult.keptRows.length - insertedCount - updatedCount - errorCount;

      console.log('[CONFIRM] Ad rows upserted', {
        inserted: insertedCount,
        updated: updatedCount,
        errors: errorCount,
        skipped: skippedCount,
      });

      // Aggregate spend per day for wallet entries (use keptRows only)
      const dailySpendMap = new Map<string, number>();
      for (const row of parseResult.keptRows) {
        const dateKey = row.ad_date.toISOString().split('T')[0];
        const current = dailySpendMap.get(dateKey) || 0;
        dailySpendMap.set(dateKey, current + row.spend);
      }

      console.log('[CONFIRM] Step 6: Creating wallet entries...', {
        dailySpendEntries: dailySpendMap.size,
      });

      // Get ADS wallet (assume first ADS wallet for now)
      const { data: adsWallet, error: walletError } = await supabase
        .from('wallets')
        .select('id')
        .eq('created_by', user.id)
        .eq('wallet_type', 'ADS')
        .single();

      if (walletError || !adsWallet) {
        console.error('[CONFIRM] ADS wallet not found', {
          error: walletError,
          userId: user.id,
        });

        // Mark batch as failed
        await supabase
          .from('import_batches')
          .update({
            status: 'failed',
            notes: 'ADS wallet not found',
          })
          .eq('id', batch.id);

        return NextResponse.json({
          success: false,
          code: 'WALLET_NOT_FOUND',
          error: 'ไม่พบ Wallet',
          message: 'ไม่พบ TikTok Ads wallet - กรุณาสร้าง ADS wallet ก่อนนำเข้าข้อมูล',
          details: {
            step: 'wallet_lookup',
            batchId: batch.id,
            hint: 'ไปที่หน้า Wallets และสร้าง wallet ประเภท ADS (TikTok Ads)',
          },
        }, { status: 400 });
      }

      let walletInsertedCount = 0;

      if (adsWallet) {
        // Insert wallet_ledger SPEND entries (one per day)
        for (const [date, totalSpend] of Array.from(dailySpendMap.entries())) {
          const note = `${adsType === 'live' ? 'Live' : 'Product'} Ads Spend - ${date}`;

          const { error: ledgerError } = await supabase.from('wallet_ledger').insert({
            wallet_id: adsWallet.id,
            date,
            entry_type: 'SPEND',
            direction: 'OUT',
            amount: Math.round(totalSpend * 100) / 100,
            source: 'IMPORTED',
            import_batch_id: batch.id,
            reference_id: file.name,
            note,
            created_by: user.id,
          });

          if (!ledgerError) {
            walletInsertedCount++;
          }
        }
      }

      console.log('[CONFIRM] Wallet entries created', {
        walletInsertedCount,
      });

      // Update batch record with results
      const batchStatus = errorCount === parseResult.keptRows.length ? 'failed' : 'success';

      const notes = errors.length > 0
        ? errors.slice(0, 10).join('; ')
        : `Performance: ${insertedCount} records, Wallet: ${walletInsertedCount} entries (skipped ${parseResult.skippedAllZeroRows} all-zero rows)`;

      await supabase
        .from('import_batches')
        .update({
          status: batchStatus,
          row_count: parseResult.keptRows.length,
          inserted_count: insertedCount,
          updated_count: updatedCount,
          skipped_count: skippedCount,
          error_count: errorCount,
          notes,
        })
        .eq('id', batch.id);

      console.log('[CONFIRM] Step 7: Import completed successfully', {
        batchId: batch.id,
        status: batchStatus,
        totalRowsInFile: parseResult.totalRows,
        keptRows: parseResult.keptRows.length,
        skippedAllZeroRows: parseResult.skippedAllZeroRows,
        insertedCount,
        updatedCount,
        walletInsertedCount,
      });

      const result: AdImportResult = {
        success: batchStatus === 'success',
        batchId: batch.id,
        rowCount: parseResult.keptRows.length,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
        errors: errors.slice(0, 10), // Limit to first 10 errors
        warnings: parseResult.warnings,
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

      console.error('[CONFIRM] Parse/Import error:', {
        error: parseError,
        message: parseError instanceof Error ? parseError.message : 'Unknown',
        code: parseError instanceof AdsImportError ? parseError.code : 'UNKNOWN',
      });

      // Handle structured errors
      if (parseError instanceof AdsImportError) {
        return NextResponse.json({
          success: false,
          error: parseError.message,
          code: parseError.code,
          details: {
            step: 'parse',
            ...parseError.details,
          },
        }, { status: 400 });
      }

      // Handle generic errors
      return NextResponse.json({
        success: false,
        code: 'PARSE_ERROR',
        error: 'ไม่สามารถอ่านไฟล์ได้',
        message: parseError instanceof Error ? parseError.message : 'Unknown error',
        details: {
          step: 'parse',
        },
      }, { status: 400 });
    }
  } catch (error) {
    console.error('[CONFIRM] Unexpected error:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json({
      success: false,
      code: 'UNKNOWN_ERROR',
      error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: {
        step: 'unknown',
      },
    }, { status: 500 });
  }
}
