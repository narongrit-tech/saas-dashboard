-- ============================================
-- Verification Script: Stock In Flow
-- Purpose: Verify Stock In creates both document and receipt layer correctly
-- Date: 2026-02-01
-- ============================================

-- ============================================
-- 1) CHECK SCHEMA CORRECTNESS
-- ============================================

-- Check inventory_stock_in_documents has required columns
SELECT
  'inventory_stock_in_documents schema check' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_stock_in_documents'
        AND column_name = 'item_id'
    ) THEN '✅ item_id exists'
    ELSE '❌ item_id missing'
  END as item_id_check,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_stock_in_documents'
        AND column_name = 'quantity'
    ) THEN '✅ quantity exists'
    ELSE '❌ quantity missing'
  END as quantity_check,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_stock_in_documents'
        AND column_name = 'unit_cost'
    ) THEN '✅ unit_cost exists'
    ELSE '❌ unit_cost missing'
  END as unit_cost_check;

-- Check inventory_receipt_layers has correct columns (and NO item_id!)
SELECT
  'inventory_receipt_layers schema check' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_receipt_layers'
        AND column_name = 'sku_internal'
    ) THEN '✅ sku_internal exists'
    ELSE '❌ sku_internal missing'
  END as sku_internal_check,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_receipt_layers'
        AND column_name = 'item_id'
    ) THEN '✅ NO item_id (correct!)'
    ELSE '❌ item_id exists (WRONG!)'
  END as no_item_id_check;

-- ============================================
-- 2) CHECK EXISTING DATA
-- ============================================

-- Show all inventory items
SELECT
  'Available SKUs' as info,
  sku_internal,
  product_name,
  is_bundle,
  base_cost_per_unit
FROM inventory_items
ORDER BY sku_internal;

-- Show all receipt layers
SELECT
  'Receipt Layers Summary' as info,
  sku_internal,
  ref_type,
  COUNT(*) as layer_count,
  SUM(qty_received) as total_received,
  SUM(qty_remaining) as total_on_hand
FROM inventory_receipt_layers
WHERE COALESCE(is_voided, false) = false
GROUP BY sku_internal, ref_type
ORDER BY sku_internal, ref_type;

-- Show stock in documents (if any)
SELECT
  'Stock In Documents' as info,
  id,
  item_id,
  quantity,
  unit_cost,
  reference,
  received_at,
  created_at
FROM inventory_stock_in_documents
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 3) VERIFY LINKAGE (Documents <-> Layers)
-- ============================================

-- Show documents with their corresponding receipt layers
SELECT
  d.id as doc_id,
  d.reference,
  d.quantity as doc_quantity,
  d.unit_cost as doc_unit_cost,
  i.sku_internal,
  l.id as layer_id,
  l.ref_type,
  l.qty_received as layer_qty_received,
  l.qty_remaining as layer_qty_remaining,
  l.unit_cost as layer_unit_cost,
  CASE
    WHEN l.id IS NULL THEN '❌ NO LAYER'
    WHEN l.qty_received = d.quantity AND l.unit_cost = d.unit_cost THEN '✅ MATCH'
    ELSE '⚠️ MISMATCH'
  END as validation
FROM inventory_stock_in_documents d
LEFT JOIN inventory_items i ON i.id = d.item_id
LEFT JOIN inventory_receipt_layers l ON l.ref_id = d.id AND l.ref_type = 'STOCK_IN'
ORDER BY d.created_at DESC
LIMIT 10;

-- ============================================
-- 4) CHECK FOR ORPHANS
-- ============================================

-- Documents without receipt layers (SHOULD BE 0)
SELECT
  'Orphan Documents (no receipt layer)' as check_name,
  COUNT(*) as orphan_count
FROM inventory_stock_in_documents d
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_receipt_layers l
  WHERE l.ref_id = d.id AND l.ref_type = 'STOCK_IN'
);

-- Receipt layers without documents (SHOULD BE 0 for STOCK_IN type)
SELECT
  'Orphan Receipt Layers (no stock in document)' as check_name,
  COUNT(*) as orphan_count
FROM inventory_receipt_layers l
WHERE l.ref_type = 'STOCK_IN'
  AND NOT EXISTS (
    SELECT 1 FROM inventory_stock_in_documents d
    WHERE d.id = l.ref_id
  );

-- ============================================
-- 5) CHECK FOR NULL QUANTITY (SHOULD BE 0)
-- ============================================

-- Documents with NULL quantity (SHOULD BE 0)
SELECT
  'Documents with NULL quantity' as check_name,
  COUNT(*) as null_quantity_count
FROM inventory_stock_in_documents
WHERE quantity IS NULL;

-- Documents with NULL item_id (SHOULD BE 0)
SELECT
  'Documents with NULL item_id' as check_name,
  COUNT(*) as null_item_id_count
FROM inventory_stock_in_documents
WHERE item_id IS NULL;

-- ============================================
-- 6) SAMPLE TEST CASE: NEWONN001
-- ============================================

-- Current state of NEWONN001
SELECT
  'NEWONN001 Current State' as info,
  ref_type,
  qty_received,
  qty_remaining,
  unit_cost,
  received_at,
  ref_id
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND COALESCE(is_voided, false) = false
ORDER BY received_at;

-- Total on-hand for NEWONN001
SELECT
  'NEWONN001 Total On-Hand' as info,
  SUM(qty_remaining) as total_on_hand
FROM inventory_receipt_layers
WHERE sku_internal = 'NEWONN001'
  AND COALESCE(is_voided, false) = false;

-- Expected after Stock In 1000 units:
-- - 1 OPENING_BALANCE layer: qty_remaining = 22
-- - 1 STOCK_IN layer: qty_remaining = 1000
-- - Total on-hand = 1022

-- ============================================
-- 7) CLEAN UP TEST DATA (OPTIONAL - RUN MANUALLY)
-- ============================================

/*
-- Delete test stock in documents and their layers
DELETE FROM inventory_receipt_layers
WHERE ref_type = 'STOCK_IN'
  AND ref_id IN (
    SELECT id FROM inventory_stock_in_documents
    WHERE reference LIKE 'QA-TEST-%' OR reference LIKE 'TEST-%'
  );

DELETE FROM inventory_stock_in_documents
WHERE reference LIKE 'QA-TEST-%' OR reference LIKE 'TEST-%';

-- Verify cleanup
SELECT COUNT(*) FROM inventory_stock_in_documents WHERE reference LIKE 'QA-TEST-%';
-- Expected: 0
*/

-- ============================================
-- END OF VERIFICATION SCRIPT
-- ============================================
