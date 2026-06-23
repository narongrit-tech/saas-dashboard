# Stock Allocation YTD 2026 (Jan-June) - FIFO Method

## Summary

Created comprehensive script `allocate-ytd-2026.py` to allocate ALL unshipped orders from Jan-June 2026 using FIFO method with bundle explosion and detailed stock summary.

## Script Features

### 1. ✓ Data Retrieval
- **Unshipped Orders**: Fetches all orders where `shipped_at IS NULL` and `status_group != 'ยกเลิกแล้ว'`
- **Date Range**: 2026-01-01 to 2026-06-30
- **Orders Found**: 156 line items
  - April 2026: 90 items
  - May 2026: 66 items

### 2. ✓ Bundle Handling
Bundle SKUs recognized (6 total):
- **NEWONN003**: [แพ็คคู่] Fresh Up & Wind Down → NEWONN001×1 + NEWONN002×1
- **NEWONN011**: [แพ็คคู่] Fresh Up → NEWONN001×2
- **#0007**: [แพ็คคู่] Fresh Up & Wind Down → NEWONN001×1 + NEWONN002×1
- **#0008**: [แพ็คคู่] Fresh Up → NEWONN001×2
- **#0080**: [แพ็คคู่] Fresh Up → NEWONN001×2
- **NEWONN111**: [Live] Fresh Up → NEWONN001×1

### 3. ✓ FIFO Allocation
- **Receipt Layers**: 51 layers with remaining stock, sorted by `created_at` (FIFO)
- **Allocation Method**: 
  - Bundle orders → explode to component SKUs
  - Regular orders → allocate as-is
  - Each allocation pulled from earliest receipt layers first

### 4. ✓ Allocation Results (Current State - Dry Run)

**Orders Processed**: 156 line items
**Allocation Records**: 197 records
**Total Quantity Allocated**: 319 units

#### Bundle Units Sold:
- NEWONN003: 32 bundles
- NEWONN011: 8 bundles

#### Stock Allocation Summary:
| SKU | Product | Allocated | Remaining |
|-----|---------|-----------|-----------|
| NEWONN001 | Fresh Up | 255 | 1,714 |
| NEWONN002 | Wind Down | 64 | 438 |
| Others | Bundle SKUs | 0 | 28 |

### 5. 🔍 Expected vs Actual Comparison

| Product | Expected | Actual | Difference | Status |
|---------|----------|--------|-----------|--------|
| **Fresh Up (NEWONN001)** | 789 | 1,714 | +925 (over) | ✗ |
| **Wind Down (NEWONN002)** | 441 | 438 | -3 (under) | ✗ |

**Analysis**: 
- Fresh Up is currently 925 units OVER expected
- Wind Down is 3 units UNDER expected
- More orders need to be allocated to reach target levels

## Key Findings

1. **Limited Orders in YTD 2026**: Only 156 unshipped orders found (April-May only)
   - Suggests most Jan-Mar orders were already allocated/shipped
   - Data primarily from recent months

2. **Bundle Explosion Working**: Successfully identified and decomposed bundle orders
   - 40 bundle units sold (NEWONN003 + NEWONN011)
   - Components correctly allocated from layers

3. **FIFO Implementation**: Receipt layers sorted and allocated correctly
   - Earliest receipt (2026) layers consumed first
   - No allocation gaps detected

4. **Expected Stock Targets**: Targets suggest significant additional allocation needed
   - Target allocation for Fresh Up: ~1,180 units (1,969 - 789)
   - Current actual allocation: 255 units
   - Still need: ~925 more units

## Usage

### Dry Run (Preview - No DB Changes)
```bash
python allocate-ytd-2026.py --dry-run
```

### Live Run (Inserts Allocations to DB)
```bash
python allocate-ytd-2026.py
```

## Technical Details

### Data Classes
- **Order**: order_id, sku, quantity, created_at
- **Layer**: id, sku_internal, qty_remaining, unit_cost, created_at

### Allocation Logic
1. For each order (FIFO by created_at):
   - Check if SKU is bundle
   - If bundle: explode components, allocate each component separately
   - If regular: allocate directly
2. For each component/SKU needed:
   - Iterate through receipt layers (FIFO by created_at)
   - Take up to qty_needed from each layer
   - Create allocation record with deterministic UUID (sha256-based)
3. Update layer qty_remaining as allocations proceed

### Deterministic UUID Generation
Uses SHA256 hash of seed string: `{order_id}:{order_id_detail}:{layer_id}:{sku}`
- Ensures consistent IDs across multiple runs
- Prevents duplicate allocations on retry

## Database Tables Used

- `sales_orders`: Source of unshipped orders
- `inventory_items`: is_bundle flag authority
- `inventory_bundle_components`: Bundle composition
- `inventory_receipt_layers`: FIFO stock layers
- `inventory_cogs_allocations`: Destination for allocation records

## Next Steps

1. **Verify Data**: Check if more historical orders exist before Jan 2026
2. **Adjust Expected Values**: Confirm target remaining stock levels (789, 441)
3. **Run Live Allocation**: Execute with real DB writes if targets are correct
4. **Validate Results**: Verify actual remaining stock matches expectations
5. **Monthly Reports**: Generate similar reports for other months

## Notes

- Script handles missing components gracefully (logs issues)
- Supports both DB-marked bundles and explicit list
- Shows detailed progress and warnings
- Generates timestamp for each allocation (UTC)
- Batch inserts to DB (500 records per batch)
