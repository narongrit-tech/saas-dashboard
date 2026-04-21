# AUDIT_FINDINGS — Inventory & COGS System
**Date:** 2026-04-21 | **Auditor:** Claude Sonnet 4.6  
**Project:** saas-dashboard | **Scope:** FIFO allocation engine, bundle logic, ALLOCATION_FAILED root causes, Bundle Stock Visibility

---

## 1. Current Allocation Logic (Proven from Code)

### 1.1 Data Flow

```
applyCOGSMTD (actions.ts)
  └─ Pre-fetch: bundleSkuSet from inventory_items WHERE is_bundle=true
  └─ Pre-fetch: bundleComponentsMap from inventory_bundle_components
  └─ Loop orders (order_date ASC, ORDERS_PER_CHUNK = 200) in sliding offset windows
      ├─ non-bundle: _allocateRPC(supabase, method, userId, orderUuid, sku, qty, shipped_at)
      └─ bundle: _allocateBundleOrderCOGS(...)
                   ├─ per-component idempotency SELECT
                   └─ _allocateRPC for each unallocated component (comp.qty = component.quantity × order_qty)
  └─ completeCogsRunSuccess / completeCogsRunFailed
```

### 1.2 FIFO RPC (Current — migration-083)

```sql
allocate_cogs_fifo(p_order_id uuid, p_sku text, p_qty numeric, p_shipped_at timestamptz, p_user_id uuid)
```

**Execution order inside the function:**
1. Guard: `auth.uid() == p_user_id`
2. Guard: `qty > 0`
3. Guard: `sales_orders WHERE id = p_order_id AND created_by = auth.uid()`
4. Idempotency: `inventory_cogs_allocations WHERE order_id = p_order_id AND sku_internal = p_sku AND is_reversal = false AND created_by = auth.uid()`
5. Consume layers:
   ```sql
   SELECT id, qty_remaining, unit_cost
   FROM inventory_receipt_layers
   WHERE sku_internal = p_sku
     AND created_by = auth.uid()
     AND is_voided = false
     AND qty_remaining > 0
   ORDER BY received_at ASC  -- FIFO: oldest first
   FOR UPDATE                -- row lock prevents concurrent over-allocation
   ```
6. Per layer: `INSERT INTO inventory_cogs_allocations + UPDATE inventory_receipt_layers` (same transaction)
7. If `v_remaining > 0` after all layers: `RAISE EXCEPTION 'insufficient_stock'` → automatic ROLLBACK

### 1.3 Timestamps Used

| Purpose | Field Used |
|---------|-----------|
| Basis for FIFO order | `received_at ASC` (on receipt layers) |
| Stored in allocation row | `shipped_at` (from sales_orders) |
| Batch filter (which orders) | `order_date BETWEEN start AND end` (NOT shipped_at) |
| P&L COGS date | `shipped_at` (in inventory_cogs_allocations) |

**Key finding:** The FIFO engine does **NOT** filter layers by `received_at <= shipped_at`. This means stock received after a shipment date can still be used to fill that allocation. This is a deliberate design choice for retrospective batch COGS — it avoids "chronological stock" failures and is acceptable for this business model.

### 1.4 Bundle Explosion Logic

**Source:** `_allocateBundleOrderCOGS` (actions.ts line 82) + `applyCOGSForOrderShipped` (inventory-costing.ts line 499)

```
Bundle order (qty=N, sku=NEWONN003)
  → fetch components: NEWONN001 ×1, NEWONN002 ×1
  → component items_to_allocate:
       NEWONN001 qty = 1 × N
       NEWONN002 qty = 1 × N
  → per component: check idempotency, then allocate_cogs_fifo
  → result:
       all succeed → 'success'
       some succeed → 'partial'
       all fail    → 'failed' reason: 'ALLOCATION_FAILED: NEWONN001,NEWONN002'
```

Bundles are **exploded to components before allocation**. There are no receipt layers for bundle SKUs themselves — only for component SKUs.

### 1.5 qty_remaining — How It's Tracked

| Event | Effect on qty_remaining |
|-------|------------------------|
| Opening balance recorded | `qty_remaining = qty_received` (set on insert) |
| FIFO allocation succeeds | `qty_remaining -= allocated_qty` |
| ADJUST_OUT adjustment | `qty_remaining -= drained_qty` (FIFO drain) |
| Return reversal (FIFO) | `qty_remaining += reversed_qty` (restored to original layer) |
| Layer voided | `is_voided = true` (excluded from queries, qty_remaining unchanged) |

### 1.6 Reset/Rebuild Behavior (migration-086)

Reset is **safe and complete**:
1. DELETE all `inventory_cogs_allocations` (allocation rows)
2. DELETE all `inventory_cost_snapshots` (AVG method snapshots)
3. UPDATE `inventory_receipt_layers SET qty_remaining = qty_received` (restore all layers)
4. Replay ADJUST_OUT adjustments in FIFO order (re-drain from adjustments only)
5. Mark stale `running` cogs_allocation_runs as `failed`

**After migration-086:** `qty_remaining` is correctly restored. No manual layer-state repair needed if migration-086 has been applied.

---

## 2. Root Cause Categories of ALLOCATION_FAILED

### Category 1: DATA ISSUE (Insufficient Stock)
**What happens:** `allocate_cogs_fifo` exhausts all receipt layers but still needs `v_remaining > 0` → RAISES EXCEPTION → TypeScript gets RPC error → returns `false` → ALLOCATION_FAILED

**Triggers:**
- Total demand for a component SKU > total qty_received in receipt layers
- Opening balance not entered (zero receipt layers = instant fail)
- Purchase receipt entered with wrong quantity

**How to confirm:** Run Section 3 of `cogs-recovery-validation.sql` — if `total_received < cogs_allocated_qty` for a SKU, this is the cause.

**For NEWONN001/NEWONN002 specifically:** Expected demand after migration-087 was NEWONN001: 7222 units (5480 direct + 1742 from bundles), NEWONN002: 2502 units (982 direct + 1520 from bundles). If receipt layers don't cover these totals → data gap.

### Category 2: BUNDLE RECIPE ISSUE
**What happens:** Order has bundle SKU but:
- SKU is NOT in `inventory_items WHERE is_bundle=true` → treated as direct SKU → `allocate_cogs_fifo` called with bundle SKU → no receipt layers for bundle → fails
- SKU IS in inventory_items (is_bundle=true) but has NO rows in `inventory_bundle_components` → `_allocateBundleOrderCOGS` returns `{status:'failed', reason:'NO_BUNDLE_RECIPE'}`

**Status:** Fixed by migration-087 for known bundles (#0007, NEWONN003, #0008, #0080, NEWONN011). Any **new bundle SKUs** added after migration-087 still need registration.

**How to verify:** Check `bundleSkuSet` pre-fetch at run time in COGS run logs, or query:
```sql
SELECT DISTINCT so.seller_sku 
FROM sales_orders so
WHERE so.shipped_at IS NOT NULL 
  AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.sku_internal = so.seller_sku AND ii.is_bundle = true)
  AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.sku_internal = so.seller_sku AND ii.is_bundle = false)
```

### Category 3: STATE REBUILD ISSUE (Historical — Fixed)
**What happened:** Before migration-086, resetting allocations (DELETE from inventory_cogs_allocations) did NOT restore `qty_remaining` on receipt layers. Layers stayed at the post-allocation low value, causing subsequent runs to see zero available stock.

**Status:** Fixed by migration-086. If migration-086 has been applied, this is no longer a cause.

**How to verify:** After a reset, check `qty_remaining = qty_received` on receipt layers before running Apply COGS.

### Category 4: ENGINE BUG (Historical — Fixed)
**What happened:** Migration-068 introduced a hardened ownership guard:
```sql
WHERE order_id = p_order_id  -- BUG: comparing varchar(TikTok ID) vs UUID
```
This always returned NOT EXISTS → `RAISE EXCEPTION 'forbidden: order not owned by caller'` → **100% of allocations failed**.

**Status:** Fixed by migration-083 (changed to `WHERE id = p_order_id`).

**Impact window:** Any COGS run between migration-068 and migration-083 applied created zero allocations. Those runs would all show ALLOCATION_FAILED for every order.

### Category 5: TIMELINE ISSUE (Design Choice — Not a Bug)
**What happens:** The batch query filters by `order_date`, not `shipped_at`. Orders processed in `order_date ASC` order, but `shipped_at` (which drives P&L date) can differ.

**Impact:**
- Cross-month orders (ordered in Jan, shipped in Feb) are processed in the Jan run but their allocation's `shipped_at` timestamps show Feb → Feb P&L
- Not a ALLOCATION_FAILED cause, but a P&L date classification issue for cross-month orders

**Status:** Acceptable for this business model. No code change needed unless strict shipped-month P&L is required.

### Category 6: PARTIAL RUN / CHUNKING
**What happens:** Run times out after 50s → marked `failed` with `offset_completed: X`. Next invocation resumes from offset X (not offset 0).

**DOES THIS CAUSE FALSE ALLOCATION_FAILED?** No:
- Non-bundle orders: pre-checked via `allocatedOrderIds` set — already-allocated orders are skipped correctly
- Bundle orders: `_allocateBundleOrderCOGS` checks idempotency per-component — safe to re-run

**Not a root cause** of false failures. Resumption works correctly.

---

## 3. Logic Correctness Assessment

| Component | Status | Evidence |
|-----------|--------|---------|
| FIFO layer consumption (oldest first) | ✅ CORRECT | migration-083 line 74: `ORDER BY received_at ASC FOR UPDATE` |
| Atomic INSERT + UPDATE per allocation | ✅ CORRECT | Both in same `plpgsql` function = same transaction |
| Bundle explosion (bundle → components) | ✅ CORRECT | `_allocateBundleOrderCOGS` line 96: `qty: c.quantity * qty` |
| Idempotency (same order, same SKU) | ✅ CORRECT | Both RPC and TypeScript have idempotency guards |
| Per-component idempotency for bundles | ✅ CORRECT | `alreadyDone` Set checked per component |
| Reset restoring qty_remaining | ✅ CORRECT | migration-086 step 4: `SET qty_remaining = qty_received` |
| ADJUST_OUT replay after reset | ✅ CORRECT | migration-086 step 5 replays in FIFO order |
| Ownership guard in RPC | ✅ CORRECT (after migration-083) | `WHERE id = p_order_id` (not `order_id`) |
| No temporal filter on layers (received_at vs shipped_at) | ⚠️ INTENTIONAL | Design choice for retrospective batch — acceptable |
| Batch query uses order_date (not shipped_at) | ⚠️ KNOWN TRADE-OFF | Cross-month orders may show in unexpected P&L month |

**CONCLUSION: The engine is CORRECT after migrations 083, 086, 087.**

Remaining ALLOCATION_FAILED cases are most likely **Category 1 (Data: insufficient stock)** or **Category 2 (new bundle SKUs without recipes)**.

---

## 4. Specific Analysis: NEWONN001 / NEWONN002 Failures

**Scenario:** `ALLOCATION_FAILED: NEWONN001, NEWONN002` on NEWONN003 bundle orders

**Trace:**
1. NEWONN003 order → `_allocateBundleOrderCOGS` → explode to NEWONN001 ×1 + NEWONN002 ×1
2. `_allocateRPC('allocate_cogs_fifo', ..., 'NEWONN001', qty, ...)` → scans NEWONN001 receipt layers
3. If layers exhausted → `insufficient_stock` → returns `false` → NEWONN001 added to `failedComponents`
4. Same for NEWONN002

**Possible causes:**
- A. Total NEWONN001 demand > total NEWONN001 stock received
- B. Migration-087 was not applied (bundle not registered) — but symptom would be different
- C. Migration-086 was not run after a previous reset, so layers are still at drained state

**To diagnose definitively:** Run this query in Supabase SQL Editor:
```sql
SELECT
  'NEWONN001' AS sku,
  SUM(qty_received)  AS total_received,
  SUM(qty_remaining) AS current_remaining,
  (SELECT COALESCE(SUM(qty),0) FROM inventory_cogs_allocations WHERE sku_internal='NEWONN001' AND is_reversal=false) AS allocated
UNION ALL
SELECT
  'NEWONN002',
  SUM(qty_received),
  SUM(qty_remaining),
  (SELECT COALESCE(SUM(qty),0) FROM inventory_cogs_allocations WHERE sku_internal='NEWONN002' AND is_reversal=false)
FROM inventory_receipt_layers
WHERE sku_internal IN ('NEWONN001', 'NEWONN002') AND is_voided=false;
```

If `total_received < allocated + remaining_demand` → genuine stock data gap.

---

## 5. Recommendations

### 5.1 Must Fix — No Code Change Needed
- **Verify migration-086 was applied AND ran successfully** (check backup tables existence + post-reset audit output)
- **Verify migration-087 was applied** (run the SELECT in migration-087 step 3 to confirm bundle recipes exist)
- **After confirming:** run "Apply COGS (MTD)" with full date range. Remaining failures will be genuine stock data gaps.

### 5.2 Must Fix — Data Entry
- For every NEWONN001/NEWONN002 failure: verify actual receipt layers sum covers total demand
- Use the diagnostic query in Section 4 above
- If receipts are genuinely missing: add opening balance or stock-in records for the missing quantity

### 5.3 Should Add — New Bundle Registration Workflow
- Currently adding a new bundle SKU requires manual migration-style SQL
- Consider adding a UI warning in BundlesTab if a bundle has `components_summary = '-'` (no recipe defined)
- No architectural change needed — just surface the gap visually

### 5.4 Should Add — Bundle Stock Visibility (See Section 6)
- `getBundleOnHand()` server action already exists (actions.ts line 2067) with correct logic
- BundlesTab.tsx does NOT call it
- Fix: import and call `getBundleOnHand()` in BundlesTab → add columns to table

### 5.5 No Code Change Needed
- Reset flow: migration-086 is correct and complete
- FIFO temporal filtering: intentional design, acceptable for batch COGS
- Chunking / resumption: works correctly
- Engine correctness: confirmed correct after migration-083

---

## 6. Bundle Stock Visibility — Implementation

### 6.1 What Was Found
`getBundleOnHand()` at `actions.ts:2067` implements **exactly** the requested formula:
```
max_sellable = MIN(floor(component_on_hand / required_qty_per_bundle))
```
It returns per-bundle: `{ available_sets, limiting_component, components[] }`.

**The action is NOT imported or called in BundlesTab.tsx.**

### 6.2 Fix Applied (see BundlesTab.tsx)
- Import `getBundleOnHand` and `BundleOnHandInfo` in BundlesTab
- Call in `loadData()` (alongside existing `getBundles()`)
- Add three new columns to the bundle table:
  - **Max Sellable** (green number or orange warning)
  - **Limiting SKU** (which component is the bottleneck)
  - **Components Stock** (compact `SKU: on_hand / needed` display)

### 6.3 Formula Verification
For NEWONN003 (NEWONN001 ×1, NEWONN002 ×1):
```
max_sellable = MIN(
  floor(NEWONN001.qty_remaining / 1),
  floor(NEWONN002.qty_remaining / 1)
)
```
Limiting component = whichever has fewer `possible_sets`.

---

## 7. What Is Proven True
1. FIFO engine correctly consumes oldest layers first in an atomic transaction
2. Bundle orders are correctly exploded to component allocations
3. Idempotency works correctly at both order and component level
4. Reset (migration-086) correctly restores qty_remaining
5. Bundle recipe registration (migration-087) fixed the historical "treated as direct SKU" failure
6. Ownership guard bug (migration-068) was fixed by migration-083
7. `getBundleOnHand()` with correct max_sellable formula already exists in actions.ts

## 8. What Is Proven False
1. "Layer state doesn't restore on reset" — FALSE after migration-086
2. "Engine treats bundle as direct SKU" — FALSE after migration-087 (for registered bundles)
3. "Ownership guard always blocks allocation" — FALSE after migration-083

## 9. What Remains Uncertain
1. Whether total receipt layers (sum of qty_received) for NEWONN001/NEWONN002 cover total historical demand — **requires running the diagnostic query in Section 4 against live DB**
2. Whether any bundle SKUs ordered since migration-087 have not been registered — **requires checking ALLOCATION_FAILED entries in recent run history**
3. Whether migration-086 was actually applied and its backup tables exist — **check in Supabase SQL Editor: `SELECT * FROM pg_tables WHERE tablename LIKE 'backup_%'`**
