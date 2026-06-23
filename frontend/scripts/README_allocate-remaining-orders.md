# NEWONN001 Allocation Script

## Quick Start

```bash
# Preview without database changes
python allocate-remaining-orders.py --dry-run

# Execute allocation
python allocate-remaining-orders.py
```

## What It Does

Allocates NEWONN001 (Fresh Up) orders from receipt layers to achieve target inventory:

- **Allocates**: 669 orders totaling 1,180 units
- **Method**: FIFO (First In First Out) from receipt layers
- **Creates**: 678 inventory_cogs_allocations records
- **Target**: Leave 789 units in stock after orders fulfilled

## Prerequisites

```bash
# Install dependencies
pip install supabase python-dotenv

# Ensure .env.local exists with:
NEXT_PUBLIC_SUPABASE_URL=<url>
SUPABASE_SERVICE_ROLE_KEY=<key>
```

## Output Example

```
================================================================================
  ALLOCATE NEWONN001 ORDERS TO TARGET LEVEL
================================================================================

[Step 1] Fetching NEWONN001 orders...
  ✓ Total 1000 NEWONN001 orders
  ✓ Total qty available: 1,813 units
  ✓ 1000 unallocated orders, 1,813 units

[Step 2] Fetching inventory_items (is_bundle flag)...
  ✓ 8 items, 6 bundle SKUs
    • NEWONN001 is a regular SKU

[Step 4] Fetching receipt layers (FIFO)...
  ✓ 51 layers with remaining stock
    • NEWONN001: 1,969 units (25 layers)

[Step 5] Allocating orders FIFO until 1,180 units allocated...

  Order 2601250CU52NCX: 1 units (total: 1, 0.1%)
  Order 260124V4G5FNJG: 2 units (total: 3, 0.3%)
  ... (669 orders total)
  Order 584192112716580207: 4 units (total: 1,180, 100.0%)

  Target allocation reached (1,180 >= 1,180)

  ✓ 678 allocation records prepared
  ✓ 669 orders used
  Total qty allocated: 1,180 units

[Step 6] Inserting allocation records into DB...
  ✓ Batch 1: 500 records upserted
  ✓ Batch 2: 178 records upserted

================================================================================
  ALLOCATION SUMMARY REPORT
================================================================================

OVERVIEW:
  Total NEWONN001 orders: 1000
  Orders allocated: 669
  Allocation records created: 678
  Total units allocated: 1,180
  Target allocation: 1,180

INVENTORY STATUS:
  NEWONN001 (Cool Smile Fresh Up)
    Allocated: 1,180
    Remaining: 789

EXPECTED VS ACTUAL:
  ✓ Fresh Up (NEWONN001)
      Expected remaining: 789
      Actual remaining: 789

================================================================================
  ALLOCATION COMPLETE
================================================================================
```

## Verification

```bash
# Count allocations created
curl -X GET \
  "https://<supabase>.supabase.co/rest/v1/inventory_cogs_allocations?sku_internal=eq.NEWONN001&select=qty" \
  -H "Authorization: Bearer <service-role-key>"
```

Or use Python:

```python
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv('.env.local')
db = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

resp = db.table('inventory_cogs_allocations').select('qty').eq(
    'sku_internal', 'NEWONN001'
).gte('shipped_at', '2026-06-05T10:56:00').execute()

total = sum(a['qty'] for a in (resp.data or []))
print(f"✅ Units allocated: {total}")
```

## How It Works

1. **Fetch orders**: Gets all 1,000 NEWONN001 orders ordered by creation date
2. **Identify unallocated**: Filters orders without existing allocations
3. **Load layers**: Retrieves receipt layers sorted by creation date (FIFO)
4. **Allocate**: Processes orders in sequence, allocating from layers until target reached
5. **Generate IDs**: Creates deterministic UUIDs to prevent duplicates
6. **Insert**: Batch inserts allocation records (500 per batch)
7. **Report**: Shows summary and verifies target achieved

## Notes

- ✅ Idempotent: Safe to run multiple times (same allocation IDs)
- ✅ Dry-run mode: Preview without changing database
- ✅ FIFO: Orders and layers allocated in creation order
- ✅ Batched: Large inserts split into 500-record batches
- ✅ Verified: Final summary confirms inventory targets

## Allocation Details

Each allocation record includes:
- `order_id`: Link to sales_orders.id
- `sku_internal`: NEWONN001
- `qty`: Units allocated
- `unit_cost_used`: Cost from receipt layer
- `layer_id`: Link to inventory_receipt_layers
- `shipped_at`: Timestamp of allocation
- `method`: "FIFO"
- `amount`: qty × unit_cost
- `created_by`: Service account ID

## Support

For issues, check:
1. `.env.local` has correct Supabase credentials
2. `pip install supabase` is installed
3. Database has sales_orders, inventory_receipt_layers, inventory_cogs_allocations tables
4. Service account has INSERT/UPDATE permissions on inventory_cogs_allocations

---

**Status**: ✅ Production Ready  
**Last Run**: 2026-06-05T10:56:55 UTC  
**Units Allocated**: 1,180 ✅
