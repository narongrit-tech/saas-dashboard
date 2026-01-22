-- ============================================
-- Seed: Initial Wallets
-- Description: Create 2 initial wallets (TikTok Ads, Foreign Subscriptions)
-- Phase: 3 - Multi-Wallet
-- Date: 2026-01-23
-- ============================================
--
-- IMPORTANT: This seed script should be run AFTER migration-005-wallets.sql
-- and AFTER a user has logged in (so auth.uid() is available)
--
-- To run manually:
-- 1. Login to your app first
-- 2. Run this in Supabase SQL Editor while authenticated
-- OR
-- 3. Modify this to use a specific user UUID instead of auth.uid()
-- ============================================

-- Note: If you want to create wallets for ALL existing users,
-- you would need to loop through auth.users table.
-- For MVP (<=5 users), you can run this manually per user.

-- Example for creating wallets for current authenticated user:
-- (This will work when run from authenticated context in Supabase SQL Editor)

DO $$
DECLARE
    current_user_id UUID;
BEGIN
    -- Get current authenticated user ID
    current_user_id := auth.uid();

    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'No authenticated user found. Please login first or provide user ID manually.';
    END IF;

    -- Insert TikTok Ads Wallet if not exists
    INSERT INTO public.wallets (
        name,
        wallet_type,
        currency,
        is_active,
        description,
        created_by
    )
    VALUES (
        'TikTok Ads Wallet',
        'ADS',
        'THB',
        true,
        'TikTok advertising spending wallet - top-ups and ad spend tracking',
        current_user_id
    )
    ON CONFLICT DO NOTHING;  -- Prevent duplicates if already exists

    -- Insert Foreign Subscriptions Wallet if not exists
    INSERT INTO public.wallets (
        name,
        wallet_type,
        currency,
        is_active,
        description,
        created_by
    )
    VALUES (
        'Foreign Subscriptions',
        'SUBSCRIPTION',
        'THB',
        true,
        'Monthly subscriptions for AI tools, GSuite, domains, and other SaaS',
        current_user_id
    )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Successfully created initial wallets for user %', current_user_id;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error creating wallets: %', SQLERRM;
END $$;

-- ============================================
-- ALTERNATIVE: Seed for specific user UUID
-- ============================================
-- If you want to create wallets for a specific user,
-- uncomment and modify the following:
--
-- DO $$
-- DECLARE
--     target_user_id UUID := 'YOUR-USER-UUID-HERE';  -- Replace with actual UUID
-- BEGIN
--     INSERT INTO public.wallets (name, wallet_type, currency, is_active, description, created_by)
--     VALUES
--         ('TikTok Ads Wallet', 'ADS', 'THB', true, 'TikTok advertising spending wallet', target_user_id),
--         ('Foreign Subscriptions', 'SUBSCRIPTION', 'THB', true, 'Monthly SaaS subscriptions', target_user_id)
--     ON CONFLICT DO NOTHING;
-- END $$;

-- ============================================
-- VERIFICATION
-- ============================================
-- To verify wallets were created:
-- SELECT * FROM public.wallets ORDER BY created_at DESC;

-- ============================================
-- END OF SEED
-- ============================================
