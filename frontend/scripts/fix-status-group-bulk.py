#!/usr/bin/env python3
"""
Bulk update status_group for TikTok orders using PostgreSQL CASE statement.
Much faster than individual updates.
"""

import os
import sys
from pathlib import Path

# Add parent to path for env loading
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent / ".env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY must be set in .env.local")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

TIKTOK_STATUS_MAPPING = {
    'จัดส่งแล้ว': 'อยู่ระหว่างการจัดส่ง',       # Shipped → In Transit
    'ที่จะจัดส่ง': 'อยู่ระหว่างการจัดส่ง',     # To be shipped → In Transit
    'เสร็จสมบูรณ์': 'จัดส่งแล้ว',               # Completed → Delivered
    'ยกเลิกแล้ว': 'ยกเลิกแล้ว',               # Cancelled → Cancelled
}

async def main():
    print("\n" + "="*80)
    print("  BULK UPDATE status_group FOR TIKTOK ORDERS")
    print("="*80)
    
    # Count NULL entries before
    print("\n▶ Checking current state...")
    try:
        result = await supabase.table('sales_orders').select(
            'id', 
            count='exact'
        ).is_('status_group', None).execute()
        
        null_count = result[1] if isinstance(result, tuple) else getattr(result, 'count', 0)
        print(f"  Orders with NULL status_group: {null_count}")
        
    except Exception as e:
        print(f"  Error counting: {e}")
        null_count = None
    
    # Build SQL for bulk update using RPC
    print("\n▶ Building SQL update statement...")
    
    # Use RPC to execute raw SQL (safer than direct exec)
    sql = """
    UPDATE sales_orders
    SET status_group = CASE 
        WHEN platform_status = 'จัดส่งแล้ว' THEN 'อยู่ระหว่างการจัดส่ง'
        WHEN platform_status = 'ที่จะจัดส่ง' THEN 'อยู่ระหว่างการจัดส่ง'
        WHEN platform_status = 'เสร็จสมบูรณ์' THEN 'จัดส่งแล้ว'
        WHEN platform_status = 'ยกเลิกแล้ว' THEN 'ยกเลิกแล้ว'
        ELSE status_group
    END,
    updated_at = NOW()
    WHERE status_group IS NULL
      AND platform_status IS NOT NULL
      AND marketplace = 'tiktok'
    RETURNING COUNT(*) as updated_count;
    """
    
    try:
        print("  Executing bulk update...")
        # Call via RPC if available, or direct execute
        result = supabase.rpc('exec_sql', {'sql': sql}).execute()
        print(f"  ✓ Update executed")
        
    except Exception as e:
        print(f"  ✗ RPC exec_sql failed: {e}")
        print("  Falling back to individual batch updates...")
        
        # Fallback: fetch all NULL entries and update in batches
        try:
            response = supabase.table('sales_orders').select('id, platform_status').is_('status_group', None).execute()
            orders = response.data if hasattr(response, 'data') else response
            
            print(f"  Found {len(orders)} orders to update")
            
            updated = 0
            for i, order in enumerate(orders):
                status = order.get('platform_status')
                if status in TIKTOK_STATUS_MAPPING:
                    new_status = TIKTOK_STATUS_MAPPING[status]
                    try:
                        supabase.table('sales_orders').update({
                            'status_group': new_status,
                            'updated_at': 'now()'
                        }).eq('id', order['id']).execute()
                        updated += 1
                    except Exception as ue:
                        print(f"    Failed to update {order['id']}: {ue}")
                
                if (i + 1) % 50 == 0:
                    print(f"    Progress: {i+1}/{len(orders)}")
            
            print(f"  ✓ Updated {updated} orders via fallback")
        
        except Exception as fallback_err:
            print(f"  ✗ Fallback also failed: {fallback_err}")
            sys.exit(1)
    
    # Count NULL entries after
    print("\n▶ Verifying update...")
    try:
        result = supabase.table('sales_orders').select(
            'id',
            count='exact'
        ).is_('status_group', None).execute()
        
        new_null_count = result[1] if isinstance(result, tuple) else getattr(result, 'count', 0)
        print(f"  Orders with NULL status_group after: {new_null_count}")
        
        if null_count is not None:
            fixed = null_count - new_null_count
            print(f"  ✓ Fixed: {fixed} orders")
    
    except Exception as e:
        print(f"  Error verifying: {e}")
    
    # Sample check
    print("\n▶ Sample orders with status_group now set:")
    try:
        response = supabase.table('sales_orders').select(
            'order_id, platform_status, status_group'
        ).neq('status_group', None).limit(5).execute()
        
        samples = response.data if hasattr(response, 'data') else response
        for order in samples:
            print(f"  {order['order_id']}: {order['platform_status']} → {order['status_group']}")
    
    except Exception as e:
        print(f"  Error sampling: {e}")
    
    print("\n" + "="*80)
    print("  ✅ STATUS_GROUP FIX COMPLETE")
    print("="*80)
    print("\nNext step: Run allocation script\n")

if __name__ == '__main__':
    # For sync execution without asyncio
    main()
