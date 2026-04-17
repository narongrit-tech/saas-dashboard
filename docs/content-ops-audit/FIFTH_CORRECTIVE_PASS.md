# Fifth Corrective Pass

## Current State After Pass

The Cost → Profit layer is now fully wired for operator use:

- `runMasterRefresh()` is triggered directly from the pipeline overview page — no navigation required
- `tt_content_costs` cost date defaults to Bangkok time, not UTC
- The profit page surfaces a clear banner when summary rows exist but all costs are zero
- The profit empty state explains the correct flow: add costs → run refresh

The DB schema, allocation engine, and profit refresh RPC were already complete.
This pass closes the UI and truthfulness gaps that prevented the layer from being
decision-usable.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/refresh-buttons.tsx` | **New file.** Client component `MasterRefreshButton` — calls `runMasterRefresh()`, shows inline result (products_upserted, shops_upserted) or error. |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/page.tsx` | Imports `MasterRefreshButton`, adds it to the quick-actions bar. `flex-wrap items-start` added so button result text renders inline below the button without pushing other buttons. |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/costs/page.tsx` | Fixed `today()`: was `new Date().toISOString().slice(0,10)` (UTC), now shifts by +7h before slicing (Bangkok). |
| `frontend/src/app/(dashboard)/content-ops/tiktok-affiliate/profit/page.tsx` | Added `noCostData` flag (`rows.length > 0 && totals.total_cost === 0`). Added amber banner when `noCostData` is true: "No cost data — profit equals commission only" with link to costs page. Improved empty-state message to explain the add-costs-first flow. Added `Link` and `Info` imports. |

---

## What Was Activated

### 1. `runMasterRefresh` wired to overview page

The `MasterRefreshButton` client component:
- Calls `runMasterRefresh()` on click
- Shows result inline: `"Registry refreshed: N products, N shops"`
- Shows error inline if the RPC fails
- Uses `useTransition` — no full-page reload

This closes the HIGH-priority gap from Pass 3 (`runMasterRefresh()` existed but had no UI trigger).

### 2. Bangkok date default in cost input

**Before:** `today()` returned `new Date().toISOString().slice(0, 10)`, which is the UTC date.
At 11 PM UTC (6 AM Bangkok next day), operators would get the wrong date pre-filled.

**After:**
```typescript
function today(): string {
  const now = new Date()
  const bangkokDate = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return bangkokDate.toISOString().slice(0, 10)
}
```

This matches the server-side Bangkok convention used everywhere in the project.

### 3. Profit page no-cost-data truthfulness

**The gap:** When `refresh_content_profit_attribution_summary` runs without any cost data, it
produces summary rows with `total_cost = 0` and `profit = commission_realized`. This is
technically correct (profit = commission − 0) but visually indistinguishable from a
state where real costs have been entered and netted out. The only indication was a
subtitle "no cost data" on the Net profit KPI card.

**After:** A persistent amber banner appears whenever `rows.length > 0 && totals.total_cost === 0`:

```
ℹ️ No cost data — profit equals commission only
All rows show total_cost = 0. Add costs and run a refresh to compute real profit.
[Add costs →]
```

This prevents misreading the profit table as final P&L when costs are missing.

### 4. Profit empty-state guidance

**Before:** "Run a refresh to compute profit from attribution and costs. Make sure facts are loaded first."
**After:** "To get meaningful profit: (1) add costs, (2) run refresh. Without cost data, profit will equal commission only."

Operator now has an explicit ordered flow rather than a generic instruction.

---

## What Still Remains

### Operator tasks (not code)
1. **Enter real cost data** — `tt_content_costs` is still empty. Profit is not
   meaningful until costs are inserted via `/content-ops/tiktok-affiliate/costs`.
2. **Run profit refresh** — after entering costs, navigate to Profit → Run refresh.
3. **Full QA loop** — smoke test all 8 verification checks on Vercel.

### Low-priority code gaps
4. **Product/shop registry page** — `getProductMaster()` / `getShopMaster()` read from
   correct tables but no page surfaces the full registry view.
5. **Attribution view performance** — monitor, no preemptive action needed.

---

## Verification

```
npx tsc --noEmit  →  0 errors
```
