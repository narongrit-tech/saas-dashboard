import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 30 seconds timeout

/**
 * POST /api/import/rollback
 *
 * Rollback import batch by batch_id.
 * Deletes all related records (wallet_ledger, ad_daily_performance).
 * Marks batch status as 'rolled_back'.
 *
 * Body: { batch_id: string }
 *
 * Response:
 * - success: { success: true, message: string, counts: { wallet_deleted: number, ads_deleted: number } }
 * - error: { success: false, error: string, message?: string, details?: object }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { batch_id } = body;

    // Validate batch_id
    if (!batch_id || typeof batch_id !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid batch_id',
          message: 'batch_id is required and must be a valid UUID string',
        },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(batch_id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid UUID format',
          message: 'batch_id must be a valid UUID',
        },
        { status: 400 }
      );
    }

    console.log('[ROLLBACK] Step 1: Received request', {
      batchId: batch_id,
      userId: user.id,
    });

    // Call RPC function: rollback_import_batch
    const { data, error: rpcError } = await supabase.rpc('rollback_import_batch', {
      p_batch_id: batch_id,
    });

    if (rpcError) {
      console.error('[ROLLBACK] RPC error:', {
        error: rpcError,
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
        hint: rpcError.hint,
      });

      // Handle specific RPC errors
      if (rpcError.code === '42883') {
        // Function not found
        return NextResponse.json(
          {
            success: false,
            error: 'Function not found',
            message: 'rollback_import_batch RPC function ไม่มี - กรุณารัน migration',
            details: {
              code: rpcError.code,
              hint: 'ต้องรัน migration ก่อนใช้งาน',
            },
          },
          { status: 500 }
        );
      }

      if (rpcError.code === 'PGRST204') {
        // Batch not found
        return NextResponse.json(
          {
            success: false,
            error: 'Batch not found',
            message: 'ไม่พบ import batch ที่ระบุ',
            details: {
              batchId: batch_id,
            },
          },
          { status: 404 }
        );
      }

      // Generic RPC error
      return NextResponse.json(
        {
          success: false,
          error: 'Rollback failed',
          message: rpcError.message || 'เกิดข้อผิดพลาดในการ rollback',
          details: {
            code: rpcError.code,
            dbError: rpcError.message,
            hint: rpcError.hint,
          },
        },
        { status: 500 }
      );
    }

    // Parse RPC result
    // Expected: { wallet_deleted: number, ads_deleted: number }
    const counts = data as { wallet_deleted: number; ads_deleted: number };

    console.log('[ROLLBACK] Step 2: Rollback completed', {
      batchId: batch_id,
      counts,
    });

    return NextResponse.json({
      success: true,
      message: `Rollback สำเร็จ: ลบ wallet ${counts.wallet_deleted} รายการ, ads ${counts.ads_deleted} รายการ`,
      counts,
    });
  } catch (error) {
    console.error('[ROLLBACK] Unexpected error:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Unexpected error',
        message: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      },
      { status: 500 }
    );
  }
}
