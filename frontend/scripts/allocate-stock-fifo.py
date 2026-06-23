#!/usr/bin/env python3
"""
Stock Allocation Script - FIFO Method

Steps:
1. Fetch unshipped orders (shipped_at IS NULL AND status_group != 'ยกเลิกแล้ว')
2. Fetch inventory_items to get is_bundle flag (authoritative)
3. Fetch bundle components from inventory_bundle_components
4. Fetch receipt layers sorted FIFO (oldest created_at first)
5. Explode bundle SKUs → component SKUs, allocate FIFO per component
6. Insert/upsert inventory_cogs_allocations
7. Show summary vs expected: Fresh Up=789, Wind Down=441

Usage:
  python allocate-stock-fifo.py            # live run
  python allocate-stock-fifo.py --dry-run  # preview without DB writes
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

EXPECTED = {
    'NEWONN001': {'name': 'Fresh Up',   'remaining': 789},
    'NEWONN002': {'name': 'Wind Down',  'remaining': 441},
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
    h = list(hashlib.sha256(seed.encode()).digest()[:16])
    h[6] = (h[6] & 0x0f) | 0x50
    h[8] = (h[8] & 0x3f) | 0x80
    return str(uuid.UUID(bytes=bytes(h)))

def fmt(n) -> str:
    return f'{int(n):,}'

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print('═' * 72)
    print(f'  STOCK ALLOCATION (FIFO){"  [DRY RUN - no DB writes]" if DRY_RUN else ""}')
    print('═' * 72)

    # ── 1. Unshipped orders ──────────────────────────────────────────────────
    print('\n▶ Step 1: Fetching unshipped orders...')
    resp = db.table('sales_orders').select(
        'id, order_id, sku, seller_sku, quantity, created_at'
    ).is_('shipped_at', 'null').neq('status_group', 'ยกเลิกแล้ว').order('created_at').execute()

    orders = [Order(r) for r in (resp.data or [])]
    print(f'  ✓ {len(orders)} unshipped line items')

    if not orders:
        print('  No unshipped orders. Exiting.')
        return

    # ── 2. inventory_items → is_bundle (authoritative) ───────────────────────
    print('\n▶ Step 2: Fetching inventory_items (is_bundle flag)...')
    resp = db.table('inventory_items').select(
        'sku_internal, product_name, is_bundle'
    ).execute()

    item_rows    = resp.data or []
    bundle_skus: Set[str] = {r['sku_internal'] for r in item_rows if r.get('is_bundle')}
    name_map:    Dict[str, str] = {r['sku_internal']: r.get('product_name', '') for r in item_rows}

    print(f'  ✓ {len(item_rows)} items, {len(bundle_skus)} bundle SKUs')
    for s in sorted(bundle_skus):
        print(f'    • {s}  ({name_map.get(s, "?")})')

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

    print(f'  ✓ {sum(len(v) for v in bundle_map.values())} components across {len(bundle_map)} bundles')
    for bsku in sorted(bundle_map.keys()):
        parts = ', '.join(f"{c['component_sku']}×{c['qty_per_bundle']:.0f}" for c in bundle_map[bsku])
        print(f'    • {bsku} → {parts}')

    # Warn: bundle_skus with no components
    missing_def = bundle_skus - set(bundle_map.keys())
    if missing_def:
        print(f'\n  ⚠️  Bundle SKUs with is_bundle=true but NO components defined:')
        for s in sorted(missing_def):
            print(f'    • {s}')

    # ── 4. Receipt layers (FIFO) ──────────────────────────────────────────────
    print('\n▶ Step 4: Fetching receipt layers (FIFO)...')
    resp = db.table('inventory_receipt_layers').select(
        'id, sku_internal, qty_remaining, unit_cost, created_at'
    ).gt('qty_remaining', 0).order('created_at').execute()

    layers_by_sku: Dict[str, List[Layer]] = defaultdict(list)
    for r in (resp.data or []):
        layers_by_sku[r['sku_internal']].append(Layer(r))

    print(f'  ✓ {sum(len(v) for v in layers_by_sku.values())} layers with stock')
    for sku in sorted(layers_by_sku.keys()):
        total = sum(l.qty_remaining for l in layers_by_sku[sku])
        print(f'    • {sku}: {fmt(total)} units ({len(layers_by_sku[sku])} layers)')

    # ── 5. Allocate FIFO ──────────────────────────────────────────────────────
    print('\n▶ Step 5: Exploding bundles & allocating FIFO...\n')

    allocations:       List[dict]       = []
    allocated_by_sku:  Dict[str, float] = defaultdict(float)
    bundle_units_sold: Dict[str, float] = defaultdict(float)  # bundle SKU → qty of bundles sold
    issues:            List[str]        = []

    for order in orders:
        sku = order.sku
        qty = float(order.quantity)

        # Determine if bundle via is_bundle=true (authoritative)
        is_bundle = sku in bundle_skus
        # Fallback: treat as bundle if it has components even if flag missing
        components = bundle_map.get(sku, [])

        if not is_bundle and components:
            print(f'  ⚠️  {sku} has components but is_bundle=false in inventory_items — treating as bundle')
            is_bundle = True

        if is_bundle:
            if not components:
                msg = f'Bundle {sku} (is_bundle=true) has no components defined'
                print(f'  ✗ {msg}')
                issues.append(msg)
                continue

            bundle_units_sold[sku] += qty
            print(f'  [BUNDLE] {sku}  qty={fmt(qty)}  →  {", ".join(c["component_sku"] for c in components)}')

            for comp in components:
                comp_sku   = comp['component_sku']
                qty_needed = qty * comp['qty_per_bundle']
                qty_left   = qty_needed
                comp_layers = layers_by_sku.get(comp_sku, [])

                if not comp_layers:
                    msg = f'No receipt layers for component {comp_sku} (needed by bundle {sku})'
                    print(f'    ✗ {msg}')
                    issues.append(msg)
                    continue

                for layer in comp_layers:
                    if qty_left <= 0:
                        break
                    take = min(qty_left, layer.qty_remaining)
                    if take <= 0:
                        continue

                    alloc_id = det_uuid(f'{order.order_id}:{order.id}:{layer.id}:{comp_sku}')
                    allocations.append({
                        'id':            alloc_id,
                        'order_id':      order.id,
                        'sku_internal':  comp_sku,
                        'qty':           int(take),
                        'unit_cost_used': layer.unit_cost,
                        'layer_id':      layer.id,
                        'shipped_at':    datetime.utcnow().isoformat() + 'Z',
                        'method':        'FIFO',
                        'amount':        layer.unit_cost * take,
                        'is_reversal':   False,
                        'created_by':    CREATED_BY,
                    })

                    allocated_by_sku[comp_sku] += take
                    layer.qty_remaining        -= take
                    qty_left                   -= take

                    print(f'    → {comp_sku}: allocated {fmt(take)} @ {layer.unit_cost:.2f} from layer {layer.id[:8]}…')

                if qty_left > 0:
                    msg = f'Insufficient stock for {comp_sku}: needed {fmt(qty_needed)}, short by {fmt(qty_left)}'
                    print(f'    ✗ {msg}')
                    issues.append(msg)

        else:
            # Regular SKU
            qty_left   = qty
            sku_layers = layers_by_sku.get(sku, [])

            if not sku_layers:
                msg = f'No receipt layers for SKU {sku}'
                print(f'  ✗ {msg}')
                issues.append(msg)
                continue

            for layer in sku_layers:
                if qty_left <= 0:
                    break
                take = min(qty_left, layer.qty_remaining)
                if take <= 0:
                    continue

                alloc_id = det_uuid(f'{order.order_id}:{order.id}:{layer.id}:{sku}')
                allocations.append({
                    'id':            alloc_id,
                    'order_id':      order.id,
                    'sku_internal':  sku,
                    'qty':           int(take),
                    'unit_cost_used': layer.unit_cost,
                    'layer_id':      layer.id,
                    'shipped_at':    datetime.utcnow().isoformat() + 'Z',
                    'method':        'FIFO',
                    'amount':        layer.unit_cost * take,
                    'is_reversal':   False,
                    'created_by':    CREATED_BY,
                })

                allocated_by_sku[sku] += take
                layer.qty_remaining   -= take
                qty_left              -= take

            if qty_left > 0:
                msg = f'Insufficient stock for {sku}: needed {fmt(qty)}, short by {fmt(qty_left)}'
                print(f'  ✗ {msg}')
                issues.append(msg)

    print(f'\n  ✓ {len(allocations)} allocation records prepared')

    # ── 6. Insert to DB ───────────────────────────────────────────────────────
    print('\n▶ Step 6: Inserting allocation records...')
    if DRY_RUN:
        print('  [DRY RUN] Skipping DB writes')
    elif allocations:
        batch_size = 500
        for i in range(0, len(allocations), batch_size):
            batch = allocations[i:i + batch_size]
            db.table('inventory_cogs_allocations').upsert(batch).execute()
            print(f'  ✓ Batch {i // batch_size + 1}: {len(batch)} records upserted')
    else:
        print('  Nothing to insert')

    # ── 7. Summary report ────────────────────────────────────────────────────
    remaining_by_sku: Dict[str, float] = defaultdict(float)
    for layers in layers_by_sku.values():
        for l in layers:
            remaining_by_sku[l.sku_internal] += l.qty_remaining

    print()
    print('═' * 72)
    print('  ALLOCATION SUMMARY REPORT')
    print('═' * 72)

    print(f'\n📊 OVERVIEW')
    print(f'  Unshipped line items : {len(orders)}')
    print(f'  Allocation records   : {len(allocations)}')
    print(f'  Total qty allocated  : {fmt(sum(allocated_by_sku.values()))}')

    if bundle_units_sold:
        print(f'\n📦 BUNDLE UNITS SOLD')
        for bsku in sorted(bundle_units_sold.keys()):
            print(f'  {bsku} ({name_map.get(bsku, "?")}): {fmt(bundle_units_sold[bsku])} bundles')

    print(f'\n📦 STOCK AFTER ALLOCATION (component SKUs)')
    all_skus = sorted(set(list(remaining_by_sku.keys()) + list(allocated_by_sku.keys())))
    for sku in all_skus:
        rem   = remaining_by_sku.get(sku, 0)
        alloc = allocated_by_sku.get(sku, 0)
        print(f'  {sku} ({name_map.get(sku, "?")})')
        print(f'    Allocated : {fmt(alloc)}')
        print(f'    Remaining : {fmt(rem)}')

    print(f'\n🔍 COMPARISON WITH EXPECTED')
    all_match = True
    for sku, exp in EXPECTED.items():
        actual = remaining_by_sku.get(sku, 0)
        match  = int(actual) == exp['remaining']
        icon   = '✓' if match else '✗'
        all_match = all_match and match
        print(f'  {icon} {exp["name"]} ({sku})')
        print(f'      Expected remaining : {exp["remaining"]}')
        print(f'      Actual remaining   : {fmt(actual)}')
        if not match:
            diff = int(actual) - exp['remaining']
            print(f'      Difference         : {diff:+d}  ({"over" if diff > 0 else "under"} by {abs(diff)})')

    if all_match:
        print('\n  ✓ All values match expected!')
    else:
        print('\n  ✗ Some values do not match — check issues above')

    if issues:
        print(f'\n⚠️  ISSUES ({len(issues)})')
        for i, msg in enumerate(issues, 1):
            print(f'  {i}. {msg}')

    print()
    print('═' * 72)
    print(f'  {"[DRY RUN] " if DRY_RUN else ""}ALLOCATION COMPLETE')
    print('═' * 72)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'\n✗ FATAL ERROR: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
