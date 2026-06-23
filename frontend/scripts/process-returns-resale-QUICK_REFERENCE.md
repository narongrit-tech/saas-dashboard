# Quick Reference: process-returns-resale.ts

## What It Does (30 seconds)

Processes 65+ inventory returns, maps them to main SKUs (NEWONN001/NEWONN002), and creates stock adjustments.

## Run It

```bash
# Dry run (preview only)
npx tsx scripts/process-returns-resale.ts --dry-run

# Full execution
npx tsx scripts/process-returns-resale.ts

# Custom user
npx tsx scripts/process-returns-resale.ts --created-by <uuid>
```

## Configure

Edit the product ID mappings in the script:

```typescript
const FRESH_UP_PRODUCT_IDS = new Set<string>([
  'product_id_1',  // → NEWONN001
  'product_id_2',
  // ...
])

const WIND_DOWN_PRODUCT_IDS = new Set<string>([
  'product_id_3',  // → NEWONN002
  'product_id_4',
  // ...
])

// Default: NEWONN001
```

## Expected Output

```
[1/2] Querying inventory_returns...
  ℹ 65 return(s) found

[2/2] Creating ADJUST_IN adjustments...
  ✓ ADJUST_IN created: return abc123 (SKU → NEWONN001 qty=10) → adj def456
  ⟳ Skipped (already processed): return xyz789
  ❌ Failed: return fail001

==================================================
SUMMARY
{
  "queried": 65,
  "processed": 63,
  "skipped": 1,
  "errors": 1,
  "totalQtyProcessed": 630
}

✓ Returns processed: 63 processed, 1 skipped (65 total)
✓ Stock added: 630 units
```

## Database Flow

```
inventory_returns
  ↓ (query: qty_returned > 0 AND can_resell = true)
  ↓ (map product_id → main SKU)
  ↓
inventory_adjustments
  (adjustment_type='ADJUST_IN', quantity=qty_returned, reason='Resale from return')
  ↓ (trigger auto-executes)
  ↓
inventory_receipt_layers
  (qty_received, qty_remaining, unit_cost=0, ref_type='ADJUST_IN')
```

## Key Features

✓ Dry-run support (preview without writing)
✓ Idempotent (safe to re-run—skips already processed)
✓ Batch processing (all 65 returns in one run)
✓ Error handling (partial failures don't stop batch)
✓ Bangkok timezone aware
✓ JSON summary output

## Idempotency

Returns already processed are skipped (status='skipped'). Safe to run multiple times.

## Exit Codes

- **0**: Success (or no errors)
- **1**: Errors occurred (review JSON summary)

## Default User UUID

```
2c4e254d-c779-4f8a-af93-603dc26e6af0
```

Override with `--created-by <uuid>` if needed.

## Main SKUs

| Mapping | SKU |
|---------|-----|
| Fresh Up stock | NEWONN001 |
| Wind Down stock | NEWONN002 |
| Unknown/default | NEWONN001 |

Must exist in `inventory_items` before running.

## Verify Success

```sql
-- Count adjustments created
SELECT COUNT(*) FROM inventory_adjustments
WHERE reason LIKE 'Resale from return%';

-- Check stock added
SELECT sku_internal, SUM(qty_remaining)
FROM inventory_receipt_layers
WHERE ref_type = 'ADJUST_IN'
GROUP BY sku_internal;
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Target SKU not found" | Ensure NEWONN001/NEWONN002 exist in inventory_items |
| All skipped | Already processed; check inventory_adjustments |
| FK error | Verify sku_internal is valid |
| No output | Check .env.local database credentials |

## Files

- **Script**: `scripts/process-returns-resale.ts`
- **Docs**: `scripts/process-returns-resale.README.md` (detailed)
- **This**: `scripts/QUICK_REFERENCE.md` (quick start)

## Related

- **import-inventory-receipts.ts**: Similar batch import pattern
- **Database**: migrations 33, 55, 70, 84 (inventory tables)
