#!/usr/bin/env python3
"""
Stock Allocation Script - YTD 2026 (Jan-June) FIFO Method

Purpose:
  Allocate ALL unshipped orders (Jan-June 2026) from receipt layers using FIFO method
  with comprehensive bundle explosion and final stock summary.

Steps:
1. Fetch ALL unshipped orders (shipped_at IS NULL, status_group != 'ยกเลิกแล้ว')
   across all months Jan-June 2026
2. Fetch inventory_items to get is_bundle flag (authoritative)
3. Fetch bundle components from inventory_bundle_components
4. Fetch receipt layers sorted FIFO (by created_at, earliest first)
5. Explode bundle SKUs (NEWONN003, NEWONN011, #0007, #0008, #0080, NEWONN111)
   → allocate components FIFO
6. Insert/upsert inventory_cogs_allocations
7. Show final summary: remaining stock by SKU
8. Compare actual vs expected: Fresh Up=789, Wind Down=441

Expected Remaining Stock:
  - NEWONN001 (Fresh Up): 789 units
  - NEWONN002 (Wind Down): 441 units

Usage:
  python allocate-ytd-2026.py            # live run
  python allocate-ytd-2026.py --dry-run  # preview without DB writes
"""

import os
import sys
import uuid
import hashlib
from datetime import datetime
from typing import Dict, List, Set, Tuple
from collections import defaultdict
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), '../.env.local')
load_dotenv(env_path)

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase library not found. Run: pip install supabase")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
CREATED_BY   = '2c4e254d-c779-4f8a-af93-603dc26e6af0'

# Expected remaining stock after allocation
EXPECTED = {
    'NEWONN001': {'name': 'Fresh Up',   'remaining': 789},
    'NEWONN002': {'name': 'Wind Down',  'remaining': 441},
}

# Bundle SKUs that must be handled (explicit list)
BUNDLE_SKUS_EXPLICIT = {
    'NEWONN003',
    'NEWONN011',
    '#0007',
    '#0008',
    '#0080',
    'NEWONN111',
}

DRY_RUN = '--dry-run' in sys.argv

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase credentials in .env.local")
    sys.exit(1)

db = create_client(SUPABASE_URL, SUPABASE_KEY)

# ──────────────────────────────────────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────────────────────────────────────

class Order:
    def __init__(self, d: dict):
        self.id         = d.get('id')
        self.order_id   = d.get('order_id')
        self.sku        = d.get('seller_sku') or d.get('sku')
        self.quantity   = d.get('quantity', 0)
        self.created_at = d.get('created_at')
        self.status_group = d.get('status_group')

class Layer:
    def __init__(self, d: dict):
        self.id            = d.get('id')
        self.sku_internal  = d.get('sku_internal')
        self.qty_remaining = float(d.get('qty_remaining', 0))
        self.unit_cost     = float(d.get('unit_cost', 0))
        self.created_at    = d.get('created_at')

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def det_uuid(seed: str) -> str:
    """Generate deterministic UUID from seed string"""
    h = list(hashlib.sha256(seed.encode()).digest()[:16])
    h[6] = (h[6] & 0x0f) | 0x50
    h[8] = (h[8] & 0x3f) | 0x80
    return str(uuid.UUID(bytes=bytes(h)))

def fmt(n) -> str:
    """Format number with thousand separators"""
    return '{:,}'.format(int(n))

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print('=' * 80)
    print('  STOCK ALLOCATION YTD 2026 (JAN-JUNE) - FIFO METHOD')
    if DRY_RUN:
        print('  [DRY RUN - no DB writes]')
    print('=' * 80)

    # ── 1. Unshipped orders (Jan-June 2026) ──────────────────────────────────
    print('\n▶ Step 1: Fetching ALL unshipped orders (Jan-June 2026)...')
    
    # Date range: Jan 1 - June 30, 2026
    date_from = '2026-01-01T00:00:00Z'
    date_to   = '2026-06-30T23:59:59Z'
    
    resp = db.table('sales_orders').select(
        'id, order_id, sku, seller_sku, quantity, created_at, status_group, shipped_at'
    ).neq('status_group', 'จัดส่งแล้ว').neq('status_group', 'เสร็จสมบูรณ์').neq('status_group', 'ยกเลิกแล้ว').gte(
        'created_at', date_from
    ).lte('created_at', date_to).order('created_at').execute()

    orders = [Order(r) for r in (resp.data or [])]
    print('  ✓ {} unshipped line items'.format(len(orders)))
    
    if not orders:
        print('  No unshipped orders. Exiting.')
        return

    # Count by month
    months_count = defaultdict(int)
    for o in orders:
        month = o.created_at[:7] if o.created_at else 'unknown'
        months_count[month] += 1
    
    print('  Distribution by month:')
    for month in sorted(months_count.keys()):
        print('    • {}: {} items'.format(month, months_count[month]))

    # ── 2. inventory_items → is_bundle (authoritative) ───────────────────────
    print('\n▶ Step 2: Fetching inventory_items (is_bundle flag)...')
    resp = db.table('inventory_items').select(
        'sku_internal, product_name, is_bundle'
    ).execute()

    item_rows    = resp.data or []
    bundle_skus_db: Set[str] = {r['sku_internal'] for r in item_rows if r.get('is_bundle')}
    name_map:    Dict[str, str] = {r['sku_internal']: r.get('product_name', '') for r in item_rows}

    print('  ✓ {} items, {} marked is_bundle=true in DB'.format(len(item_rows), len(bundle_skus_db)))
    
    # Combine: explicit list + DB flags
    bundle_skus = bundle_skus_db | BUNDLE_SKUS_EXPLICIT
    
    print('  ✓ Total bundles to handle: {} SKUs'.format(len(bundle_skus)))
    for s in sorted(bundle_skus):
        source = 'DB' if s in bundle_skus_db else 'explicit list'
        product_name = name_map.get(s, '?')
        print('    • {}  ({})  ({})'.format(s, source, product_name))

    # ── 3. Bundle components ─────────────────────────────────────────────────
    print('\n▶ Step 3: Fetching bundle components...')
    resp = db.table('inventory_bundle_components').select(
        'bundle_sku, component_sku, quantity'
    ).execute()

    bundle_map: Dict[str, List[dict]] = defaultdict(list)
    for r in (resp.data or []):
        bundle_map[r['bundle_sku']].append({
            'component_sku': r['component_sku'],
            'qty_per_bundle': float(r['quantity']),
        })

    components_total = sum(len(v) for v in bundle_map.values())
    print('  ✓ {} components across {} bundles'.format(components_total, len(bundle_map)))
    for bsku in sorted(bundle_map.keys()):
        if bsku in bundle_skus:  # Only show relevant ones
            parts = ', '.join('{}x{:.0f}'.format(c['component_sku'], c['qty_per_bundle']) for c in bundle_map[bsku])
            print('    • {} → {}'.format(bsku, parts))

    # Warn: bundle_skus with no components
    missing_def = bundle_skus - set(bundle_map.keys())
    if missing_def:
        print('\n  ⚠️  Bundle SKUs with no components defined:')
        for s in sorted(missing_def):
            print('    • {}'.format(s))

    # ── 4. Receipt layers (FIFO) ──────────────────────────────────────────────
    print('\n▶ Step 4: Fetching receipt layers (FIFO by created_at)...')
    resp = db.table('inventory_receipt_layers').select(
        'id, sku_internal, qty_remaining, unit_cost, created_at'
    ).gt('qty_remaining', 0).order('created_at').execute()

    layers_by_sku: Dict[str, List[Layer]] = defaultdict(list)
    for r in (resp.data or []):
        layers_by_sku[r['sku_internal']].append(Layer(r))

    total_layers = sum(len(v) for v in layers_by_sku.values())
    print('  ✓ {} layers with remaining stock'.format(total_layers))
    
    # Show top SKUs by total remaining
    sku_totals = []
    for sku, layers in layers_by_sku.items():
        total = sum(l.qty_remaining for l in layers)
        sku_totals.append((sku, total, len(layers)))
    
    print('  Top SKUs by remaining stock:')
    for sku, total, num_layers in sorted(sku_totals, key=lambda x: -x[1])[:10]:
        print('    • {}: {} units ({} layers)'.format(sku, fmt(total), num_layers))

    # ── 5. Allocate FIFO ──────────────────────────────────────────────────────
    print('\n▶ Step 5: Exploding bundles & allocating FIFO...\n')

    allocations:       List[dict]       = []
    allocated_by_sku:  Dict[str, float] = defaultdict(float)
    bundle_units_sold: Dict[str, float] = defaultdict(float)
    issues:            List[str]        = []

    for idx, order in enumerate(orders, 1):
        sku = order.sku
        qty = float(order.quantity)

        # Show progress every 100 orders
        if idx % 100 == 0 or idx == 1:
            print('  Processing order {}/{}.'.format(idx, len(orders)))

        # Determine if bundle
        is_bundle = sku in bundle_skus
        components = bundle_map.get(sku, [])

        if not is_bundle and components:
            print('  ⚠️  {} has components but is_bundle=false → treating as bundle'.format(sku))
            is_bundle = True

        if is_bundle:
            if not components:
                msg = 'Bundle {} (is_bundle) has no components defined'.format(sku)
                print('  ✗ {}'.format(msg))
                issues.append(msg)
                continue

            bundle_units_sold[sku] += qty
            # print(f'  [BUNDLE] {sku}  qty={fmt(qty)}')

            for comp in components:
                comp_sku   = comp['component_sku']
                qty_needed = qty * comp['qty_per_bundle']
                qty_left   = qty_needed
                comp_layers = layers_by_sku.get(comp_sku, [])

                if not comp_layers:
                    msg = 'No receipt layers for component {} (needed by bundle {})'.format(comp_sku, sku)
                    print('    ✗ {}'.format(msg))
                    issues.append(msg)
                    continue

                for layer in comp_layers:
                    if qty_left <= 0:
                        break
                    take = min(qty_left, layer.qty_remaining)
                    if take <= 0:
                        continue

                    seed_str = order.order_id + ':' + order.id + ':' + layer.id + ':' + comp_sku
                    alloc_id = det_uuid(seed_str)
                    shipped_at = datetime.utcnow().isoformat() + 'Z'
                    allocations.append({
                        'id':            alloc_id,
                        'order_id':      order.id,
                        'sku_internal':  comp_sku,
                        'qty':           int(take),
                        'unit_cost_used': layer.unit_cost,
                        'layer_id':      layer.id,
                        'shipped_at':    shipped_at,
                        'method':        'FIFO',
                        'amount':        layer.unit_cost * take,
                        'is_reversal':   False,
                        'created_by':    CREATED_BY,
                    })

                    allocated_by_sku[comp_sku] += take
                    layer.qty_remaining        -= take
                    qty_left                   -= take

                if qty_left > 0:
                    msg = 'Insufficient stock for {}: needed {}, short by {}'.format(
                        comp_sku, fmt(qty_needed), fmt(qty_left))
                    print('    ✗ {}'.format(msg))
                    issues.append(msg)

        else:
            # Regular SKU
            qty_left   = qty
            sku_layers = layers_by_sku.get(sku, [])

            if not sku_layers:
                msg = 'No receipt layers for SKU {}'.format(sku)
                print('  ✗ {}'.format(msg))
                issues.append(msg)
                continue

            for layer in sku_layers:
                if qty_left <= 0:
                    break
                take = min(qty_left, layer.qty_remaining)
                if take <= 0:
                    continue

                seed_str = order.order_id + ':' + order.id + ':' + layer.id + ':' + sku
                alloc_id = det_uuid(seed_str)
                shipped_at = datetime.utcnow().isoformat() + 'Z'
                allocations.append({
                    'id':            alloc_id,
                    'order_id':      order.id,
                    'sku_internal':  sku,
                    'qty':           int(take),
                    'unit_cost_used': layer.unit_cost,
                    'layer_id':      layer.id,
                    'shipped_at':    shipped_at,
                    'method':        'FIFO',
                    'amount':        layer.unit_cost * take,
                    'is_reversal':   False,
                    'created_by':    CREATED_BY,
                })

                allocated_by_sku[sku] += take
                layer.qty_remaining   -= take
                qty_left              -= take

            if qty_left > 0:
                msg = 'Insufficient stock for {}: needed {}, short by {}'.format(
                    sku, fmt(qty), fmt(qty_left))
                print('  ✗ {}'.format(msg))
                issues.append(msg)

    print('\n  ✓ {} allocation records prepared'.format(len(allocations)))

    # ── 6. Insert to DB ───────────────────────────────────────────────────────
    print('\n▶ Step 6: Inserting allocation records...')
    if DRY_RUN:
        print('  [DRY RUN] Skipping DB writes')
    elif allocations:
        batch_size = 500
        for i in range(0, len(allocations), batch_size):
            batch = allocations[i:i + batch_size]
            db.table('inventory_cogs_allocations').upsert(batch).execute()
            batch_num = i // batch_size + 1
            print('  ✓ Batch {}: {} records upserted'.format(batch_num, len(batch)))
    else:
        print('  Nothing to insert')

    # ── 7. Summary report ────────────────────────────────────────────────────
    remaining_by_sku: Dict[str, float] = defaultdict(float)
    for layers in layers_by_sku.values():
        for l in layers:
            remaining_by_sku[l.sku_internal] += l.qty_remaining

    print()
    print('=' * 80)
    print('  ALLOCATION SUMMARY REPORT - YTD 2026')
    print('=' * 80)

    print('\n📊 OVERVIEW')
    print('  Date range          : 2026-01-01 to 2026-06-30')
    print('  Unshipped line items: {}'.format(len(orders)))
    print('  Allocation records  : {}'.format(len(allocations)))
    print('  Total qty allocated : {}'.format(fmt(sum(allocated_by_sku.values()))))

    if bundle_units_sold:
        print('\n📦 BUNDLE UNITS SOLD')
        for bsku in sorted(bundle_units_sold.keys()):
            qty_bundles = bundle_units_sold[bsku]
            product_name = name_map.get(bsku, '?')
            print('  {} ({}): {} bundles'.format(bsku, product_name, fmt(qty_bundles)))

    print('\n📦 STOCK ALLOCATION BY SKU')
    all_skus = sorted(set(list(remaining_by_sku.keys()) + list(allocated_by_sku.keys())))
    for sku in all_skus:
        rem   = remaining_by_sku.get(sku, 0)
        alloc = allocated_by_sku.get(sku, 0)
        product_name = name_map.get(sku, '?')
        print('  {} ({})'.format(sku, product_name))
        print('    Allocated : {}'.format(fmt(alloc)))
        print('    Remaining : {}'.format(fmt(rem)))

    print('\n🔍 COMPARISON WITH EXPECTED')
    all_match = True
    for sku, exp in EXPECTED.items():
        actual = remaining_by_sku.get(sku, 0)
        match  = int(actual) == exp['remaining']
        icon   = '✓' if match else '✗'
        all_match = all_match and match
        print('  {} {} ({})'.format(icon, exp['name'], sku))
        print('      Expected remaining : {}'.format(exp['remaining']))
        print('      Actual remaining   : {}'.format(fmt(actual)))
        if not match:
            diff = int(actual) - exp['remaining']
            direction = 'over' if diff > 0 else 'under'
            print('      Difference         : {:+d}  ({} by {})'.format(diff, direction, abs(diff)))

    if all_match:
        print('\n  ✓ All values match expected!')
    else:
        print('\n  ✗ Some values do not match — check issues below')

    if issues:
        print('\n⚠️  ISSUES ({})'.format(len(issues)))
        for i, msg in enumerate(issues, 1):
            if i <= 20:
                print('  {}. {}'.format(i, msg))
        if len(issues) > 20:
            print('  ... and {} more'.format(len(issues) - 20))

    print()
    print('=' * 80)
    if DRY_RUN:
        print('  [DRY RUN] ALLOCATION COMPLETE')
    else:
        print('  ALLOCATION COMPLETE')
    print('=' * 80)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('\n✗ FATAL ERROR: {}'.format(e))
        import traceback
        traceback.print_exc()
        sys.exit(1)
