import { NextRequest, NextResponse } from 'next/server';
import { checkImportOverlap } from '@/app/(dashboard)/bank/import-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/bank/overlap
 * Check for overlapping transactions before import
 *
 * Body (FormData):
 * - file: File (required)
 * - bank_account_id: string (required)
 * - column_mapping: string (optional, JSON stringified)
 *
 * Returns:
 * {
 *   success: boolean,
 *   overlap?: {
 *     existing_count: number,
 *     date_range: { start: string, end: string },
 *     file_count: number
 *   },
 *   error?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bankAccountId = formData.get('bank_account_id') as string | null;
    const columnMappingStr = formData.get('column_mapping') as string | null;

    if (!file || !bankAccountId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: file, bank_account_id',
        },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const columnMapping = columnMappingStr ? JSON.parse(columnMappingStr) : undefined;

    const result = await checkImportOverlap(
      bankAccountId,
      buffer,
      file.name,
      columnMapping
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API /api/bank/overlap] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
