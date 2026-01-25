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
    // Note: Removed created_by filter (migration-011: RLS disabled, internal dashboard)
    const { data: settlements, error: settlementsError } = await supabase
      .from('settlement_transactions')
      .select('id, marketplace, txn_id, settled_time')
      .eq('import_batch_id', batchId);

    if (settlementsError) {
      throw new Error(`Failed to fetch settlements: ${settlementsError.message}`);
    }

    if (!settlements || settlements.length === 0) {
      return { reconciledCount: 0, notFoundInOnholdCount: 0, errors: [] };
    }

    console.log(`[Reconcile] Processing ${settlements.length} settlements (BULK mode with batching)`);

    // OPTIMIZATION: Fetch ALL matching unsettled transactions in BATCHED queries
    // Build list of txn_ids to search for
    const txnIds = settlements.map((s) => s.txn_id);

    // BATCHING: Split into chunks of 500 to avoid query limits
    const BATCH_SIZE = 500;
    const unsettledList: Array<{ id: string; marketplace: string; txn_id: string; status: string }> = [];

    for (let i = 0; i < txnIds.length; i += BATCH_SIZE) {
      const batch = txnIds.slice(i, i + BATCH_SIZE);
      console.log(`[Reconcile] Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(txnIds.length / BATCH_SIZE)} (${batch.length} items)`);

      const { data, error } = await supabase
        .from('unsettled_transactions')
        .select('id, marketplace, txn_id, status')
        .in('txn_id', batch);

      if (error) {
        throw new Error(`Failed to fetch unsettled transactions (batch ${i}): ${error.message}`);
      }

      if (data) {
        unsettledList.push(...data);
      }
    }

    console.log(`[Reconcile] Found ${unsettledList.length} matching unsettled records`);

    // Build a Map for fast lookup: (marketplace + txn_id) -> unsettled record
    const unsettledMap = new Map<string, { id: string; status: string }>();
    unsettledList?.forEach((u) => {
      const key = `${u.marketplace}::${u.txn_id}`;
      unsettledMap.set(key, { id: u.id, status: u.status });
    });

    // Match settlements with unsettled records (in-memory)
    const toUpdate: Array<{ id: string; settled_at: string }> = [];

    for (const settlement of settlements) {
      const key = `${settlement.marketplace}::${settlement.txn_id}`;
      const unsettled = unsettledMap.get(key);

      if (!unsettled) {
        // No matching forecast found
        notFoundInOnholdCount++;
        continue;
      }

      // If already settled, skip
      if (unsettled.status === 'settled') {
        continue;
      }

      // Add to bulk update list
      toUpdate.push({
        id: unsettled.id,
        settled_at: settlement.settled_time,
      });
    }

    console.log(`[Reconcile] ${toUpdate.length} records to reconcile`);

    // OPTIMIZATION: Bulk update in BATCHED queries
    if (toUpdate.length > 0) {
      const idsToUpdate = toUpdate.map((u) => u.id);

      // BATCHING: Split updates into chunks of 500 to avoid query limits
      const UPDATE_BATCH_SIZE = 500;
      let totalUpdated = 0;

      for (let i = 0; i < idsToUpdate.length; i += UPDATE_BATCH_SIZE) {
        const batch = idsToUpdate.slice(i, i + UPDATE_BATCH_SIZE);
        console.log(`[Reconcile] Updating batch ${Math.floor(i / UPDATE_BATCH_SIZE) + 1}/${Math.ceil(idsToUpdate.length / UPDATE_BATCH_SIZE)} (${batch.length} items)`);

        const { error: updateError } = await supabase
          .from('unsettled_transactions')
          .update({ status: 'settled' })
          .in('id', batch);

        if (updateError) {
          errors.push(`Bulk update failed (batch ${i}): ${updateError.message}`);
        } else {
          totalUpdated += batch.length;
        }
      }

      reconciledCount = totalUpdated;
      console.log(`[Reconcile] Successfully reconciled ${reconciledCount} records`);
    }

    console.log(`[Reconcile] Not found in forecast: ${notFoundInOnholdCount}`);

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

  // Count settled transactions (removed created_by filter)
  const { count: settledCount } = await supabase
    .from('settlement_transactions')
    .select('*', { count: 'exact', head: true })
    .gte('settled_time', startDate)
    .lte('settled_time', endDate);

  // Count unsettled transactions (removed created_by filter)
  const { count: unsettledCount } = await supabase
    .from('unsettled_transactions')
    .select('*', { count: 'exact', head: true })
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
