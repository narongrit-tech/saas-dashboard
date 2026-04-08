# CONTENT_OPS_IMPORT_EXECUTION_REPORT.md
Generated: 2026-04-08 | Part 1 Execution Run

---

## Preflight Summary

| Check | Result |
|-------|--------|
| Import script location | `frontend/scripts/import-tiktok-affiliate-orders.ts` |
| tsx version | 4.21.0 ✅ |
| node version | v20.20.2 ✅ |
| .env.local loaded via `set -a; source .env.local; set +a` | ✅ |
| NEXT_PUBLIC_SUPABASE_URL | `https://ntvzawokbmbjwphsqbnd.supabase.co` ✅ |
| SUPABASE_SERVICE_ROLE_KEY | Present ✅ |
| created_by UUID resolved | `2c4e254d-c779-4f8a-af93-603dc26e6af0` (narongrit@nimittmind.com) |
| Source XLSX files | 11 files in `D:/AI_OS/data/raw/tiktok-affiliate-orders/` ✅ |

---

## Critical Issues Found and Resolved

### Issue 1: Normalization RPC Timeout (CRITICAL)

**Root cause:** `normalize_tiktok_affiliate_order_batch()` RPC times out for large batches because:
1. `tiktok_affiliate_parse_timestamp()` uses PL/pgSQL EXCEPTION blocks (4 per call) for every timestamp parse. With 12,196 rows × 2 date columns = ~97,000+ savepoint operations.
2. ON CONFLICT WHERE clause has correlated subqueries — 2 extra lookups to `tiktok_affiliate_order_raw_staging` per winner row during upsert.

**Evidence:** First file (12,196 rows) staged successfully, normalization timed out with `canceling statement due to statement timeout`.

**Fix:** Written new JS-based normalizer that:
- Reads staged rows in pages of 1,000
- Normalizes all fields in JavaScript (no EXCEPTION blocks)
- Selects winners in-memory
- Upserts to `content_order_facts` in chunks of 500
- Updates batch status to 'normalized' with full metrics

**New scripts:**
- `frontend/scripts/normalize-staged-batch.ts` — normalizes an already-staged batch by ID
- `frontend/scripts/import-affiliate-js.ts` — full pipeline: parse → stage → normalize (JS)

### Issue 2: Bangkok Timezone (MEDIUM — Not Yet Fixed)

**Root cause:** `tiktok_affiliate_parse_timestamp()` uses `to_timestamp()` without Bangkok timezone. Orders near midnight Bangkok time (00:00–07:00 BKK = 17:00–24:00 UTC previous day) may be bucketed to the wrong day in analytics.

**Status:** NOT FIXED — requires direct Supabase SQL editor access. SQL fix provided below.

**Impact:** Low for import correctness. Affects only day-boundary analytics (~7 hours overlap). Data is still correct at order/sku/product/content grain.

**SQL Fix (apply manually in Supabase SQL editor):**

```sql
CREATE OR REPLACE FUNCTION public.tiktok_affiliate_parse_timestamp(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
  result TIMESTAMPTZ;
BEGIN
  cleaned := public.tiktok_affiliate_trim_null(p_value);
  IF cleaned IS NULL OR cleaned = '/' THEN RETURN NULL; END IF;

  -- DD/MM/YYYY HH24:MI:SS (Bangkok = UTC+7, subtract 7h to store as UTC)
  IF cleaned ~ '^\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}(:\d{2})?$' THEN
    BEGIN
      result := to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI:SS') - INTERVAL '7 hours';
      RETURN result;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      result := to_timestamp(cleaned, 'DD/MM/YYYY HH24:MI') - INTERVAL '7 hours';
      RETURN result;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- DD/MM/YYYY date only
  IF cleaned ~ '^\d{2}/\d{2}/\d{4}$' THEN
    BEGIN
      RETURN (to_date(cleaned, 'DD/MM/YYYY'))::TIMESTAMPTZ - INTERVAL '7 hours';
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- ISO fallback
  BEGIN
    RETURN cleaned::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
END;
$$;
```

After applying: re-run normalizer for all batches to recompute timestamps:
```bash
# For each batch ID from tiktok_affiliate_import_batches:
cd frontend && set -a && source .env.local && set +a
npx tsx scripts/normalize-staged-batch.ts --batch-id <uuid>
```

---

## Working Directory

All commands run from: `D:/AI_OS/projects/saas-dashboard/frontend`

Command format used:
```bash
cd D:/AI_OS/projects/saas-dashboard/frontend && set -a && source .env.local && set +a && npx tsx scripts/import-affiliate-js.ts --file "<path>" --created-by "2c4e254d-c779-4f8a-af93-603dc26e6af0"
```

---

## Per-File Import Results

| File | Raw Rows | Staged | Winners | Missing Keys | Dup Non-Winners | Status |
|------|----------|--------|---------|--------------|-----------------|--------|
| affiliate_orders_7618854163563579157.xlsx | 12,196 | 12,196 | 12,196 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618867345074243349.xlsx | 8,537 | 8,537 | 8,537 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618876830473340693.xlsx | 10,355 | 10,355 | 10,355 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618876830473357077.xlsx | 10,864 | 10,864 | 10,864 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618876830473373461.xlsx | 10,677 | 10,677 | 10,677 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618887641506400020.xlsx | 8,581 | 8,581 | 8,581 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618898234601932565.xlsx | 5,896 | 5,896 | 5,896 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618909491375523605.xlsx | 12,769 | 12,769 | 12,769 | 0 | 0 | normalized ✅ |
| affiliate_orders_7618928165297424148.xlsx | 10,809 | 10,809 | 10,809 | 0 | 0 | normalized ✅ |
| affiliate_orders_7619024810984720149.xlsx | 3,881 | 3,881 | 3,881 | 0 | 0 | normalized ✅ |
| affiliate_orders_7619186154803693333.xlsx | 13,422 | 13,422 | 13,422 | 0 | 0 | normalized ✅ |
| **TOTAL** | **107,987** | **107,987** | **107,987** | **0** | **0** | **11/11 normalized** |

Notes:
- Zero missing key rows across all 11 files (all rows have valid order_id, sku_id, product_id, content_id)
- Zero duplicate non-winners within any single file (each key combination appears once per file)
- Cross-file deduplication: UPSERT on `UNIQUE(created_by, order_id, sku_id, product_id, content_id)` — if same order appears in multiple files, later-imported version wins

---

## Created_by Resolution Method

Queried Supabase Admin API:
```
GET https://ntvzawokbmbjwphsqbnd.supabase.co/auth/v1/admin/users
Authorization: Bearer <service_role_key>
```
Result: narongrit@nimittmind.com → `2c4e254d-c779-4f8a-af93-603dc26e6af0`
