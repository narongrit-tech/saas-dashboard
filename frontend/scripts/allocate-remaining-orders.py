#!/usr/bin/env python3
"""
Allocate NEWONN001 Orders - FIFO Method

Purpose:
  Allocate NEWONN001 (Fresh Up) orders from receipt layers FIFO to reach
  the target inventory level of 789 units remaining.

Task Details:
  - Fresh Up (NEWONN001): on-hand 1,969 -> expected 789 remaining
  - Need to allocate: 1,180 units (1,969 - 789)
  - Current allocations: 577 units (from other/mixed orders)
  - Still need: ~1,180 units from NEWONN001 orders
  - Receipt layers FIFO: 25 layers total, allocate in FIFO order

Steps:
  1. Fetch all NEWONN001 orders (ordered by created_at for FIFO)
  2. Get current state of receipt layers (FIFO ordered)
  3. Allocate orders sequentially from receipt layers until target reached
  4. Insert inventory_cogs_allocations records
  5. Show summary: Fresh Up should reach 789 units remaining

Usage:
  python allocate-remaining-orders.py            # live run
  python allocate-remaining-orders.py --dry-run  # preview without DB writes
"""

import os
import sys
import uuid
import hashlib
from datetime import datetime
from typing import Dict, List, Set
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

# NEWONN001 = Fresh Up
TARGET_SKU = 'NEWONN001'
TARGET_NAME = 'Fresh Up'
TARGET_ALLOCATION_QTY = 1180  # Units to allocate (1,969 - 789)
EXPECTED_REMAINING = 789
CURRENTLY_ON_HAND = 1969

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
    return f'{int(n):,}'

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print('=' * 80)
    if DRY_RUN:
        print('  ALLOCATE NEWONN001 ORDERS TO TARGET LEVEL  [DRY RUN - no DB writes]')
    else:
        print('  ALLOCATE NEWONN001 ORDERS TO TARGET LEVEL')
    print('=' * 80)

    # ── 1. Fetch all NEWONN001 orders (ordered by created_at for FIFO) ─────────
    print('\n[Step 1] Fetching NEWONN001 orders...')

    resp = db.table('sales_orders').select(
        'id, order_id, sku, seller_sku, quantity, created_at'
    ).eq('sku', TARGET_SKU).order('created_at').execute()

    all_orders = [Order(r) for r in (resp.data or [])]
    total_qty = sum(o.quantity for o in all_orders)
    print(f'  ✓ Total {len(all_orders)} {TARGET_SKU} orders')
    print(f'  ✓ Total qty available: {fmt(total_qty)} units')

    if not all_orders:
        print(f'  No {TARGET_SKU} orders found. Exiting.')
        return

    # Get already allocated order IDs
    resp = db.table('inventory_cogs_allocations').select('order_id').execute()
    allocated_order_ids: Set[str] = {r['order_id'] for r in (resp.data or [])}
    print(f'  ✓ {len(allocated_order_ids)} order IDs already have allocations')

    # Filter to unallocated
    unallocated_orders = [o for o in all_orders if o.id not in allocated_order_ids]
    unallocated_qty = sum(o.quantity for o in unallocated_orders)
    print(f'  ✓ {len(unallocated_orders)} unallocated orders, {fmt(unallocated_qty)} units')

    # ── 2. Fetch inventory_items (is_bundle flag) ────────────────────────────────
    print('\n[Step 2] Fetching inventory_items (is_bundle flag)...')
    resp = db.table('inventory_items').select(
        'sku_internal, product_name, is_bundle'
    ).execute()

    item_rows    = resp.data or []
    bundle_skus: Set[str] = {r['sku_internal'] for r in item_rows if r.get('is_bundle')}
    name_map:    Dict[str, str] = {r['sku_internal']: r.get('product_name', '') for r in item_rows}

    print(f'  ✓ {len(item_rows)} items, {len(bundle_skus)} bundle SKUs')
    is_bundle = TARGET_SKU in bundle_skus
    if is_bundle:
        print(f'    • {TARGET_SKU} is a BUNDLE')
    else:
        print(f'    • {TARGET_SKU} is a regular SKU')

    # ── 3. Fetch bundle components ──────────────────────────────────────────────
    print('\n[Step 3] Fetching bundle components...')
    resp = db.table('inventory_bundle_components').select(
        'bundle_sku, component_sku, quantity'
    ).execute()

    bundle_map: Dict[str, List[dict]] = defaultdict(list)
    for r in (resp.data or []):
        bundle_map[r['bundle_sku']].append({
            'component_sku': r['component_sku'],
            'qty_per_bundle': float(r['quantity']),
        })

    print(f'  ✓ {sum(len(v) for v in bundle_map.values())} components across {len(bundle_map)} bundles')
    if TARGET_SKU in bundle_map:
        parts = ', '.join(f"{c['component_sku']}x{c['qty_per_bundle']:.0f}" for c in bundle_map[TARGET_SKU])
        print(f'    • {TARGET_SKU} -> {parts}')

    # ── 4. Fetch receipt layers (FIFO) ──────────────────────────────────────────
    print('\n[Step 4] Fetching receipt layers (FIFO)...')
    resp = db.table('inventory_receipt_layers').select(
        'id, sku_internal, qty_remaining, unit_cost, created_at'
    ).gt('qty_remaining', 0).order('created_at').execute()

    layers_by_sku: Dict[str, List[Layer]] = defaultdict(list)
    for r in (resp.data or []):
        layers_by_sku[r['sku_internal']].append(Layer(r))

    print(f'  ✓ {sum(len(v) for v in layers_by_sku.values())} layers with remaining stock')
    if TARGET_SKU in layers_by_sku:
        total = sum(l.qty_remaining for l in layers_by_sku[TARGET_SKU])
        num_layers = len(layers_by_sku[TARGET_SKU])
        print(f'    • {TARGET_SKU}: {fmt(total)} units ({num_layers} layers)')

    # ── 5. Allocate FIFO until target reached ──────────────────────────────────
    print(f'\n[Step 5] Allocating orders FIFO until {fmt(TARGET_ALLOCATION_QTY)} units allocated...\n')

    allocations:       List[dict]       = []
    allocated_by_sku:  Dict[str, float] = defaultdict(float)
    total_allocated    = 0.0
    issues:            List[str]        = []
    orders_used        = []

    sku_layers = layers_by_sku.get(TARGET_SKU, [])
    if not sku_layers:
        msg = f'No receipt layers for SKU {TARGET_SKU}'
        print(f'  ERROR: {msg}')
        issues.append(msg)
    else:
        # Process unallocated orders in FIFO order
        for order in unallocated_orders:
            if total_allocated >= TARGET_ALLOCATION_QTY:
                print(f'\n  Target allocation reached ({fmt(total_allocated)} >= {fmt(TARGET_ALLOCATION_QTY)})')
                break

            qty = float(order.quantity)
            qty_left = qty
            order_allocations = 0

            for layer in sku_layers:
                if qty_left <= 0:
                    break
                take = min(qty_left, layer.qty_remaining)
                if take <= 0:
                    continue

                alloc_id = det_uuid(f'{order.order_id}:{order.id}:{layer.id}:{TARGET_SKU}')
                allocations.append({
                    'id':            alloc_id,
                    'order_id':      order.id,
                    'sku_internal':  TARGET_SKU,
                    'qty':           int(take),
                    'unit_cost_used': layer.unit_cost,
                    'layer_id':      layer.id,
                    'shipped_at':    datetime.utcnow().isoformat() + 'Z',
                    'method':        'FIFO',
                    'amount':        layer.unit_cost * take,
                    'is_reversal':   False,
                    'created_by':    CREATED_BY,
                })

                allocated_by_sku[TARGET_SKU] += take
                layer.qty_remaining   -= take
                qty_left              -= take
                order_allocations     += take
                total_allocated       += take

            if order_allocations > 0:
                orders_used.append((order.order_id, order_allocations))
                pct = (total_allocated / TARGET_ALLOCATION_QTY) * 100
                print(f'  Order {order.order_id}: {fmt(order_allocations)} units (total: {fmt(total_allocated)}, {pct:.1f}%)')

            if qty_left > 0:
                msg = f'Order {order.order_id}: insufficient stock, short {fmt(qty_left)}'
                print(f'    WARNING: {msg}')
                issues.append(msg)

    print(f'\n  ✓ {len(allocations)} allocation records prepared')
    print(f'  ✓ {len(orders_used)} orders used')
    print(f'  Total qty allocated: {fmt(total_allocated)} units')

    # ── 6. Insert to DB ────────────────────────────────────────────────────────
    print('\n[Step 6] Inserting allocation records into DB...')
    if DRY_RUN:
        print('  [DRY RUN] Skipping DB writes')
    elif allocations:
        batch_size = 500
        for i in range(0, len(allocations), batch_size):
            batch = allocations[i:i + batch_size]
            db.table('inventory_cogs_allocations').upsert(batch).execute()
            batch_num = i // batch_size + 1
            print(f'  ✓ Batch {batch_num}: {len(batch)} records upserted')
    else:
        print('  Nothing to insert')

    # ── 7. Summary report ──────────────────────────────────────────────────────
    remaining_by_sku: Dict[str, float] = defaultdict(float)
    for layers in layers_by_sku.values():
        for l in layers:
            remaining_by_sku[l.sku_internal] += l.qty_remaining

    print()
    print('=' * 80)
    print('  ALLOCATION SUMMARY REPORT')
    print('=' * 80)

    print(f'\nOVERVIEW:')
    print(f'  Total {TARGET_SKU} orders: {len(all_orders)}')
    print(f'  Orders allocated: {len(orders_used)}')
    print(f'  Allocation records created: {len(allocations)}')
    print(f'  Total units allocated: {fmt(total_allocated)}')
    print(f'  Target allocation: {fmt(TARGET_ALLOCATION_QTY)}')

    print(f'\nORDERS USED (first 20):')
    for i, (order_id, qty) in enumerate(orders_used[:20], 1):
        print(f'  {i:3d}. Order {order_id}: {fmt(qty)} units')
    if len(orders_used) > 20:
        print(f'  ... and {len(orders_used) - 20} more')

    print(f'\nINVENTORY STATUS:')
    rem = remaining_by_sku.get(TARGET_SKU, 0)
    alloc = allocated_by_sku.get(TARGET_SKU, 0)
    product_name = name_map.get(TARGET_SKU, TARGET_NAME)
    print(f'  {TARGET_SKU} ({product_name})')
    print(f'    Allocated: {fmt(alloc)}')
    print(f'    Remaining: {fmt(rem)}')

    print(f'\nEXPECTED VS ACTUAL:')
    actual_remaining = remaining_by_sku.get(TARGET_SKU, 0)
    match = int(actual_remaining) == EXPECTED_REMAINING
    icon = '✓' if match else '✗'
    print(f'  {icon} {TARGET_NAME} ({TARGET_SKU})')
    print(f'      Expected remaining: {EXPECTED_REMAINING}')
    print(f'      Actual remaining: {fmt(actual_remaining)}')
    if not match:
        diff = int(actual_remaining) - EXPECTED_REMAINING
        direction = 'over' if diff > 0 else 'under'
        print(f'      Difference: {diff:+d} ({direction} by {abs(diff)})')

    if issues:
        print(f'\nISSUES ({len(issues)}):')
        for i, msg in enumerate(issues, 1):
            print(f'  {i}. {msg}')

    print()
    print('=' * 80)
    if DRY_RUN:
        print('  [DRY RUN] ALLOCATION COMPLETE (no DB writes)')
    else:
        print('  ALLOCATION COMPLETE')
    print('=' * 80)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'\nFATAL ERROR: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
