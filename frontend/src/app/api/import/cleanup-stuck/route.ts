import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 30 seconds timeout

/**
 * POST /api/import/cleanup-stuck
 *
 * Cleanup stuck batches (status='processing' for > 1 hour).
 * Marks them as 'failed' with note.
 *
 * DEV ONLY: Blocked in production environment.
 *
 * Response:
 * - success: { success: true, message: string, count: number }
 * - error: { success: false, error: string, message?: string }
 */
export async function POST(request: NextRequest) {
  try {
    // DEV ONLY: Block in production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'Cleanup API is disabled in production environment',
        },
        { status: 403 }
      );
    }

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[CLEANUP] Step 1: Received cleanup request', {
      userId: user.id,
      environment: process.env.NODE_ENV,
    });

    // Call RPC function: cleanup_stuck_batches
    const { data, error: rpcError } = await supabase.rpc('cleanup_stuck_batches');

    if (rpcError) {
      console.error('[CLEANUP] RPC error:', {
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
            message: 'cleanup_stuck_batches RPC function ไม่มี - กรุณารัน migration',
            details: {
              code: rpcError.code,
              hint: 'ต้องรัน migration ก่อนใช้งาน',
            },
          },
          { status: 500 }
        );
      }

      // Generic RPC error
      return NextResponse.json(
        {
          success: false,
          error: 'Cleanup failed',
          message: rpcError.message || 'เกิดข้อผิดพลาดในการ cleanup',
          details: {
            code: rpcError.code,
            dbError: rpcError.message,
            hint: rpcError.hint,
          },
        },
        { status: 500 }
      );
    }

    // Parse RPC result (count of updated batches)
    const count = data as number;

    console.log('[CLEANUP] Step 2: Cleanup completed', {
      count,
    });

    return NextResponse.json({
      success: true,
      message: `Cleanup สำเร็จ: ทำการ mark ${count} batches เป็น failed`,
      count,
    });
  } catch (error) {
    console.error('[CLEANUP] Unexpected error:', {
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
