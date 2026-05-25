# TikTok Shop Partner API to Content Ops Integration

Generated: 2026-04-22
Source repo: `D:/AI_OS/projects/saas-dashboard`
Purpose: central agent-readable reference for integrating TikTok Shop Partner / Affiliate Partner APIs into the SaaS Content Ops module.

---

## Executive Summary

`GET /authorization/202405/category_assets` is a bootstrap endpoint. It does not return content, product, campaign, creator, or order performance by itself. It returns the partner-authorized business category assets for the app, especially `category_asset_cipher`.

That `category_asset_cipher` is the required partner identifier for the Affiliate Partner API family. Once the app has a partner access token (`user_type = 3`) and the needed scopes, Content Ops can use this API family to replace or enrich the current manual TikTok affiliate XLSX and TikTok Studio scrape workflows.

Best fit for this project:

- Use Partner APIs as a server-side sync layer.
- Keep current XLSX import tables as historical/import-compatible ingestion.
- Add Partner API staging/master tables first.
- Normalize API orders into `content_order_facts`.
- Enrich `tt_product_master`, `tt_shop_master`, `video_master_v2`, and `video_overview_cache_v2`.

No live API call was performed during this research. Documentation was publicly readable without login. Live testing requires a real TikTok Shop Partner Center app, approved partner scopes, partner authorization, and a partner access token.

---

## Source Documentation

Primary docs read:

- Get Authorized Category Assets: https://partner.tiktokshop.com/docv2/page/get-authorized-category-assets-202405
- Get Authorized Shops: https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309
- Partner authorization guide: https://partner.tiktokshop.com/docv2/page/partner-authorization-guide
- Common parameters: https://partner.tiktokshop.com/docv2/page/common-parameters
- Sign your API request: https://partner.tiktokshop.com/docv2/page/sign-your-api-request
- Authorization guide 202309: https://partner.tiktokshop.com/docv2/page/authorization-guide-202309
- Common errors: https://partner.tiktokshop.com/docv2/page/common-errors
- Affiliate Partner API overview: https://partner.tiktokshop.com/docv2/page/affiliate-partner-api-overview
- Create Affiliate Partner Campaign: https://partner.tiktokshop.com/docv2/page/create-affiliate-partner-campaign-202405
- Edit Affiliate Partner Campaign: https://partner.tiktokshop.com/docv2/page/edit-affiliate-partner-campaign-202405
- Publish Affiliate Partner Campaign: https://partner.tiktokshop.com/docv2/page/publish-affiliate-partner-campaign-202405
- Review Affiliate Partner Campaign Product: https://partner.tiktokshop.com/docv2/page/review-affiliate-partner-campaign-product-202405
- Generate Affiliate Partner Campaign Product Link: https://partner.tiktokshop.com/docv2/page/generate-affiliate-partner-campaign-product-link-202405
- Get Affiliate Partner Campaign Detail: https://partner.tiktokshop.com/docv2/page/get-affiliate-partner-campaign-detail-202405
- Get Affiliate Partner Campaign List: https://partner.tiktokshop.com/docv2/page/get-affiliate-partner-campaign-list-202405
- Get Affiliate Partner Campaign Product List: https://partner.tiktokshop.com/docv2/page/get-affiliate-partner-campaign-product-list-202405
- Get Affiliate Campaign Creator Fulfillment Status List: https://partner.tiktokshop.com/docv2/page/get-affiliate-campaign-creator-fulfillment-status-list-202501
- Partner Generate Multi Affiliate Campaign Product Link: https://partner.tiktokshop.com/docv2/page/partner-generate-multi-affiliate-campaign-product-link-202505
- Get Affiliate Campaign Creator Fulfillment Status Info: https://partner.tiktokshop.com/docv2/page/get-affiliate-campaign-creator-fulfillment-status-info-202508
- Get Affiliate Campaign Creator Product Content Statistics: https://partner.tiktokshop.com/docv2/page/get-affiliate-campaign-creator-product-content-statistics-202508
- Get Affiliate Campaign Creator Product Sample Status: https://partner.tiktokshop.com/docv2/page/get-affiliate-campaign-creator-product-sample-status-202508
- Search CAP Affiliate Orders: https://partner.tiktokshop.com/docv2/page/search-cap-affiliate-orders-202603
- Search TAP Affiliate Orders: https://partner.tiktokshop.com/docv2/page/search-tap-affiliate-orders-202603

---

## Authorization Model

### Partner Authorization

Partner authorization is distinct from normal seller authorization. The docs state it is currently built for Affiliate Partner APIs and the Seller and Scalable Creator Match-Up / TAP partner category.

Requirements:

- Developer account in TikTok Shop Partner Center.
- Created app.
- Partner API scopes enabled. Partner scope keys start with `partner`.
- Partner must be enrolled as Seller and Scalable Creator Match-Up.
- The app must be authorized by the partner.
- The access token returned by authorization must have `user_type = 3`.

Authorization URL shape:

- US: `https://partner.us.tiktokshop.com/open/authorize?service_id={service_id}`
- ROW: `https://partner.tiktokshop.com/open/authorize?service_id={service_id}`

The `state` parameter is optional but recommended.

### Token Flow

Token endpoint from the 202309 authorization guide:

```text
GET https://auth.tiktok-shops.com/api/v2/token/get
```

Required query:

- `app_key`
- `app_secret`
- `auth_code`
- `grant_type=authorized_code`

Refresh endpoint:

```text
GET https://auth.tiktok-shops.com/api/v2/token/refresh
```

Required query:

- `app_key`
- `app_secret`
- `refresh_token`
- `grant_type=refresh_token`

Store returned values server-side only:

- `access_token`
- `access_token_expire_in`
- `refresh_token`
- `refresh_token_expire_in`
- `open_id`
- `seller_name`
- `seller_base_region`
- `user_type`
- `granted_scopes` if returned

Default access token lifetime is documented as about 7 days. Refresh before expiry.

---

## Common Request Contract

Base API host in examples:

```text
https://open-api.tiktokglobalshop.com
```

Common query parameters:

- `app_key`: app key from Partner Center.
- `timestamp`: 10-digit Unix timestamp. Valid range is approximately current time minus 5 minutes to current time plus 30 seconds.
- `sign`: HMAC-SHA256 request signature.

Common headers:

- `content-type: application/json`
- `x-tts-access-token: {partner_access_token}`

Common partner query parameter:

- `category_asset_cipher`: returned by Get Authorized Category Assets.

Do not send `shop_cipher` to Affiliate Partner endpoints unless the specific endpoint asks for it. Common errors include unexpected identifier errors for extra `shop_cipher` or `category_asset_cipher`.

---

## Signing Algorithm

Use the official HMAC-SHA256 signing rules.

High-level steps:

1. Start with all query params except `sign` and `access_token`.
2. Sort query param keys alphabetically.
3. Concatenate as `{key}{value}`.
4. Prefix the request path.
5. For non-`multipart/form-data` requests with a body, append the JSON request body string exactly as sent.
6. Wrap with app secret: `{app_secret}{path_and_params_and_body}{app_secret}`.
7. HMAC-SHA256 with app secret as key.
8. Hex encode the digest.

Implementation should live server-side only, probably under:

```text
frontend/src/lib/content-ops/tiktok-shop-partner/
```

Suggested files:

- `sign.ts`
- `client.ts`
- `types.ts`
- `sync-category-assets.ts`
- `sync-campaigns.ts`
- `sync-products.ts`
- `sync-creators.ts`
- `sync-content-stats.ts`
- `sync-orders.ts`

Never expose `app_secret`, refresh tokens, or access tokens to browser/client components.

---

## Current Content Ops Data Model

Existing relevant tables and views:

- `content_order_facts`
  - Grain: `UNIQUE (created_by, order_id, sku_id, product_id, content_id)`
  - Existing source: TikTok affiliate XLSX import.
  - Best API target: normalized TAP/CAP affiliate orders.
- `tiktok_affiliate_import_batches`
- `tiktok_affiliate_order_raw_staging`
  - Existing raw XLSX staging.
  - Keep as file-import staging. Add separate API raw staging to avoid mixing source semantics.
- `tt_product_master`
  - Product registry derived from `content_order_facts`.
  - Has enrichment columns: `product_image_url`, `current_price`, `current_commission_rate`, `stock_status`, `showcase_last_synced_at`.
- `tt_shop_master`
  - Shop registry derived from `content_order_facts`.
- `tiktok_video_perf_stats`
  - Existing Creator Video Performance XLSX staging.
- `tiktok_studio_analytics_rows`
  - Existing TikTok Studio scrape staging.
- `video_master_v2`
  - Canonical video registry.
  - Fields include `tiktok_video_id`, `post_url`, `thumbnail_url`, `content_type`.
- `video_source_mapping_v2`
  - Cross-source matching table. Existing allowed source types: `studio_analytics`, `perf_stats`, `affiliate`.
- `video_overview_cache_v2`
  - Pre-aggregated content performance cache.

Important current join assumption:

```text
studio.post_id = perf.video_id_raw = affiliate.content_id
```

Partner API content stats can provide `source_url`, `linked_tiktok_video`, and `cover_img_url`, which can improve this mapping.

---

## Endpoint Matrix

### Authorization

| API | Method | Endpoint | Scope | Content Ops Use |
|---|---:|---|---|---|
| Get Authorized Category Assets | GET | `/authorization/202405/category_assets` | `partner.authorization.info` | Bootstrap `category_asset_cipher` per market/category |
| Get Authorized Shops | GET | `/authorization/202309/shops` | shop auth scope, not TAP-specific | Useful only if later mixing seller/shop APIs |

Get Authorized Category Assets response fields:

- `data.category_assets[].cipher`
- `data.category_assets[].target_market`
- `data.category_assets[].category.id`
- `data.category_assets[].category.name`

Persist these in `tiktok_partner_category_assets`.

### Affiliate Partner Campaign Lifecycle

| API | Method | Endpoint | Scope | Content Ops Use |
|---|---:|---|---|---|
| Create Campaign | POST | `/affiliate_partner/202405/campaigns` | `partner.tap_campaign.write` | Optional future campaign ops |
| Edit Campaign | POST | `/affiliate_partner/202405/campaigns/{campaign_id}/partial_edit` | `partner.tap_campaign.write` | Optional future campaign ops |
| Publish Campaign | POST | `/affiliate_partner/202405/campaigns/{campaign_id}/publish` | `partner.tap_campaign.write` | Optional future campaign ops |
| Get Campaign Detail | GET | `/affiliate_partner/202405/campaigns/{campaign_id}` | `partner.tap_campaign.read` | Campaign master sync |
| Get Campaign List | GET | `/affiliate_partner/202405/campaigns` | `partner.tap_campaign.read` | Campaign master sync |

Campaign body/query fields:

- `name`
- `description`
- `campaign_start_time`
- `campaign_end_time`
- `registration_start_time`
- `registration_end_time`
- `commission_rate`
- `contact_info`
- `target_shop_codes`
- `target_seller_types`: `LOCAL`, `CROSS_BORDER`
- List filters: `status`, `type`, `query_type_filter`, `page_size`, `page_token`

Campaign statuses:

- `READY`
- `UPCOMING`
- `ONGOING`
- `CLOSED`
- `UNSPECIFIED`

Campaign list response fields:

- `campaigns[].id`
- `campaigns[].name`
- `campaigns[].status`
- `campaigns[].registration_start_time`
- `campaigns[].registration_end_time`
- `campaigns[].campaign_start_time`
- `campaigns[].campaign_end_time`
- `next_page_token`
- `total_count`

### Affiliate Partner Product Operations

| API | Method | Endpoint | Scope | Content Ops Use |
|---|---:|---|---|---|
| Get Campaign Product List | GET | `/affiliate_partner/202405/campaigns/{campaign_id}/products` | `partner.tap_campaign.read` | Product/shop enrichment |
| Review Campaign Product | POST | `/affiliate_partner/202405/campaigns/{campaign_id}/products/{product_id}/review` | `partner.tap_campaign.write` | Optional workflow/action UI |
| Generate Product Link | POST | `/affiliate_partner/202405/campaigns/{campaign_id}/products/{product_id}/promotion_link/generate` | `partner.tap_campaign.write` | Optional link generation |
| Batch Generate Product Links | POST | `/affiliate_partner/202505/campaigns/{campaign_id}/products/promotion_links/generate_batch` | `partner.tap_campaign.write` | Optional batch link generation |

Product list filters:

- `review_status`: `PENDING`, `APPROVED`, `REJECTED`, `PENDING_CLOSED`, `CLOSED`
- `product_name`
- `product_id`
- `shop_name`
- `category_id`
- `page_size`
- `page_token`

Product list response fields observed:

- `products[].id`
- `products[].review_status`
- `products[].name`
- `products[].main_image_url`
- `products[].lowest_price.currency`
- `products[].lowest_price.amount`
- `products[].highest_price.currency`
- `products[].highest_price.amount`
- `products[].inventory`
- `products[].shop_name`
- `products[].total_commission_rate`
- `products[].creator_commission_rate`
- `products[].partner_commission_rate`
- `next_page_token`

Map to existing tables:

- `products[].id` -> `tt_product_master.product_id`
- `products[].name` -> `tt_product_master.product_name`
- `products[].main_image_url` -> `tt_product_master.product_image_url`
- `lowest_price.amount` or price range -> `tt_product_master.current_price` or new min/max columns
- `inventory` -> `tt_product_master.stock_status` or new numeric inventory column
- `shop_name` -> `tt_product_master.shop_name` and `tt_shop_master.shop_name`
- commission rates -> `tt_product_master.current_commission_rate`; add separate total/creator/partner rate columns if precision matters

Review request fields:

- `review_result`: `APPROVE`, `REJECT`, `REJECT_FOREVER`
- `reject_reasons`: `COMMISSION_TOO_LOW`, `PRODUCT_HARD_TO_PROMOTE`, `PRODUCT_TOO_EXPENSIVE`, `NO_SUITABLE_CREATOR`

Link generation fields:

- single link body: `creator_commission_rate`
- batch link body: `product_ids[]`, max 50

### Creator and Content Performance

| API | Method | Endpoint | Scope | Content Ops Use |
|---|---:|---|---|---|
| Creator Fulfillment Status List | GET | `/affiliate_partner/202501/campaigns/{campaign_id}/products/performance` | `partner.tap_campaign.read` | Product performance overview by campaign |
| Creator Fulfillment Status Info | GET | `/affiliate_partner/202508/campaigns/{campaign_id}/products/{product_id}/performance` | `partner.tap_campaign.read` | Creator/product performance and profile sync |
| Creator Product Content Statistics | GET | `/affiliate_partner/202508/campaigns/{campaign_id}/products/{product_id}/creator/{creator_temp_id}/content/statistics` | `partner.tap_campaign.read` | Content stats, video URL, cover image, paid orders |
| Creator Product Sample Status | GET | `/affiliate_partner/202508/campaigns/{campaign_id}/products/{product_id}/creator/{creator_temp_id}/content/statistics/sample/status` | `partner.tap_campaign.read` | Sample workflow status |

Creator fulfillment/info response fields observed:

- `total_creator_count`
- `promotion_creators[].paid_amount.currency`
- `promotion_creators[].paid_amount.amount`
- `promotion_creators[].room_count`
- `promotion_creators[].video_count`
- `promotion_creators[].free_sample_status`
- `promotion_creators[].commission`
- `promotion_creators[].effective_start_time`
- `promotion_creators[].effective_end_time`
- `promotion_creators[].creator.nick_name`
- `promotion_creators[].creator.avatar_url`
- `promotion_creators[].creator.follower_num`
- `promotion_creators[].creator.user_name`
- `promotion_creators[].creator.creator_open_id`
- `promotion_creators[].affiliate_product_id`

Content statistics required query/path:

- `campaign_id`
- `product_id`
- `creator_temp_id`
- `affiliate_product_id`
- `content_type`: `VIDEO` or `LIVE_ROOM`
- `category_asset_cipher`

Content statistics response fields observed:

- `creator_content_statistics[].content_type`
- `creator_content_statistics[].cover_img_url`
- `creator_content_statistics[].source_url`
- `creator_content_statistics[].view_count`
- `creator_content_statistics[].like_count`
- `creator_content_statistics[].comment_num`
- `creator_content_statistics[].paid_order_num`
- `creator_content_statistics[].paid_amount`
- `creator_content_statistics[].linked_tiktok_video`
- `creator_content_statistics[].published_date`
- `creator_content_statistics[].content_end_date`

Map to existing tables:

- `linked_tiktok_video` or `source_url` -> `video_master_v2.post_url`
- TikTok video ID parsed from `source_url` or `linked_tiktok_video` -> `video_master_v2.tiktok_video_id`
- `cover_img_url` -> `video_master_v2.thumbnail_url`
- `content_type` -> `video_master_v2.content_type`
- `view_count`, `like_count`, `comment_num`, `paid_order_num`, `paid_amount` -> new Partner API content stats table, then into `video_overview_cache_v2` if desired
- `published_date` -> `video_master_v2.posted_at`
- `creator_open_id` -> new creator master table and optionally mapping metadata

Do not force these rows into `tiktok_studio_analytics_rows`; that table represents Studio scrape snapshots. Use a separate source table and merge into V2 cache.

### Affiliate Orders

| API | Method | Endpoint | Scope | Content Ops Use |
|---|---:|---|---|---|
| Search TAP Affiliate Orders | POST | `/affiliate_partner/202603/orders/search` | `partner.tap_campaign.read` | Main replacement/enrichment path for affiliate order XLSX |
| Search CAP Affiliate Orders | POST | `/affiliate_partner/202603/cap_order/search` | likely partner read scope | CAP flow order ingestion |

TAP order query:

- `category_asset_cipher`
- `page_size`: 1-100
- `page_token`

TAP order body:

- `create_time_ge`
- `create_time_lt`
- `campaign_id`

Time-window constraint:

- Each request supports at most 3 months of data.
- If no create time range is provided, the default is the last 3 months.
- If one create time bound is provided, both must be provided.

TAP order response fields observed:

- `sku_orders[].id`
- `sku_orders[].create_time`
- `sku_orders[].delivery_time`
- `sku_orders[].settle_status`
- `sku_orders[].sku_id`
- `sku_orders[].campaign_id`
- `sku_orders[].creator_username`
- `sku_orders[].product_name`
- `sku_orders[].product_id`
- `sku_orders[].price.amount`
- `sku_orders[].price.currency`
- `sku_orders[].quantity`
- `sku_orders[].content_type`
- `sku_orders[].content_id`
- `sku_orders[].creator_standard_commission_rate`

CAP order body fields observed:

- `order_id`
- `product_id`
- `settle_status`
- `create_time_ge`
- `create_time_lt`

CAP settle status meanings:

- `CUSTOMER UNPAID`
- `PENDING`
- `SETTLED`
- `INELIGIBLE`
- `FROZEN`

Map TAP/CAP orders to `content_order_facts`:

- `id` -> `order_id` or line identifier depending real payload uniqueness
- `sku_id` -> `sku_id`
- `product_id` -> `product_id`
- `content_id` -> `content_id`
- `content_type` -> normalize to `video`, `live`, `showcase`, `other`
- `product_name` -> `product_name`
- `price.amount` -> `price`
- `price.currency` -> `currency`
- `quantity` -> `items_sold`
- `create_time` -> `order_date`
- `delivery_time` -> maybe raw payload only unless business wants delivery reporting
- `settle_status` -> `order_settlement_status`
- commission rates -> commission rate columns if present
- full raw row -> `raw_payload`

Important: `content_order_facts` currently requires `order_id`, `sku_id`, `product_id`, and `content_id` as non-null. API ingestion must reject/quarantine incomplete rows or use a carefully documented placeholder strategy. Prefer quarantine table over placeholder facts.

---

## Proposed New Database Objects

Add a new migration after current content-ops migrations. Suggested name:

```text
database-scripts/migration-112-tiktok-partner-api-sync.sql
```

Suggested tables:

### `tiktok_partner_api_connections`

One row per connected partner/app/user context.

Key columns:

- `id uuid`
- `created_by uuid`
- `app_key text`
- `partner_open_id text`
- `partner_name text`
- `base_region text`
- `user_type int`
- `granted_scopes text[]`
- `access_token_ciphertext text`
- `access_token_expires_at timestamptz`
- `refresh_token_ciphertext text`
- `refresh_token_expires_at timestamptz`
- `status text`
- `last_refreshed_at timestamptz`
- `metadata jsonb`

Security:

- RLS by `created_by`.
- Only server-side service role should decrypt/use tokens.

### `tiktok_partner_category_assets`

Key columns:

- `id uuid`
- `created_by uuid`
- `connection_id uuid`
- `cipher text`
- `target_market text`
- `category_id text`
- `category_name text`
- `last_synced_at timestamptz`
- `raw_payload jsonb`

Unique:

- `(created_by, connection_id, cipher)`

### `tiktok_partner_campaigns`

Key columns:

- `id uuid`
- `created_by uuid`
- `connection_id uuid`
- `category_asset_cipher text`
- `campaign_id text`
- `name text`
- `status text`
- `campaign_start_time timestamptz`
- `campaign_end_time timestamptz`
- `registration_start_time timestamptz`
- `registration_end_time timestamptz`
- `campaign_type text`
- `query_type_filter text`
- `raw_payload jsonb`
- `last_synced_at timestamptz`

Unique:

- `(created_by, campaign_id)`

### `tiktok_partner_campaign_products`

Key columns:

- `id uuid`
- `created_by uuid`
- `campaign_id text`
- `product_id text`
- `review_status text`
- `product_name text`
- `main_image_url text`
- `lowest_price_amount numeric(18,2)`
- `highest_price_amount numeric(18,2)`
- `currency text`
- `inventory integer`
- `shop_name text`
- `category_id text`
- `total_commission_rate numeric(9,6)`
- `creator_commission_rate numeric(9,6)`
- `partner_commission_rate numeric(9,6)`
- `raw_payload jsonb`
- `last_synced_at timestamptz`

Unique:

- `(created_by, campaign_id, product_id)`

### `tiktok_partner_campaign_creators`

Key columns:

- `id uuid`
- `created_by uuid`
- `campaign_id text`
- `product_id text`
- `affiliate_product_id text`
- `creator_open_id text`
- `creator_username text`
- `creator_nickname text`
- `creator_avatar_url text`
- `follower_num integer`
- `video_count integer`
- `room_count integer`
- `free_sample_status text`
- `paid_amount numeric(18,2)`
- `currency text`
- `commission_rate numeric(9,6)`
- `effective_start_time timestamptz`
- `effective_end_time timestamptz`
- `raw_payload jsonb`
- `last_synced_at timestamptz`

Unique:

- `(created_by, campaign_id, product_id, creator_open_id)`

### `tiktok_partner_content_stats`

Key columns:

- `id uuid`
- `created_by uuid`
- `campaign_id text`
- `product_id text`
- `affiliate_product_id text`
- `creator_open_id text`
- `content_type text`
- `content_id text`
- `source_url text`
- `linked_tiktok_video text`
- `cover_img_url text`
- `published_date date`
- `content_end_date date`
- `view_count bigint`
- `like_count bigint`
- `comment_count bigint`
- `paid_order_count integer`
- `paid_amount numeric(18,2)`
- `currency text`
- `raw_payload jsonb`
- `last_synced_at timestamptz`

Unique:

- `(created_by, campaign_id, product_id, creator_open_id, content_id)`

If content ID is not explicitly returned, derive from URL and store derivation confidence in `metadata`.

### `tiktok_affiliate_api_order_raw_staging`

Do not overload the existing XLSX raw staging table.

Key columns:

- `id uuid`
- `created_by uuid`
- `connection_id uuid`
- `category_asset_cipher text`
- `source_endpoint text`
- `sync_batch_id uuid`
- `order_id text`
- `sku_id text`
- `product_id text`
- `content_id text`
- `campaign_id text`
- `create_time timestamptz`
- `settle_status_raw text`
- `raw_payload jsonb`
- `normalized_at timestamptz`
- `normalization_status text`
- `normalization_error text`

Unique candidate:

- `(created_by, source_endpoint, order_id, sku_id, product_id, content_id)`

Validate against real API payload before finalizing uniqueness. If the API `id` is SKU-order level, it may be sufficient as `order_id`; if not, use a deterministic source row hash.

### `tiktok_partner_sync_batches`

Batch tracking for all Partner API pulls.

Key columns:

- `id uuid`
- `created_by uuid`
- `connection_id uuid`
- `sync_type text`
- `source_endpoint text`
- `started_at timestamptz`
- `finished_at timestamptz`
- `status text`
- `page_count integer`
- `row_count integer`
- `error_count integer`
- `request_metadata jsonb`
- `response_metadata jsonb`

---

## Normalization and Cache Strategy

### Product and Shop Master

After syncing campaign products:

1. Upsert `tiktok_partner_campaign_products`.
2. Upsert `tt_product_master` by `(created_by, product_id)`.
3. Update:
   - `product_name`
   - `product_image_url`
   - `current_price`
   - `current_commission_rate`
   - `stock_status`
   - `showcase_last_synced_at`
4. Upsert/update `tt_shop_master` if a stable shop code is available. If only `shop_name` is available, do not invent `shop_code`; store shop-name-only linkage in Partner API table and wait for order facts or seller metadata.

### Video Master V2

After syncing content stats:

1. Insert/update `tiktok_partner_content_stats`.
2. Parse TikTok video ID from `source_url` or `linked_tiktok_video`.
3. Upsert `video_master_v2`.
4. Upsert `video_source_mapping_v2` with `source_type = 'affiliate'` using `content_id` or parsed video ID.
5. Rebuild `video_overview_cache_v2`.

Potential migration change:

- If agents want a separate source type for Partner API stats, extend `video_source_mapping_v2.source_type` to include `partner_api`.
- Conservative first step: reuse `affiliate` because the API stats are affiliate campaign content stats.

### Content Order Facts

After syncing TAP/CAP orders:

1. Insert raw rows into `tiktok_affiliate_api_order_raw_staging`.
2. Normalize into `content_order_facts`.
3. Preserve full source response in `raw_payload`.
4. Use the same status normalization concepts from migration 094.
5. Refresh downstream:
   - attribution views read automatically from facts.
   - run `refresh_tt_product_shop_master(p_created_by)` if tables exist.
   - run `refresh_content_profit_layer(p_created_by)` after facts/cost changes.
   - rebuild `video_overview_cache_v2`.

---

## Suggested Server API Routes

Keep routes authenticated and server-only.

Suggested Next.js API routes:

- `POST /api/content-ops/tiktok-partner/oauth/callback`
- `POST /api/content-ops/tiktok-partner/sync/category-assets`
- `POST /api/content-ops/tiktok-partner/sync/campaigns`
- `POST /api/content-ops/tiktok-partner/sync/campaign-products`
- `POST /api/content-ops/tiktok-partner/sync/creator-performance`
- `POST /api/content-ops/tiktok-partner/sync/content-stats`
- `POST /api/content-ops/tiktok-partner/sync/orders`

Suggested server actions:

- `getPartnerConnections()`
- `getPartnerCategoryAssets()`
- `runPartnerCategoryAssetSync()`
- `runPartnerCampaignSync()`
- `runPartnerProductSync()`
- `runPartnerContentStatsSync()`
- `runPartnerOrderSync()`

Suggested UI location:

```text
frontend/src/app/(dashboard)/content-ops/tiktok-partner/
```

Initial UI can be minimal:

- connection status
- scopes
- category assets
- sync buttons
- latest sync batches
- error log

---

## Error Handling

Common errors from docs:

- `0`: success.
- `36009002`: too many requests. Back off and retry.
- `36009007`: request timeout. Retry or split into smaller requests.
- `36009009`: invalid path.
- `36009010`: invalid method.
- `36009022`: invalid request format. Use `application/json` or `multipart/form-data` as required.
- `101000`: invalid `category_asset_cipher` or `x-tts-access-token`.
- `105005`: access denied, missing required scope.
- `36009033`: IP address is not in app allow list.
- `105002`: expired access token.
- `106001`: invalid signature.
- `36009004`: missing/invalid credentials, invalid app key, invalid timestamp, unexpected identifier, invalid API version.
- `36004004`: invalid auth code.

Affiliate Partner business errors observed:

- `16032001`: invalid creator/seller parameter or region mismatch.
- `16032002`: invalid campaign period.
- `16032003`: invalid registration period.
- `16032004`: invalid campaign seller scope.
- `16032005`: campaign not found.
- `16032007`: permission denied.
- `16032008`: operation denied.
- `16032013`: payment account not activated.
- `36009003`: internal error.

Implementation rules:

- Persist every sync attempt in `tiktok_partner_sync_batches`.
- Store TikTok `request_id` on failure and success.
- Treat auth/scope/signature errors as non-retryable.
- Treat timeout/internal/rate-limit errors as retryable with bounded exponential backoff.
- Split order sync windows into <= 3 months.
- Use pagination until `next_page_token` is empty.

---

## Security Notes

- Keep `app_secret`, access tokens, and refresh tokens server-side only.
- Do not pass tokens to client components.
- Consider encryption-at-rest for token columns. Supabase RLS is not enough for secrets.
- Use service role only in server routes/scripts.
- Validate `created_by` and team access consistently with existing Content Ops conventions.
- Log request metadata, not raw tokens.
- Redact `x-tts-access-token`, `app_secret`, `refresh_token`, and `sign` in logs.
- Respect Partner Center IP allow list if enabled.

---

## Recommended Implementation Order

### Phase 1: Read-only bootstrap

1. Add signing/client library.
2. Add token/connection storage design.
3. Add `tiktok_partner_category_assets`.
4. Implement `GET /authorization/202405/category_assets` sync.
5. Show category assets in a small internal Content Ops page.

Done when:

- App can store a partner connection.
- App can refresh token server-side.
- App can list category assets and persist `category_asset_cipher`.

### Phase 2: Campaign and product enrichment

1. Add `tiktok_partner_campaigns`.
2. Add `tiktok_partner_campaign_products`.
3. Sync campaign list/detail.
4. Sync campaign product list.
5. Upsert enrichment into `tt_product_master`.

Done when:

- Product pages show API-sourced image, price, commission, inventory.
- Sync batches are visible.
- Re-running sync is idempotent.

### Phase 3: Creator and content stats

1. Add creator table.
2. Add content stats table.
3. Sync creator fulfillment/status info.
4. Sync creator content statistics.
5. Upsert into `video_master_v2` and rebuild `video_overview_cache_v2`.

Done when:

- Content Ops can show API-sourced cover image, source URL, views, likes, comments, paid orders, paid amount.
- Video master can link API content to existing affiliate facts.

### Phase 4: API order ingestion

1. Add `tiktok_affiliate_api_order_raw_staging`.
2. Implement TAP order sync with 3-month window chunking.
3. Normalize API orders into `content_order_facts`.
4. Compare counts against existing XLSX imports.
5. Only then consider replacing manual XLSX workflow.

Done when:

- API order facts match XLSX import expectations for a test period.
- Attribution and profit layer remain stable.
- Duplicate handling is proven.

### Phase 5: Write operations

Only after read-only sync is stable:

- create/edit/publish campaigns
- review campaign products
- generate promotion links

These operations change TikTok-side state and should have explicit UI confirmations, audit logs, and permission checks.

---

## Agent Handoff Notes

When another agent starts implementation, read these files first:

- `docs/content-ops/TIKTOK_SHOP_PARTNER_API_CONTENT_OPS_INTEGRATION.md`
- `docs/content-ops/CONTENT_OPS_MODULE_MAP.md`
- `docs/content-ops/CONTENT_OPS_PRODUCT_SHOP_MASTER_STATE.md`
- `database-scripts/migration-094-tiktok-affiliate-content-attribution.sql`
- `database-scripts/migration-102-tiktok-affiliate-product-shop-master.sql`
- `database-scripts/migration-108-video-master-v2.sql`
- `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/actions.ts`
- `frontend/src/lib/content-ops/video-master-v2-sync.ts`
- `frontend/src/lib/content-ops/master-refresh.ts`

Do not start by changing existing XLSX importer behavior. Build Partner API sync as a parallel ingestion path, compare outputs, then decide cutover.

Open questions for live validation:

- Does TAP order `sku_orders[].id` represent order line grain or parent order grain?
- Does content stats response include a stable `content_id`, or must it be parsed from URLs?
- Does campaign product list return shop code anywhere beyond `shop_name`?
- Which markets/categories are returned for the real partner account?
- Are rate limits documented per app/endpoint in the logged-in dashboard?
- Does `granted_scopes` appear in the partner token response for this account?

---

## Minimal Environment Variables

Suggested names:

```text
TIKTOK_SHOP_APP_KEY=
TIKTOK_SHOP_APP_SECRET=
TIKTOK_SHOP_API_BASE_URL=https://open-api.tiktokglobalshop.com
TIKTOK_SHOP_AUTH_BASE_URL=https://auth.tiktok-shops.com
TIKTOK_SHOP_PARTNER_AUTHORIZE_BASE_URL=https://partner.tiktokshop.com/open/authorize
TIKTOK_SHOP_PARTNER_AUTHORIZE_US_BASE_URL=https://partner.us.tiktokshop.com/open/authorize
```

For multi-user SaaS, do not rely only on env vars for tokens. Env vars are fine for app credentials; partner access/refresh tokens should be per connected user/team.

