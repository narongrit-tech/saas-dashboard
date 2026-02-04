-- ============================================
-- Fix SKU Canonicalization: NEWOWNN -> NEWONN
-- Purpose: Correct typo in SKU naming
-- Date: 2026-02-01
-- ============================================

-- This script corrects SKU typos:
-- NEWOWNN001 -> NEWONN001
-- NEWOWNN002 -> NEWONN002

-- IMPORTANT: Run this AFTER verifying:
-- 1. No orders/allocations are in-flight
-- 2. Backup database first
-- 3. Test in non-production environment first

-- ============================================
-- 1) CHECK CURRENT STATE
-- ============================================

-- See which SKUs exist with NEWOWNN prefix
SELECT
  'inventory_items' as table_name,
  sku_internal,
  product_name,
  is_bundle
FROM inventory_items
WHERE sku_internal LIKE 'NEWOWNN%'

UNION ALL

SELECT
  'inventory_receipt_layers',
  sku_internal,
  NULL,
  NULL
FROM inventory_receipt_layers
WHERE sku_internal LIKE 'NEWOWNN%'
GROUP BY sku_internal

UNION ALL

SELECT
  'sales_orders',
  seller_sku,
  NULL,
  NULL
FROM sales_orders
WHERE seller_sku LIKE 'NEWOWNN%'
GROUP BY seller_sku;

-- ============================================
-- 2) UPDATE inventory_items (Master Table)
-- ============================================

-- Update SKUs in master table
UPDATE inventory_items
SET sku_internal = REPLACE(sku_internal, 'NEWOWNN', 'NEWONN')
WHERE sku_internal LIKE 'NEWOWNN%';

-- Verify
SELECT sku_internal, product_name FROM inventory_items WHERE sku_internal LIKE 'NEWONN%';

-- ============================================
-- 3) UPDATE inventory_receipt_layers
-- ============================================

-- Update SKUs in receipt layers
-- (This should cascade from foreign key, but update explicitly to be safe)
UPDATE inventory_receipt_layers
SET sku_internal = REPLACE(sku_internal, 'NEWOWNN', 'NEWONN')
WHERE sku_internal LIKE 'NEWOWNN%';

-- Verify
SELECT sku_internal, COUNT(*) as layer_count, SUM(qty_remaining) as total_on_hand
FROM inventory_receipt_layers
WHERE sku_internal LIKE 'NEWONN%'
  AND is_voided = false
GROUP BY sku_internal;

-- ============================================
-- 4) UPDATE sales_orders (seller_sku)
-- ============================================

-- Update SKUs in sales orders
UPDATE sales_orders
SET seller_sku = REPLACE(seller_sku, 'NEWOWNN', 'NEWONN')
WHERE seller_sku LIKE 'NEWOWNN%';

-- Verify
SELECT seller_sku, COUNT(*) as order_count
FROM sales_orders
WHERE seller_sku LIKE 'NEWONN%'
GROUP BY seller_sku;

-- ============================================
-- 5) UPDATE inventory_cogs_allocations (if any)
-- ============================================

-- Update SKUs in COGS allocations
UPDATE inventory_cogs_allocations
SET sku_internal = REPLACE(sku_internal, 'NEWOWNN', 'NEWONN')
WHERE sku_internal LIKE 'NEWOWNN%';

-- Verify
SELECT sku_internal, COUNT(*) as allocation_count
FROM inventory_cogs_allocations
WHERE sku_internal LIKE 'NEWONN%'
GROUP BY sku_internal;

-- ============================================
-- 6) UPDATE bundle_recipes (if bundles use these SKUs)
-- ============================================

UPDATE bundle_recipes
SET component_sku = REPLACE(component_sku, 'NEWOWNN', 'NEWONN')
WHERE component_sku LIKE 'NEWOWNN%';

-- Verify
SELECT bundle_sku, component_sku, quantity
FROM bundle_recipes
WHERE component_sku LIKE 'NEWONN%';

-- ============================================
-- 7) FINAL VERIFICATION
-- ============================================

-- Should return 0 rows (no more NEWOWNN SKUs)
SELECT 'REMAINING NEWOWNN SKUs (should be 0)' as check_name, COUNT(*) as count
FROM (
  SELECT sku_internal FROM inventory_items WHERE sku_internal LIKE 'NEWOWNN%'
  UNION ALL
  SELECT sku_internal FROM inventory_receipt_layers WHERE sku_internal LIKE 'NEWOWNN%'
  UNION ALL
  SELECT seller_sku FROM sales_orders WHERE seller_sku LIKE 'NEWOWNN%'
  UNION ALL
  SELECT sku_internal FROM inventory_cogs_allocations WHERE sku_internal LIKE 'NEWOWNN%'
  UNION ALL
  SELECT component_sku FROM bundle_recipes WHERE component_sku LIKE 'NEWOWNN%'
) remaining;

-- Should show correct SKUs
SELECT 'CORRECTED NEWONN SKUs' as check_name, sku_internal, product_name
FROM inventory_items
WHERE sku_internal IN ('NEWONN001', 'NEWONN002')
ORDER BY sku_internal;

-- ============================================
-- ROLLBACK (if needed)
-- ============================================

-- If you need to rollback, run these commands:
-- (Only if you need to undo the changes)

/*
UPDATE inventory_items SET sku_internal = REPLACE(sku_internal, 'NEWONN', 'NEWOWNN') WHERE sku_internal LIKE 'NEWONN%';
UPDATE inventory_receipt_layers SET sku_internal = REPLACE(sku_internal, 'NEWONN', 'NEWOWNN') WHERE sku_internal LIKE 'NEWONN%';
UPDATE sales_orders SET seller_sku = REPLACE(seller_sku, 'NEWONN', 'NEWOWNN') WHERE seller_sku LIKE 'NEWONN%';
UPDATE inventory_cogs_allocations SET sku_internal = REPLACE(sku_internal, 'NEWONN', 'NEWOWNN') WHERE sku_internal LIKE 'NEWONN%';
UPDATE bundle_recipes SET component_sku = REPLACE(component_sku, 'NEWONN', 'NEWOWNN') WHERE component_sku LIKE 'NEWONN%';
*/

-- ============================================
-- END OF SKU CANONICALIZATION FIX
-- ============================================
