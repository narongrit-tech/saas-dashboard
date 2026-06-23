#!/usr/bin/env python3
"""
Fix status_group mapping for TikTok and Shopee orders

Purpose:
  Map platform_status (raw platform values) → status_group (Thai business categories)
  for all sales_orders where status_group is NULL.

Status Mappings:
  TikTok platform_status values:
    - "จัดส่งแล้ว" (Shipped) → "อยู่ระหว่างการจัดส่ง" (In Transit)
    - "เสร็จสมบูรณ์" (Completed) → "จัดส่งแล้ว" (Delivered)
    - "ยกเลิกแล้ว" (Cancelled) → "ยกเลิกแล้ว" (Cancelled)
  
  Shopee platform_status values:
    - "การจัดส่ง" (Shipping) → "อยู่ระหว่างการจัดส่ง" (In Transit)
    - "จัดส่งสำเร็จแล้ว" (Shipped) → "อยู่ระหว่างการจัดส่ง" (In Transit)
    - "ผู้ซื้อได้รับสินค้าแล้ว..." (Delivered) → "จัดส่งแล้ว" (Delivered)
    - "สำเร็จแล้ว" (Completed) → "จัดส่งแล้ว" (Delivered)
    - "ยกเลิกแล้ว" (Cancelled) → "ยกเลิกแล้ว" (Cancelled)

Usage:
  python fix-status-group-mapping.py            # live run
  python fix-status-group-mapping.py --dry-run  # preview without DB writes
"""

import os
import sys
from datetime import datetime
from dotenv import load_dotenv

# Load environment
env_paths = [
    os.path.join(os.path.dirname(__file__), '../.env.local'),
    os.path.join(os.path.dirname(__file__), '../../.env'),
    os.path.join(os.path.dirname(__file__), '../../../.env'),
    os.path.join(os.getcwd(), '.env.local'),
    os.path.join(os.getcwd(), '.env'),
]
for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        break

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

DRY_RUN = '--dry-run' in sys.argv

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase credentials in .env")
    sys.exit(1)

db = create_client(SUPABASE_URL, SUPABASE_KEY)

# ──────────────────────────────────────────────────────────────────────────────
# Status Mappings (platform_status → status_group)
# ──────────────────────────────────────────────────────────────────────────────

TIKTOK_STATUS_MAPPING = {
    'จัดส่งแล้ว': 'อยู่ระหว่างการจัดส่ง',      # Shipped → In Transit
    'ที่จะจัดส่ง': 'อยู่ระหว่างการจัดส่ง',    # To be shipped → In Transit
    'เสร็จสมบูรณ์': 'จัดส่งแล้ว',              # Completed → Delivered
    'ยกเลิกแล้ว': 'ยกเลิกแล้ว',              # Cancelled → Cancelled
}

SHOPEE_STATUS_MAPPING = {
    'การจัดส่ง': 'อยู่ระหว่างการจัดส่ง',       # Shipping → In Transit
    'จัดส่งสำเร็จแล้ว': 'อยู่ระหว่างการจัดส่ง', # Shipped → In Transit
    'สำเร็จแล้ว': 'จัดส่งแล้ว',               # Completed → Delivered
    'ยกเลิกแล้ว': 'ยกเลิกแล้ว',              # Cancelled → Cancelled
}

# Handle Shopee "Delivered" statuses (all start with "ผู้ซื้อได้รับสินค้าแล้ว")
SHOPEE_DELIVERED_PREFIX = 'ผู้ซื้อได้รับสินค้าแล้ว'

def map_status(marketplace: str, platform_status: str) -> str:
    """Map platform_status to status_group"""
    if not platform_status:
        return None
    
    if marketplace == 'tiktok':
        return TIKTOK_STATUS_MAPPING.get(platform_status)
    elif marketplace == 'shopee':
        # Check if it's a delivered status (starts with prefix)
        if platform_status.startswith(SHOPEE_DELIVERED_PREFIX):
            return 'จัดส่งแล้ว'
        return SHOPEE_STATUS_MAPPING.get(platform_status)
    
    return None

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def fmt(n) -> str:
    """Format number with thousand separators"""
    return f'{int(n):,}'

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print('=' * 80)
    if DRY_RUN:
        print('  FIX STATUS_GROUP MAPPING FOR NULL ENTRIES  [DRY RUN - no DB writes]')
    else:
        print('  FIX STATUS_GROUP MAPPING FOR NULL ENTRIES')
    print('=' * 80)

    # ── 1. Fetch orders with NULL status_group only ──────────────────────────────
    print('\n[Step 1] Fetching orders with NULL status_group...')
    
    # Fetch in chunks to avoid large result sets
    all_orders = []
    offset = 0
    batch_size = 1000
    
    while True:
        resp = db.table('sales_orders').select(
            'id, marketplace, platform_status, status_group, created_at'
        ).is_('status_group', 'null').range(offset, offset + batch_size - 1).execute()
        
        if not resp.data:
            break
        
        all_orders.extend(resp.data)
        offset += batch_size
    
    print(f'  ✓ Total orders with NULL status_group: {fmt(len(all_orders))}')
    
    # Count by marketplace
    by_marketplace = {}
    for order in all_orders:
        mp = order.get('marketplace', 'unknown')
        if mp not in by_marketplace:
            by_marketplace[mp] = 0
        by_marketplace[mp] += 1
    
    for mp in sorted(by_marketplace.keys()):
        print(f'    • {mp}: {fmt(by_marketplace[mp])} orders')
    
    # ── 2. Build update list ────────────────────────────────────────────────────
    print('\n[Step 2] Building update list...')
    
    updates = []
    unmapped_count = 0
    unmapped_samples = {}
    
    for order in all_orders:
        order_id = order.get('id')
        marketplace = order.get('marketplace', '').lower()
        platform_status = order.get('platform_status')
        
        # Map the status
        mapped_status_group = map_status(marketplace, platform_status)
        
        if mapped_status_group:
            updates.append({
                'id': order_id,
                'status_group': mapped_status_group,
            })
        else:
            # Can't map - record the unmapped value
            unmapped_count += 1
            key = f'{marketplace}:{platform_status}'
            if key not in unmapped_samples:
                unmapped_samples[key] = 0
            unmapped_samples[key] += 1
    
    print(f'  ✓ {len(updates)} orders can be mapped')
    if unmapped_count > 0:
        print(f'  ✓ {unmapped_count} orders with unmapped platform_status:')
        for key, count in sorted(unmapped_samples.items()):
            print(f'      • {key} (count: {count})')
    
    # ── 3. Show updates by marketplace ──────────────────────────────────────────
    print('\n[Step 3] Preview of updates by marketplace...')
    
    update_by_marketplace = {}
    for i, update in enumerate(updates):
        order = all_orders[i]
        marketplace = order.get('marketplace', 'unknown')
        if marketplace not in update_by_marketplace:
            update_by_marketplace[marketplace] = {}
        
        ps = order.get('platform_status')
        sg = update['status_group']
        key = (ps, sg)
        if key not in update_by_marketplace[marketplace]:
            update_by_marketplace[marketplace][key] = 0
        update_by_marketplace[marketplace][key] += 1
    
    for marketplace in sorted(update_by_marketplace.keys()):
        print(f'\n  {marketplace.upper()}:')
        mapping_preview = update_by_marketplace[marketplace]
        for (ps, sg), count in sorted(mapping_preview.items()):
            print(f'    • "{ps}" → "{sg}" (count: {count})')
    
    # ── 4. Insert to DB ────────────────────────────────────────────────────────
    print('\n[Step 4] Updating database...')
    
    if DRY_RUN:
        print('  [DRY RUN] Skipping DB writes')
    elif updates:
        print(f'  Writing {len(updates)} updates in batches of 50...')
        batch_size = 50
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i + batch_size]
            for update in batch:
                db.table('sales_orders').update({
                    'status_group': update['status_group'],
                }).eq('id', update['id']).execute()
            batch_num = i // batch_size + 1
            total_batches = (len(updates) + batch_size - 1) // batch_size
            completed = min(i + batch_size, len(updates))
            pct = (completed / len(updates)) * 100
            print(f'  ✓ Batch {batch_num}/{total_batches}: {completed}/{len(updates)} records ({pct:.1f}%)')
    else:
        print('  ✓ Nothing to update')
    
    # ── 5. Get final counts ────────────────────────────────────────────────────
    print('\n[Step 5] Verifying final counts...')
    
    # Get updated counts
    final_null_count = 0
    offset = 0
    while True:
        resp = db.table('sales_orders').select('id').is_('status_group', 'null').range(offset, offset + 999).execute()
        if not resp.data:
            break
        final_null_count += len(resp.data)
        offset += 1000
    
    final_set_count = 0
    offset = 0
    while True:
        resp = db.table('sales_orders').select('id').not_.is_('status_group', 'null').range(offset, offset + 999).execute()
        if not resp.data:
            break
        final_set_count += len(resp.data)
        offset += 1000
    
    # ── 6. Print summary report ──────────────────────────────────────────────────
    print()
    print('=' * 80)
    print('  STATUS_GROUP MAPPING SUMMARY REPORT')
    print('=' * 80)
    
    print(f'\n[SUMMARY]')
    print(f'  Orders processed: {fmt(len(all_orders))}')
    print(f'  Orders updated: {fmt(len(updates))}')
    print(f'  Orders unmapped: {fmt(unmapped_count)}')
    
    print(f'\n[BEFORE]')
    print(f'  Orders with status_group NULL: {fmt(len(all_orders) + unmapped_count)}')
    
    print(f'\n[AFTER]')
    print(f'  Orders with status_group NULL: {fmt(final_null_count)}')
    print(f'  Orders with status_group SET: {fmt(final_set_count)}')
    
    improvement = len(updates)
    print(f'\n[IMPACT]')
    print(f'  ✓ Fixed {fmt(improvement)} orders')
    if improvement > 0:
        pct = (improvement / len(all_orders)) * 100 if all_orders else 0
        print(f'  ✓ Coverage: {pct:.1f}% of NULL entries')
    
    print()
    print('=' * 80)
    if DRY_RUN:
        print('  [DRY RUN] COMPLETE (no DB writes)')
    else:
        print('  STATUS_GROUP MAPPING COMPLETE')
        print('  Ready to run: python frontend/scripts/allocate-remaining-orders.py')
    print('=' * 80)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'\nFATAL ERROR: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
