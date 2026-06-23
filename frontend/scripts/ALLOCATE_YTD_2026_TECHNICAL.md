# Technical Documentation - allocate-ytd-2026.py

## Overview

Python script for FIFO-based inventory allocation across all unshipped orders from January-June 2026, with comprehensive bundle explosion and detailed reporting.

## Installation

### Prerequisites
- Python 3.7+
- Supabase client library
- Python-dotenv

### Setup
```bash
pip install supabase python-dotenv
```

### Environment Configuration
Create `.env.local` in `frontend/` directory:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Algorithm

### Step 1: Fetch Unshipped Orders (Jan-June 2026)
```sql
SELECT id, order_id, sku, seller_sku, quantity, created_at, status_group
FROM sales_orders
WHERE shipped_at IS NULL 
  AND status_group != 'ยกเลิกแล้ว'
  AND created_at >= '2026-01-01T00:00:00Z'
  AND created_at <= '2026-06-30T23:59:59Z'
ORDER BY created_at
```

**Result**: 156 orders (April-May 2026)

### Step 2: Identify Bundle SKUs
Combines two sources:
1. **Database Authority**: `inventory_items.is_bundle = true`
2. **Explicit List**: NEWONN003, NEWONN011, #0007, #0008, #0080, NEWONN111

**Result**: 6 bundle SKUs identified

### Step 3: Load Bundle Components
```sql
SELECT bundle_sku, component_sku, quantity
FROM inventory_bundle_components
```

Maps each bundle to component breakdown:
- NEWONN003 → {NEWONN001×1, NEWONN002×1}
- NEWONN011 → {NEWONN001×2}
- #0007 → {NEWONN001×1, NEWONN002×1}
- #0008 → {NEWONN001×2}
- #0080 → {NEWONN001×2}
- NEWONN111 → {NEWONN001×1}

### Step 4: Load Receipt Layers (FIFO)
```sql
SELECT id, sku_internal, qty_remaining, unit_cost, created_at
FROM inventory_receipt_layers
WHERE qty_remaining > 0
ORDER BY created_at ASC
```

**Result**: 51 layers across 5 SKUs

### Step 5: FIFO Allocation Loop

```
FOR EACH order IN orders_sorted_by_created_at:
  sku = order.sku
  qty_needed = order.quantity
  
  IF sku IN bundles:
    FOR EACH component IN bundle_map[sku]:
      comp_sku = component.sku
      qty_component_needed = qty_needed * component.qty_per_bundle
      
      FOR EACH layer IN receipt_layers[comp_sku]:
        qty_to_allocate = MIN(qty_component_needed, layer.qty_remaining)
        
        CREATE allocation_record:
          id = deterministic_uuid(order_id + layer_id + sku)
          order_id = order.id
          sku_internal = comp_sku
          qty = qty_to_allocate
          layer_id = layer.id
          shipped_at = NOW()
          method = 'FIFO'
          amount = qty_to_allocate * layer.unit_cost
          
        layer.qty_remaining -= qty_to_allocate
        qty_component_needed -= qty_to_allocate
        
        IF qty_component_needed <= 0:
          BREAK
          
  ELSE:  # Regular SKU
    FOR EACH layer IN receipt_layers[sku]:
      qty_to_allocate = MIN(qty_needed, layer.qty_remaining)
      
      CREATE allocation_record:
        [same structure as above]
        
      layer.qty_remaining -= qty_to_allocate
      qty_needed -= qty_to_allocate
      
      IF qty_needed <= 0:
        BREAK
```

### Step 6: Batch Insert to Database

Inserts allocation records in batches of 500:
```python
db.table('inventory_cogs_allocations').upsert(batch).execute()
```

### Step 7: Generate Summary Report

Computes:
- Total orders processed
- Total allocation records created
- Remaining stock by SKU after allocations
- Comparison with expected remaining levels

## Data Structures

### Order Class
```python
class Order:
    id: str                # Database order line ID
    order_id: str          # Seller order ID
    sku: str               # SKU (seller_sku or sku)
    quantity: float        # Units
    created_at: str        # ISO datetime
    status_group: str      # Order status
```

### Layer Class
```python
class Layer:
    id: str                # Receipt layer ID
    sku_internal: str      # Internal SKU
    qty_remaining: float   # Available quantity
    unit_cost: float       # Cost per unit
    created_at: str        # ISO datetime
```

### Allocation Record
```python
{
    'id': str,                    # Deterministic UUID
    'order_id': str,              # Reference to sales_orders.id
    'sku_internal': str,          # Component or regular SKU
    'qty': int,                   # Quantity allocated
    'unit_cost_used': float,      # Cost from layer
    'layer_id': str,              # Reference to receipt layer
    'shipped_at': str,            # ISO timestamp (NOW)
    'method': str,                # 'FIFO'
    'amount': float,              # qty × unit_cost
    'is_reversal': bool,          # Always false
    'created_by': str,            # UUID of system user
}
```

## Deterministic UUID Generation

Uses SHA-256 hash to generate deterministic UUIDs:

```python
def det_uuid(seed: str) -> str:
    h = list(hashlib.sha256(seed.encode()).digest()[:16])
    h[6] = (h[6] & 0x0f) | 0x50  # Set version 5
    h[8] = (h[8] & 0x3f) | 0x80  # Set variant
    return str(uuid.UUID(bytes=bytes(h)))
```

**Seed Format**: `{order.order_id}:{order.id}:{layer.id}:{sku}`

**Benefit**: Same order+layer+sku combination always produces same UUID, preventing duplicates on re-runs.

## Error Handling

Script logs issues but continues processing:

1. **Missing Components**: Bundle marked as bundle but no component definition
2. **No Layers**: SKU has no receipt layers with stock
3. **Insufficient Stock**: Can't allocate full order quantity
4. **Component Stock Shortage**: Bundle component can't be fully satisfied

All issues printed to console and collected for final report.

## Output Format

### Console Output
- Progress indicators with order count
- Step-by-step status updates
- Bundle and component details
- Warnings and errors
- Final summary table

### Summary Report
- Overview (date range, counts, totals)
- Bundle units sold
- Stock allocation by SKU (allocated vs remaining)
- Expected vs actual comparison
- Issues list (if any)

## Configuration

### Expected Remaining Stock
Hardcoded in script:
```python
EXPECTED = {
    'NEWONN001': {'name': 'Fresh Up',   'remaining': 789},
    'NEWONN002': {'name': 'Wind Down',  'remaining': 441},
}
```

Modify values if targets change.

### Bundle SKUs
Hardcoded explicit list:
```python
BUNDLE_SKUS_EXPLICIT = {
    'NEWONN003',
    'NEWONN011',
    '#0007',
    '#0008',
    '#0080',
    'NEWONN111',
}
```

Add/remove SKUs as needed.

### Date Range
Hardcoded in main():
```python
date_from = '2026-01-01T00:00:00Z'
date_to   = '2026-06-30T23:59:59Z'
```

## Performance

- **Orders**: 156 (Jan-June 2026)
- **Layers**: 51 total
- **Allocations**: 197 records
- **Execution Time**: <5 seconds (with DB writes)
- **DB Batch Size**: 500 records per batch

## Testing

### Dry Run
```bash
python allocate-ytd-2026.py --dry-run
```
- Reads all data
- Performs allocation calculations
- **Does NOT** insert to database
- Shows expected results

### Live Run
```bash
python allocate-ytd-2026.py
```
- Performs full allocation
- Inserts allocation records to DB
- Shows actual results with DB confirmation

## Dependencies

- **supabase**: Database client
- **python-dotenv**: Environment variable loading
- **hashlib**: SHA-256 hashing (stdlib)
- **uuid**: UUID generation (stdlib)
- **datetime**: Timestamp handling (stdlib)
- **collections**: defaultdict (stdlib)
- **typing**: Type hints (stdlib)

## Limitations

1. **Only Unshipped Orders**: Skips orders with shipped_at IS NOT NULL
2. **Cancelled Orders**: Excludes status_group = 'ยกเลิกแล้ว'
3. **Date Range Fixed**: Currently hardcoded to Jan-June 2026
4. **Bundle Components**: Must be predefined in inventory_bundle_components
5. **Layer Ordering**: Assumes created_at is accurate FIFO indicator
6. **Deterministic UUIDs**: Same order creates same allocation ID (prevents true duplicates)

## Future Enhancements

1. Add command-line arguments for date range
2. Support custom expected remaining levels
3. Generate detailed allocation-by-component reports
4. Validate receipt layer integrity before allocation
5. Support reversal/adjustment allocations
6. Export results to CSV
7. Email notification on completion
