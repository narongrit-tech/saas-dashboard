# process-returns-resale.ts — Return to Resale Mapping Script

**Purpose:** Map and process inventory returns that can be resold to main SKUs (NEWONN001, NEWONN002), creating inventory adjustments that automatically generate receipt layers via database trigger.

## Overview

This script processes 65+ returns from the `inventory_returns` table with `qty_returned > 0` AND `can_resell = true`, mapping TikTok product IDs to canonical internal SKUs and creating `ADJUST_IN` adjustments that flow through the inventory system.

### What It Does

1. **Queries** inventory_returns table for resellable items
2. **Maps** TikTok product IDs → main SKUs:
   - Products from Fresh Up stock → `NEWONN001`
   - Products from Wind Down stock → `NEWONN002`
   - Unknown source → defaults to `NEWONN001`
3. **Creates** inventory_adjustments rows with:
   - `type='ADJUST_IN'`
   - `reason='Resale from return'`
   - `qty=qty_returned`
   - `created_by=system_user_uuid`
4. **Auto-generates** inventory_receipt_layers via database trigger
5. **Outputs** JSON summary with processing status

---

## Database Schema

### Key Tables

**inventory_returns**
```
id              UUID
marketplace_sku TEXT      (raw SKU from marketplace)
sku             TEXT      (legacy column)
qty_returned    INTEGER   (positive, quantity being returned)
can_resell      BOOLEAN   (true if eligible for resale)
product_id      TEXT      (TikTok product ID—used for mapping)
returned_at     TIMESTAMPTZ
```

**inventory_adjustments** (created by script)
```
id              UUID (auto-generated)
sku_internal    VARCHAR(100)  (mapped SKU: NEWONN001/NEWONN002)
adjustment_type VARCHAR(20)   (always 'ADJUST_IN')
quantity        NUMERIC(12,4) (qty_returned from return record)
reason          TEXT          ('Resale from return — return_id:...')
adjusted_at     TIMESTAMPTZ   (from returned_at or current Bangkok time)
created_by      UUID          (system user or --created-by param)
created_at      TIMESTAMPTZ   (auto-set)
layer_id        UUID          (set by trigger to inventory_receipt_layers.id)
```

**inventory_receipt_layers** (auto-created via trigger)
```
id              UUID
sku_internal    VARCHAR(100)  (from adjustment)
received_at     TIMESTAMPTZ   (from adjusted_at)
qty_received    DECIMAL(12,4) (from quantity)
qty_remaining   DECIMAL(12,4) (same as qty_received initially)
unit_cost       DECIMAL(12,2) (0 for ADJUST_IN)
ref_type        VARCHAR(50)   ('ADJUST_IN')
ref_id          UUID          (points back to inventory_adjustments.id)
```

---

## Configuration

### Product ID Mapping

Edit the constants at the top of the script to configure which TikTok product IDs map to which SKU:

```typescript
/** TikTok product IDs that came from Fresh Up stock → map to NEWONN001 */
const FRESH_UP_PRODUCT_IDS = new Set<string>([
  'product_id_1',
  'product_id_2',
  // ...
])

/** TikTok product IDs that came from Wind Down stock → map to NEWONN002 */
const WIND_DOWN_PRODUCT_IDS = new Set<string>([
  'product_id_3',
  'product_id_4',
  // ...
])
```

If a product_id is not in either set, it defaults to `NEWONN001`.

### Default System User UUID

The script uses this default created_by UUID:
```
2c4e254d-c779-4f8a-af93-603dc26e6af0
```

Override with `--created-by` flag at runtime if needed.

---

## Usage

### Prerequisites

```bash
# Ensure environment is set up
cd D:\AI_OS\projects\saas-dashboard\frontend

# Install dependencies (if not already done)
npm install
```

### Basic Execution

#### Dry Run (Preview Only)
```bash
npx tsx scripts/process-returns-resale.ts --dry-run
```

Shows what would be done without writing to database.

#### Full Execution
```bash
npx tsx scripts/process-returns-resale.ts
```

Uses default system user UUID (2c4e254d-c779-4f8a-af93-603dc26e6af0).

#### With Custom User
```bash
npx tsx scripts/process-returns-resale.ts --created-by xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

#### Help
```bash
npx tsx scripts/process-returns-resale.ts --help
```

---

## Output

### Console Output

```
[1/2] Querying inventory_returns (qty_returned > 0 AND can_resell = true)...
  ℹ 65 return(s) with qty_returned > 0 AND can_resell = true

[2/2] Creating ADJUST_IN adjustments for resale mapping...
  ✓ ADJUST_IN created: return abc123 (PRODUCT_SKU → NEWONN001 qty=10) → adj def456
  ⟳ Skipped (already processed): return xyz789 (PRODUCT_SKU → NEWONN002 qty=5)
  ❌ Failed to create adjustment: return fail001 (BROKEN_SKU → NEWONN001) — FK constraint violated

==================================================
SUMMARY
==================================================
{
  "queried": 65,
  "eligible": 65,
  "processed": 63,
  "skipped": 1,
  "errors": 1,
  "totalQtyProcessed": 630,
  "results": [
    {
      "return_id": "abc123",
      "product_id": "product_1",
      "marketplace_sku": "SKU_001",
      "mapped_sku": "NEWONN001",
      "qty_returned": 10,
      "adjustmentId": "def456",
      "status": "processed"
    },
    ...
  ],
  "dryRun": false,
  "runAt": "2026-06-05T16:45:30.123Z"
}

✓ Returns processed: 63 processed, 1 skipped (65 total)
✓ Stock added: 630 units
✓ All adjustments auto-created inventory_receipt_layers via trigger
```

### JSON Summary Structure

- **queried**: Total returns found in database
- **eligible**: Returns with qty_returned > 0 AND can_resell = true (same as queried)
- **processed**: Adjustments successfully created
- **skipped**: Already processed (idempotency check passed)
- **errors**: Failed to process
- **totalQtyProcessed**: Sum of qty_returned for all processed items
- **dryRun**: Whether --dry-run flag was set
- **runAt**: ISO timestamp of execution
- **results[].return_id**: UUID of the return record
- **results[].product_id**: TikTok product ID
- **results[].marketplace_sku**: Raw SKU from marketplace (backfilled)
- **results[].mapped_sku**: Target main SKU (NEWONN001 or NEWONN002)
- **results[].qty_returned**: Quantity being resold
- **results[].adjustmentId**: UUID of created inventory_adjustment (if successful)
- **results[].status**: 'processed' | 'skipped' | 'error'
- **results[].error**: Error message if status='error'

---

## Idempotency & Safety

### Duplicate Protection

The script checks if an adjustment has already been created for a return by searching `inventory_adjustments` for a row where:
```sql
reason LIKE '%return_id:{return_id}%'
```

If found, the return is **skipped** with status='skipped' (safe to re-run).

### Validation

1. **SKU Existence**: Verifies target SKU exists in `inventory_items` before creating adjustment
2. **Created By**: Validates that `--created-by` UUID (if provided) is valid format
3. **Quantity Check**: Only processes returns with `qty_returned > 0`
4. **Resell Flag**: Only processes returns with `can_resell = true`

### Error Handling

- Database errors are caught and logged with specific error messages
- Partial failures don't stop the batch—other returns continue processing
- Exit code 1 if any errors occur; 0 otherwise
- All results logged to JSON summary for debugging

---

## Timezone Handling

- Database queries and insertions use **Bangkok timezone** (Asia/Bangkok)
- `adjusted_at` timestamp is set to the `returned_at` value from the return record
- If `returned_at` is missing, defaults to 09:00 Bangkok time on current date
- Converted to UTC ISO format for storage in PostgreSQL

---

## Common Issues

### Issue: "Target SKU not found in inventory_items"
**Cause**: The mapped SKU (NEWONN001 or NEWONN002) doesn't exist.
**Solution**: Ensure both main SKUs are created in `inventory_items` first.

### Issue: "Idempotency check failed"
**Cause**: Database error during dedup lookup.
**Solution**: Check database connectivity and permissions.

### Issue: "FK constraint violated"
**Cause**: The marketplace_sku or sku doesn't exist in a referenced table.
**Solution**: Verify the sku_internal value is valid and exists.

### Issue: "created_by not valid UUID"
**Cause**: --created-by parameter is malformed.
**Solution**: Use proper UUID format (8-4-4-4-12 hex digits).

### Issue: No adjustments created (all skipped)
**Cause**: All returns were already processed in a previous run.
**Solution**: Check `inventory_adjustments` table for existing records, or manually review which returns need (re-)processing.

---

## Batch Processing Details

- **Concurrency**: Sequential processing (one return at a time) for better error isolation
- **Batch Size**: No hard limit; script processes all eligible returns in one run
- **Expected Runtime**: ~1-2 minutes for 65 returns (depending on network latency)
- **Progress Output**: Each return is logged as it completes

---

## Database Trigger Reference

When an ADJUST_IN adjustment is created, the database trigger automatically:

```sql
-- Pseudocode for trigger behavior
INSERT INTO inventory_receipt_layers (
  sku_internal,
  received_at,      -- from adjustment.adjusted_at
  qty_received,     -- from adjustment.quantity
  qty_remaining,    -- same as qty_received
  unit_cost,        -- 0 for ADJUST_IN
  ref_type,         -- 'ADJUST_IN'
  ref_id,           -- inventory_adjustments.id
  ...
)
-- And links back to adjustment.layer_id
UPDATE inventory_adjustments
SET layer_id = {newly_created_layer_id}
WHERE id = {adjustment_id}
```

This ensures stock is immediately available in the FIFO allocation system.

---

## Example Workflow

```bash
# 1. Configure product IDs in the script
vim scripts/process-returns-resale.ts
# → Add FRESH_UP_PRODUCT_IDS and WIND_DOWN_PRODUCT_IDS

# 2. Dry run to verify
npx tsx scripts/process-returns-resale.ts --dry-run

# 3. Review output and summary JSON

# 4. Full execution
npx tsx scripts/process-returns-resale.ts

# 5. Verify in database
# SELECT COUNT(*) FROM inventory_adjustments
# WHERE reason LIKE 'Resale from return%'

# 6. Check inventory levels
# SELECT sku_internal, SUM(qty_remaining) FROM inventory_receipt_layers
# WHERE ref_type = 'ADJUST_IN'
# GROUP BY sku_internal
```

---

## Related Scripts

- **import-inventory-receipts.ts**: Original pattern for batch importing stock receipts
- **Database Migrations**:
  - migration-055-returns-v1.sql (inventory_returns table)
  - migration-070-sku-mappings-returns-columns.sql (marketplace_sku + sku_internal)
  - migration-084-inventory-adjustments.sql (ADJUST_IN/ADJUST_OUT)
  - migration-033-inventory-costing-engine.sql (receipt layers + FIFO)

---

## Questions & Support

For issues or questions:
1. Check console output and JSON summary for specific error messages
2. Verify SKU mappings are correctly configured
3. Ensure `inventory_items` contains NEWONN001 and NEWONN002
4. Review database logs for trigger execution errors
5. Confirm database permissions for service role
