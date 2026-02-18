-- ============================================
-- Verification Script: Inventory Reservation Logic
-- Description: Test that reserved calculation follows business rules
-- Date: 2026-02-18
-- ============================================

-- BUSINESS RULES:
-- 1. Physical stock deduction ONLY when shipped_at IS NOT NULL
-- 2. Reserved = orders with shipped_at IS NULL AND status_group != 'ยกเลิกแล้ว'
-- 3. Available = On Hand - Reserved
-- 4. Bundles must be exploded into components

-- ============================================
-- TEST 1: Check unshipped orders (should be reserved)
-- ============================================
SELECT
    'TEST 1: Unshipped Orders (Should be Reserved)' AS test_name,
    COUNT(*) AS count,
    SUM(quantity) AS total_qty
FROM sales_orders
WHERE shipped_at IS NULL
  AND status_group != 'ยกเลิกแล้ว';

-- Sample unshipped orders
SELECT
    order_id,
    seller_sku,
    quantity,
    status_group,
    shipped_at,
    'SHOULD BE RESERVED' AS expected_status
FROM sales_orders
WHERE shipped_at IS NULL
  AND status_group != 'ยกเลิกแล้ว'
LIMIT 5;

-- ============================================
-- TEST 2: Check shipped orders (should NOT be reserved)
-- ============================================
SELECT
    'TEST 2: Shipped Orders (Should NOT be Reserved)' AS test_name,
    COUNT(*) AS count,
    SUM(quantity) AS total_qty
FROM sales_orders
WHERE shipped_at IS NOT NULL
  AND status_group != 'ยกเลิกแล้ว';

-- Sample shipped orders
SELECT
    order_id,
    seller_sku,
    quantity,
    status_group,
    shipped_at,
    'SHOULD NOT BE RESERVED' AS expected_status
FROM sales_orders
WHERE shipped_at IS NOT NULL
  AND status_group != 'ยกเลิกแล้ว'
LIMIT 5;

-- ============================================
-- TEST 3: Check cancelled orders (should NOT be reserved)
-- ============================================
SELECT
    'TEST 3: Cancelled Orders (Should NOT be Reserved)' AS test_name,
    COUNT(*) AS count,
    SUM(quantity) AS total_qty
FROM sales_orders
WHERE status_group = 'ยกเลิกแล้ว';

-- Sample cancelled orders
SELECT
    order_id,
    seller_sku,
    quantity,
    status_group,
    shipped_at,
    'SHOULD NOT BE RESERVED (CANCELLED)' AS expected_status
FROM sales_orders
WHERE status_group = 'ยกเลิกแล้ว'
LIMIT 5;

-- ============================================
-- TEST 4: Reserved calculation by SKU
-- ============================================
SELECT
    'TEST 4: Reserved Quantities by SKU' AS test_name;

SELECT
    seller_sku,
    COUNT(*) AS order_count,
    SUM(quantity) AS reserved_qty,
    ARRAY_AGG(DISTINCT status_group) AS statuses,
    ARRAY_AGG(DISTINCT
        CASE
            WHEN shipped_at IS NULL THEN 'unshipped'
            ELSE 'shipped'
        END
    ) AS shipping_status
FROM sales_orders
WHERE shipped_at IS NULL
  AND status_group != 'ยกเลิกแล้ว'
GROUP BY seller_sku
ORDER BY reserved_qty DESC
LIMIT 10;

-- ============================================
-- TEST 5: Check bundle SKUs (need explosion)
-- ============================================
SELECT
    'TEST 5: Bundle Orders (Need Component Explosion)' AS test_name;

-- Find orders with bundle SKUs
SELECT
    so.order_id,
    so.seller_sku AS bundle_sku,
    so.quantity AS bundle_qty,
    so.shipped_at,
    ii.is_bundle,
    ARRAY_AGG(
        bc.component_sku || ' x' || (bc.quantity * so.quantity)::TEXT
    ) AS components_reserved
FROM sales_orders so
JOIN inventory_items ii ON ii.sku_internal = so.seller_sku
LEFT JOIN inventory_bundle_components bc ON bc.bundle_sku = so.seller_sku
WHERE so.shipped_at IS NULL
  AND so.status_group != 'ยกเลิกแล้ว'
  AND ii.is_bundle = true
GROUP BY so.order_id, so.seller_sku, so.quantity, so.shipped_at, ii.is_bundle
LIMIT 5;

-- ============================================
-- TEST 6: Physical stock vs Reserved comparison
-- ============================================
SELECT
    'TEST 6: Physical Stock vs Reserved' AS test_name;

WITH on_hand AS (
    SELECT
        sku_internal,
        SUM(qty_remaining) AS on_hand_qty
    FROM inventory_receipt_layers
    WHERE is_voided = false
    GROUP BY sku_internal
),
reserved AS (
    SELECT
        seller_sku AS sku_internal,
        SUM(quantity) AS reserved_qty
    FROM sales_orders
    WHERE shipped_at IS NULL
      AND status_group != 'ยกเลิกแล้ว'
    GROUP BY seller_sku
)
SELECT
    COALESCE(oh.sku_internal, r.sku_internal) AS sku,
    COALESCE(oh.on_hand_qty, 0) AS on_hand,
    COALESCE(r.reserved_qty, 0) AS reserved,
    COALESCE(oh.on_hand_qty, 0) - COALESCE(r.reserved_qty, 0) AS available,
    CASE
        WHEN COALESCE(oh.on_hand_qty, 0) - COALESCE(r.reserved_qty, 0) < 0 THEN 'NEGATIVE (OVERSOLD)'
        WHEN COALESCE(oh.on_hand_qty, 0) - COALESCE(r.reserved_qty, 0) = 0 THEN 'ZERO'
        ELSE 'OK'
    END AS status
FROM on_hand oh
FULL OUTER JOIN reserved r ON oh.sku_internal = r.sku_internal
WHERE COALESCE(oh.on_hand_qty, 0) > 0 OR COALESCE(r.reserved_qty, 0) > 0
ORDER BY (COALESCE(oh.on_hand_qty, 0) - COALESCE(r.reserved_qty, 0)) ASC
LIMIT 20;

-- ============================================
-- TEST 7: Verify COGS allocations only for shipped orders
-- ============================================
SELECT
    'TEST 7: COGS Allocations (Should Only Have Shipped Orders)' AS test_name;

-- Check if any COGS allocations exist for unshipped orders (BUG if > 0)
SELECT
    ca.order_id,
    ca.sku_internal,
    ca.qty AS allocated_qty,
    so.shipped_at,
    so.status_group,
    'BUG: COGS allocated but not shipped!' AS issue
FROM inventory_cogs_allocations ca
JOIN sales_orders so ON so.order_id = ca.order_id
WHERE so.shipped_at IS NULL
  AND ca.is_reversal = false
LIMIT 5;

-- If above returns 0 rows, then COGS logic is correct
