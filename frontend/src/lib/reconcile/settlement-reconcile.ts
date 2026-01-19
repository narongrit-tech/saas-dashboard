import { createClient } from '@/lib/supabase/server';

export interface ReconcileResult {
  reconciledCount: number;
  notFoundInOnholdCount: number;
  errors: string[];
}

/**
 * Reconcile settlement_transactions with unsettled_transactions
 * Marks matching unsettled transactions as 'settled'
 *
 * @param batchId - Import batch ID for settlements just imported
 * @param userId - User ID for RLS
 * @returns ReconcileResult with counts
 */
export async function reconcileSettlements(
  batchId: string,
  userId: string
): Promise<ReconcileResult> {
  const supabase = await createClient();
  let reconciledCount = 0;
  let notFoundInOnholdCount = 0;
  const errors: string[] = [];

  try {
    // Get all settlement_transactions from this batch
    const { data: settlements, error: settlementsError } = await supabase
      .from('settlement_transactions')
      .select('id, marketplace, txn_id, settled_time')
      .eq('import_batch_id', batchId)
      .eq('created_by', userId);

    if (settlementsError) {
      throw new Error(`Failed to fetch settlements: ${settlementsError.message}`);
    }

    if (!settlements || settlements.length === 0) {
      return { reconciledCount: 0, notFoundInOnholdCount: 0, errors: [] };
    }

    // Process each settlement
    for (const settlement of settlements) {
      try {
        // Find matching unsettled transaction
        const { data: unsettled, error: unsettledError } = await supabase
          .from('unsettled_transactions')
          .select('id, status')
          .eq('marketplace', settlement.marketplace)
          .eq('txn_id', settlement.txn_id)
          .eq('created_by', userId)
          .single();

        if (unsettledError || !unsettled) {
          // No matching forecast found
          notFoundInOnholdCount++;
          continue;
        }

        // If already settled, skip
        if (unsettled.status === 'settled') {
          continue;
        }

        // Mark as settled
        const { error: updateError } = await supabase
          .from('unsettled_transactions')
          .update({
            status: 'settled',
            settled_at: settlement.settled_time,
          })
          .eq('id', unsettled.id);

        if (updateError) {
          errors.push(`Failed to reconcile ${settlement.txn_id}: ${updateError.message}`);
        } else {
          reconciledCount++;
        }
      } catch (err) {
        errors.push(
          `Error processing ${settlement.txn_id}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    return { reconciledCount, notFoundInOnholdCount, errors };
  } catch (error) {
    throw new Error(
      `Reconciliation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get reconciliation status summary for a date range
 * Useful for UI display
 */
export async function getReconcileStatus(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalSettled: number;
  totalUnsettled: number;
  settledWithoutForecast: number;
  amountMismatch: number;
}> {
  const supabase = await createClient();

  // Count settled transactions
  const { count: settledCount } = await supabase
    .from('settlement_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', userId)
    .gte('settled_time', startDate)
    .lte('settled_time', endDate);

  // Count unsettled transactions
  const { count: unsettledCount } = await supabase
    .from('unsettled_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', userId)
    .eq('status', 'unsettled')
    .gte('estimated_settle_time', startDate)
    .lte('estimated_settle_time', endDate);

  // Count settled without forecast (left join, no match in unsettled)
  // This is a simplified count - for accurate results, need to check each settlement individually
  // For now, return 0 as this is just a helper function
  const settledWithoutForecastCount = 0;

  return {
    totalSettled: settledCount || 0,
    totalUnsettled: unsettledCount || 0,
    settledWithoutForecast: settledWithoutForecastCount,
    amountMismatch: 0, // TODO: Implement if needed
  };
}
