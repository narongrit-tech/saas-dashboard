-- ============================================
-- Migration 058: Rename Bundle SKU NEWOON003 -> NEWONN003
-- Description: Fix typo in bundle SKU name
-- Date: 2026-02-18
-- BUG: TikTok orders use NEWONN003 but system has NEWOON003 (typo)
-- IMPACT: Orders don't allocate COGS due to SKU mismatch
-- ============================================

-- SAFETY GUARDS:
-- 1. Check if source SKU exists
-- 2. Check if target SKU already exists (conflict)
-- 3. Check for COGS allocations (should be none)
-- 4. Warn if sales_orders reference exists
-- 5. Transaction rollback on any error

BEGIN;

-- ============================================
-- GUARD 1: Check if source SKU exists
-- ============================================
DO $$
DECLARE
    v_source_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWOON003'
    ) INTO v_source_exists;

    IF NOT v_source_exists THEN
        RAISE NOTICE 'GUARD 1 PASS: Source SKU NEWOON003 does not exist. Migration is no-op.';
        -- This is OK - maybe already renamed
        -- Continue but mark as no-op
    ELSE
        RAISE NOTICE 'GUARD 1 PASS: Source SKU NEWOON003 exists. Proceeding with rename.';
    END IF;
END $$;

-- ============================================
-- GUARD 2: Check if target SKU already exists
-- ============================================
DO $$
DECLARE
    v_target_exists BOOLEAN;
    v_source_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWOON003'
    ) INTO v_source_exists;

    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWONN003'
    ) INTO v_target_exists;

    IF v_source_exists AND v_target_exists THEN
        RAISE EXCEPTION 'GUARD 2 FAIL: Target SKU NEWONN003 already exists! Cannot rename. Manual merge required.';
    END IF;

    IF v_target_exists THEN
        RAISE NOTICE 'GUARD 2 PASS: Target SKU NEWONN003 already exists (source does not). No rename needed.';
    ELSE
        RAISE NOTICE 'GUARD 2 PASS: Target SKU NEWONN003 does not exist. Safe to rename.';
    END IF;
END $$;

-- ============================================
-- GUARD 3: Check for COGS allocations
-- ============================================
DO $$
DECLARE
    v_alloc_count INTEGER;
    v_source_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWOON003'
    ) INTO v_source_exists;

    IF v_source_exists THEN
        SELECT COUNT(*) INTO v_alloc_count
        FROM inventory_cogs_allocations
        WHERE sku_internal = 'NEWOON003';

        IF v_alloc_count > 0 THEN
            RAISE EXCEPTION 'GUARD 3 FAIL: Found % COGS allocations for NEWOON003! Cannot rename safely. Manual intervention required.', v_alloc_count;
        END IF;

        RAISE NOTICE 'GUARD 3 PASS: No COGS allocations found for NEWOON003. Safe to rename.';
    END IF;
END $$;

-- ============================================
-- GUARD 4: Warn if sales_orders reference exists
-- ============================================
DO $$
DECLARE
    v_sales_count INTEGER;
    v_source_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWOON003'
    ) INTO v_source_exists;

    IF v_source_exists THEN
        SELECT COUNT(*) INTO v_sales_count
        FROM sales_orders
        WHERE seller_sku = 'NEWOON003';

        IF v_sales_count > 0 THEN
            RAISE WARNING 'GUARD 4 WARN: Found % sales_orders rows with seller_sku = NEWOON003. These will NOT be updated by this migration. You may need to fix imports or manually update.', v_sales_count;
        ELSE
            RAISE NOTICE 'GUARD 4 PASS: No sales_orders rows found with seller_sku = NEWOON003.';
        END IF;
    END IF;
END $$;

-- ============================================
-- MIGRATION: Rename SKU
-- ============================================
DO $$
DECLARE
    v_source_exists BOOLEAN;
    v_target_exists BOOLEAN;
    v_updated_items INTEGER := 0;
    v_updated_bundle_components_bundle INTEGER := 0;
    v_updated_bundle_components_component INTEGER := 0;
BEGIN
    -- Check existence
    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWOON003'
    ) INTO v_source_exists;

    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWONN003'
    ) INTO v_target_exists;

    -- Only proceed if source exists and target does not
    IF NOT v_source_exists THEN
        RAISE NOTICE 'MIGRATION: Source SKU NEWOON003 does not exist. No-op.';
        RETURN;
    END IF;

    IF v_target_exists THEN
        RAISE NOTICE 'MIGRATION: Target SKU NEWONN003 already exists. No-op.';
        RETURN;
    END IF;

    -- Proceed with rename
    RAISE NOTICE 'MIGRATION: Starting rename NEWOON003 -> NEWONN003...';

    -- IMPORTANT: Temporarily disable foreign key constraints to allow rename
    -- This is safe because we're renaming consistently across all tables

    -- Get the constraint name
    -- Note: Supabase/Postgres foreign key constraint name should be inventory_bundle_components_bundle_sku_fkey

    -- Disable constraint temporarily (ALTER TABLE ... DISABLE TRIGGER won't work for FK)
    -- Instead, we'll drop and recreate the constraint
    -- But simpler: Update in a way that preserves referential integrity

    -- Better approach: Use a temporary intermediate value
    -- Step 1: Rename to temp value in parent
    -- Step 2: Update children to temp value
    -- Step 3: Rename temp to final in parent
    -- Step 4: Update children to final

    -- Actually, simplest approach: Drop FK constraint, do updates, recreate FK

    RAISE NOTICE 'MIGRATION: Temporarily dropping foreign key constraints...';

    -- Drop FK constraint on bundle_sku
    ALTER TABLE inventory_bundle_components
    DROP CONSTRAINT IF EXISTS inventory_bundle_components_bundle_sku_fkey;

    -- Drop FK constraint on component_sku
    ALTER TABLE inventory_bundle_components
    DROP CONSTRAINT IF EXISTS inventory_bundle_components_component_sku_fkey;

    RAISE NOTICE 'MIGRATION: Foreign key constraints dropped. Proceeding with updates...';

    -- Now we can update in any order

    -- 1. Update inventory_items
    UPDATE inventory_items
    SET sku_internal = 'NEWONN003',
        updated_at = NOW()
    WHERE sku_internal = 'NEWOON003';

    GET DIAGNOSTICS v_updated_items = ROW_COUNT;
    RAISE NOTICE 'MIGRATION: Updated % row(s) in inventory_items', v_updated_items;

    -- 2. Update inventory_bundle_components (bundle_sku column)
    UPDATE inventory_bundle_components
    SET bundle_sku = 'NEWONN003',
        updated_at = NOW()
    WHERE bundle_sku = 'NEWOON003';

    GET DIAGNOSTICS v_updated_bundle_components_bundle = ROW_COUNT;
    RAISE NOTICE 'MIGRATION: Updated % row(s) in inventory_bundle_components (bundle_sku)', v_updated_bundle_components_bundle;

    -- 3. Update inventory_bundle_components (component_sku column - unlikely but safe)
    UPDATE inventory_bundle_components
    SET component_sku = 'NEWONN003',
        updated_at = NOW()
    WHERE component_sku = 'NEWOON003';

    GET DIAGNOSTICS v_updated_bundle_components_component = ROW_COUNT;
    RAISE NOTICE 'MIGRATION: Updated % row(s) in inventory_bundle_components (component_sku)', v_updated_bundle_components_component;

    -- 4. Update inventory_receipt_layers (if any - should be none for bundles)
    -- Note: Bundles should NOT have receipt layers, but include for completeness
    UPDATE inventory_receipt_layers
    SET sku_internal = 'NEWONN003',
        updated_at = NOW()
    WHERE sku_internal = 'NEWOON003';

    GET DIAGNOSTICS v_updated_items = ROW_COUNT;
    -- Log if unexpected
    IF v_updated_items > 0 THEN
        RAISE WARNING 'MIGRATION: Updated % inventory_receipt_layers for NEWOON003 (unexpected for bundle SKU)', v_updated_items;
    END IF;

    -- 5. Recreate foreign key constraints
    RAISE NOTICE 'MIGRATION: Recreating foreign key constraints...';

    -- Recreate FK constraint on bundle_sku
    ALTER TABLE inventory_bundle_components
    ADD CONSTRAINT inventory_bundle_components_bundle_sku_fkey
    FOREIGN KEY (bundle_sku)
    REFERENCES inventory_items(sku_internal)
    ON DELETE CASCADE;

    -- Recreate FK constraint on component_sku
    ALTER TABLE inventory_bundle_components
    ADD CONSTRAINT inventory_bundle_components_component_sku_fkey
    FOREIGN KEY (component_sku)
    REFERENCES inventory_items(sku_internal)
    ON DELETE CASCADE;

    RAISE NOTICE 'MIGRATION: Foreign key constraints recreated.';

    RAISE NOTICE 'MIGRATION: Rename completed successfully!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'SUMMARY:';
    RAISE NOTICE '  - FK constraints: dropped & recreated';
    RAISE NOTICE '  - inventory_items: % rows updated', v_updated_items;
    RAISE NOTICE '  - bundle_components (bundle_sku): % rows updated', v_updated_bundle_components_bundle;
    RAISE NOTICE '  - bundle_components (component_sku): % rows updated', v_updated_bundle_components_component;
    RAISE NOTICE '========================================';
END $$;

-- ============================================
-- VERIFICATION: Check rename success
-- ============================================
DO $$
DECLARE
    v_old_exists BOOLEAN;
    v_new_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWOON003'
    ) INTO v_old_exists;

    SELECT EXISTS(
        SELECT 1 FROM inventory_items WHERE sku_internal = 'NEWONN003'
    ) INTO v_new_exists;

    IF v_old_exists THEN
        RAISE WARNING 'VERIFICATION: Old SKU NEWOON003 still exists! Rename may have failed.';
    ELSE
        RAISE NOTICE 'VERIFICATION: Old SKU NEWOON003 no longer exists. ✓';
    END IF;

    IF v_new_exists THEN
        RAISE NOTICE 'VERIFICATION: New SKU NEWONN003 exists. ✓';
    ELSE
        RAISE NOTICE 'VERIFICATION: New SKU NEWONN003 does not exist (expected if source did not exist).';
    END IF;
END $$;

-- ============================================
-- COMMIT or ROLLBACK
-- ============================================
-- If you reach here without errors, commit
-- Otherwise, transaction will auto-rollback

COMMIT;

-- ============================================
-- POST-MIGRATION NOTES
-- ============================================
-- IMPORTANT: This migration does NOT update sales_orders.seller_sku
-- Reason: sales_orders is a historical import table, changing it could break imports
-- Action required: Update future imports to use correct SKU (NEWONN003)
-- Workaround: You may need to manually update existing sales_orders rows:
--   UPDATE sales_orders SET seller_sku = 'NEWONN003' WHERE seller_sku = 'NEWOON003';
-- But be careful - this changes historical data!
