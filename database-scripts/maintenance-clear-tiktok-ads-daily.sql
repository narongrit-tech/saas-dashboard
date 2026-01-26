-- ============================================
-- Maintenance: Clear ALL TikTok Ads Daily imported data (Product + Live)
-- Robust version: Auto-detect column names across schema variations
-- Date: 2026-01-26
-- ============================================
-- IMPORTANT: Run as postgres role in Supabase SQL Editor
-- FEATURE: Handles marketplace/channel/platform and source/origin column variations
-- ============================================

BEGIN;

-- ============================================
-- STEP 0: Debug - Show actual column names
-- ============================================

SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name IN ('ad_daily_performance', 'wallet_ledger', 'import_batches')
ORDER BY table_name, ordinal_position;

-- ============================================
-- STEP 1: DELETE ad_daily_performance (product + live)
-- Auto-detect: marketplace/channel/platform and source/origin
-- ============================================

DO $$
DECLARE
    col_market TEXT;
    col_source TEXT;
    col_campaign_type TEXT;
    col_ad_date TEXT;
    preview_query TEXT;
    delete_query TEXT;
BEGIN
    -- Detect marketplace-like column
    SELECT c.column_name INTO col_market
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'ad_daily_performance'
        AND c.column_name IN ('marketplace', 'market_place', 'channel', 'platform')
    LIMIT 1;

    -- Detect source-like column (optional)
    SELECT c.column_name INTO col_source
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'ad_daily_performance'
        AND c.column_name IN ('source', 'data_source', 'origin', 'source_type')
    LIMIT 1;

    -- Detect campaign_type-like column
    SELECT c.column_name INTO col_campaign_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'ad_daily_performance'
        AND c.column_name IN ('campaign_type', 'ads_type', 'ad_type', 'type')
    LIMIT 1;

    -- Detect date column (informational only)
    SELECT c.column_name INTO col_ad_date
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'ad_daily_performance'
        AND c.column_name IN ('ad_date', 'date', 'report_date', 'created_at')
    LIMIT 1;

    -- Validate required columns
    IF col_market IS NULL THEN
        RAISE EXCEPTION 'Cannot find marketplace column in ad_daily_performance (expected: marketplace/market_place/channel/platform)';
    END IF;

    IF col_campaign_type IS NULL THEN
        RAISE EXCEPTION 'Cannot find campaign_type column in ad_daily_performance (expected: campaign_type/ads_type/ad_type/type)';
    END IF;

    RAISE NOTICE 'Detected columns: market=%, source=%, campaign_type=%, date=%',
        col_market, COALESCE(col_source, 'N/A'), col_campaign_type, COALESCE(col_ad_date, 'N/A');

    -- Build and execute preview query
    IF col_source IS NOT NULL THEN
        preview_query := format(
            'SELECT %I as market, %I as campaign_type, COUNT(*) as rows,
                    ROUND(COALESCE(SUM(spend), 0)::NUMERIC, 2) as total_spend,
                    SUM(orders) as total_orders,
                    ROUND(COALESCE(SUM(revenue), 0)::NUMERIC, 2) as total_revenue
             FROM public.ad_daily_performance
             WHERE %I = %L
                 AND %I IN (''product'', ''live'')
                 AND %I = %L
             GROUP BY %I, %I
             ORDER BY %I, %I',
            col_market, col_campaign_type,
            col_market, 'tiktok',
            col_campaign_type,
            col_source, 'imported',
            col_market, col_campaign_type,
            col_market, col_campaign_type
        );
    ELSE
        preview_query := format(
            'SELECT %I as market, %I as campaign_type, COUNT(*) as rows,
                    ROUND(COALESCE(SUM(spend), 0)::NUMERIC, 2) as total_spend,
                    SUM(orders) as total_orders,
                    ROUND(COALESCE(SUM(revenue), 0)::NUMERIC, 2) as total_revenue
             FROM public.ad_daily_performance
             WHERE %I = %L
                 AND %I IN (''product'', ''live'')
             GROUP BY %I, %I
             ORDER BY %I, %I',
            col_market, col_campaign_type,
            col_market, 'tiktok',
            col_campaign_type,
            col_market, col_campaign_type,
            col_market, col_campaign_type
        );
    END IF;

    RAISE NOTICE 'Preview query: %', preview_query;
    EXECUTE preview_query;

    -- Build and execute delete query
    IF col_source IS NOT NULL THEN
        delete_query := format(
            'DELETE FROM public.ad_daily_performance
             WHERE %I = %L
                 AND %I IN (''product'', ''live'')
                 AND %I = %L',
            col_market, 'tiktok',
            col_campaign_type,
            col_source, 'imported'
        );
    ELSE
        delete_query := format(
            'DELETE FROM public.ad_daily_performance
             WHERE %I = %L
                 AND %I IN (''product'', ''live'')',
            col_market, 'tiktok',
            col_campaign_type
        );
    END IF;

    RAISE NOTICE 'Executing delete on ad_daily_performance...';
    EXECUTE delete_query;
    RAISE NOTICE 'ad_daily_performance deletion complete';

END $$;

-- ============================================
-- STEP 2: DELETE wallet_ledger rows related to TikTok ads daily
-- Auto-detect: marketplace/channel and source/origin
-- ============================================

DO $$
DECLARE
    col_market TEXT;
    col_source TEXT;
    col_report_type TEXT;
    has_import_batch_id BOOLEAN;
    delete_query TEXT;
    preview_query TEXT;
BEGIN
    -- Detect marketplace-like column
    SELECT c.column_name INTO col_market
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'wallet_ledger'
        AND c.column_name IN ('marketplace', 'market_place', 'channel', 'platform')
    LIMIT 1;

    -- Detect source-like column
    SELECT c.column_name INTO col_source
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'wallet_ledger'
        AND c.column_name IN ('source', 'data_source', 'origin', 'source_type')
    LIMIT 1;

    -- Detect report_type-like column
    SELECT c.column_name INTO col_report_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
        AND c.table_name = 'wallet_ledger'
        AND c.column_name IN ('report_type', 'ref_type', 'txn_type', 'category', 'type')
    LIMIT 1;

    -- Check if import_batch_id exists
    SELECT EXISTS(
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
            AND c.table_name = 'wallet_ledger'
            AND c.column_name = 'import_batch_id'
    ) INTO has_import_batch_id;

    RAISE NOTICE 'wallet_ledger columns: market=%, source=%, report_type=%, has_import_batch_id=%',
        COALESCE(col_market, 'N/A'), COALESCE(col_source, 'N/A'),
        COALESCE(col_report_type, 'N/A'), has_import_batch_id;

    -- Strategy 1: Use import_batch_id if available
    IF has_import_batch_id THEN
        preview_query := '
            SELECT COUNT(*) as rows, ROUND(COALESCE(SUM(amount), 0)::NUMERIC, 2) as total_amount
            FROM public.wallet_ledger
            WHERE import_batch_id IN (
                SELECT id FROM public.import_batches WHERE report_type = ''tiktok_ads_daily''
            )';

        RAISE NOTICE 'Preview wallet_ledger (via import_batch_id)';
        EXECUTE preview_query;

        delete_query := '
            DELETE FROM public.wallet_ledger
            WHERE import_batch_id IN (
                SELECT id FROM public.import_batches WHERE report_type = ''tiktok_ads_daily''
            )';

        RAISE NOTICE 'Executing delete on wallet_ledger (via import_batch_id)...';
        EXECUTE delete_query;
        RAISE NOTICE 'wallet_ledger deletion complete (via import_batch_id)';

    -- Strategy 2: Use column combination
    ELSIF col_source IS NOT NULL THEN
        IF col_market IS NOT NULL AND col_report_type IS NOT NULL THEN
            delete_query := format(
                'DELETE FROM public.wallet_ledger
                 WHERE %I = %L
                     AND %I = %L
                     AND %I = %L',
                col_market, 'tiktok',
                col_source, 'IMPORTED',
                col_report_type, 'tiktok_ads_daily'
            );
        ELSIF col_market IS NOT NULL THEN
            delete_query := format(
                'DELETE FROM public.wallet_ledger
                 WHERE %I = %L
                     AND %I = %L',
                col_market, 'tiktok',
                col_source, 'IMPORTED'
            );
        ELSIF col_report_type IS NOT NULL THEN
            delete_query := format(
                'DELETE FROM public.wallet_ledger
                 WHERE %I = %L
                     AND %I = %L',
                col_source, 'IMPORTED',
                col_report_type, 'tiktok_ads_daily'
            );
        ELSE
            RAISE NOTICE 'wallet_ledger: insufficient columns for safe deletion (skipping). Manual cleanup may be needed.';
            RETURN;
        END IF;

        RAISE NOTICE 'Executing delete on wallet_ledger (via columns)...';
        EXECUTE delete_query;
        RAISE NOTICE 'wallet_ledger deletion complete';

    -- Strategy 3: Cannot delete safely
    ELSE
        RAISE NOTICE 'wallet_ledger: cannot find source column; skipping wallet cleanup. MANUAL CHECK REQUIRED.';
    END IF;

END $$;

-- ============================================
-- STEP 3: MARK import_batches as rolled_back
-- Note: Using 'rolled_back' instead of 'deleted' because constraint allows it
-- ============================================

UPDATE public.import_batches
SET
    status = 'rolled_back',
    updated_at = NOW(),
    notes = COALESCE(notes || ' | ', '') || 'Cleared by maintenance script at ' || NOW()::TEXT
WHERE report_type = 'tiktok_ads_daily'
    AND status NOT IN ('rolled_back', 'deleted');

-- ============================================
-- STEP 4: VERIFY AFTER CLEANUP
-- ============================================

-- Verification 1: Check ad_daily_performance rows linked to cleared batches
SELECT 'ad_daily_performance: remaining rows linked to batches' as verification,
       COUNT(*) as count
FROM public.ad_daily_performance
WHERE import_batch_id IN (
    SELECT id FROM public.import_batches
    WHERE report_type = 'tiktok_ads_daily'
        AND status IN ('rolled_back', 'deleted')
);
-- Expected: 0 (all data deleted)

-- Verification 2: Check wallet_ledger rows linked to cleared batches
SELECT 'wallet_ledger: remaining rows linked to batches' as verification,
       COUNT(*) as count
FROM public.wallet_ledger
WHERE import_batch_id IN (
    SELECT id FROM public.import_batches
    WHERE report_type = 'tiktok_ads_daily'
);
-- Expected: 0 (all wallet entries deleted)

-- Verification 3: Check import_batches status breakdown
SELECT 'import_batches: status breakdown' as verification,
       status,
       COUNT(*) as batches
FROM public.import_batches
WHERE report_type = 'tiktok_ads_daily'
GROUP BY status
ORDER BY status;
-- Expected: All status='rolled_back' or 'deleted'

-- Verification 4: Overall summary
SELECT
    'SUMMARY' as verification,
    (SELECT COUNT(*) FROM ad_daily_performance
     WHERE import_batch_id IN (
         SELECT id FROM import_batches WHERE report_type = 'tiktok_ads_daily'
     )) as remaining_ads,
    (SELECT COUNT(*) FROM wallet_ledger
     WHERE import_batch_id IN (
         SELECT id FROM import_batches WHERE report_type = 'tiktok_ads_daily'
     )) as remaining_wallet,
    (SELECT COUNT(*) FROM import_batches
     WHERE report_type = 'tiktok_ads_daily'
         AND status NOT IN ('rolled_back', 'deleted')
    ) as active_batches;
-- Expected: remaining_ads=0, remaining_wallet=0, active_batches=0

-- ============================================
-- FINAL STEP: COMMIT
-- ============================================

COMMIT;

-- To rollback instead: ROLLBACK;

-- ============================================
-- Post-cleanup notes
-- ============================================

/*
✅ CLEANUP COMPLETE

What was deleted:
1. ad_daily_performance: All TikTok product/live imported rows
2. wallet_ledger: All related SPEND entries from TikTok ads imports
3. import_batches: Marked as 'rolled_back' (soft delete for audit trail)

Verification:
- Run queries in STEP 4 to ensure 0 remaining rows
- Check UI: /ads page should show 0 TikTok rows
- Check UI: /wallets page ADS balance decreased

Next steps:
- Can now re-import fresh TikTok ads data
- No "duplicate import" errors
- Migration 023 (source_row_hash) ready for clean import

Troubleshooting:
- If wallet_ledger shows "MANUAL CHECK REQUIRED":
  → Check wallet_ledger columns manually
  → Run: SELECT * FROM wallet_ledger LIMIT 5;
  → Delete rows manually if needed

- If any errors during execution:
  → Script is wrapped in BEGIN...COMMIT transaction
  → Change COMMIT to ROLLBACK to undo all changes
  → Report error to dev team
*/
