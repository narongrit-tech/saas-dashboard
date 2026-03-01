# QA Checklist — Analytics Builder (`/analytics/builder`)

> Feature: Phase 8 UI Improvement — Analytics Builder (Drag & Drop)
> Route: `/analytics/builder`
> Date: 2026-02-25

---

## Pre-conditions

- [ ] Migration `migration-073-analytics-presets.sql` has been applied to the target DB
- [ ] Dev server running: `cd frontend && npm run dev`
- [ ] Logged in as **User A** (primary test user)

---

## 1. Page Load & Navigation

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1.1 | Navigate to `/analytics/builder` | Page loads without error | |
| 1.2 | Sidebar shows "Analytics Builder" in Overview group with flask icon | Icon and label visible, correct href | |
| 1.3 | Active route highlights "Analytics Builder" in sidebar | Primary color highlight on active item | |
| 1.4 | Default date range = first day of current Bangkok month → today | Verify via browser (Bangkok timezone) | |

---

## 2. Metric Library (Drag & Drop)

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 2.1 | 6 metrics visible in left panel: Revenue, Advertising, COGS, Operating, Orders, Units | All 6 shown with `฿` or `#` indicator | |
| 2.2 | Drag "Revenue" chip to canvas drop zone | "Revenue" chip appears in canvas; library chip dims | |
| 2.3 | Drag same "Revenue" chip again (already added) | Not duplicated in canvas | |
| 2.4 | Drag all 6 metrics to canvas | All 6 appear; all library chips dim | |
| 2.5 | Click `×` on a canvas chip | Chip removed; library chip un-dims | |
| 2.6 | Drag chip within canvas to reorder | Chips swap positions correctly | |
| 2.7 | Click "Clear all" | Canvas empties; all library chips un-dim; expression cleared | |

---

## 3. Expression Editor

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 3.1 | Add `revenue`, `cogs`, `advertising` to canvas. Type `revenue - cogs - advertising` | "Expression is valid" green text appears | |
| 3.2 | Type invalid expression `revenue **` | Red error message shown; Run button disabled | |
| 3.3 | Type expression referencing metric not in canvas: `revenue - inventory` (inventory not added) | Error: "Unknown metric: 'inventory'" | |
| 3.4 | Empty expression field | No error shown; Run still available (raw metrics only) | |
| 3.5 | Expression `revenue / 0` (literal zero) | Parses as valid syntax (div/0 handled at runtime) | |
| 3.6 | Complex expression with parens: `(revenue - cogs) * 0.3` | Valid, computes correctly | |
| 3.7 | Set Computed Column Label to "Gross Profit" | Label appears as column header in result table | |

---

## 4. Date Range

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 4.1 | Set end date before start date | "Start must be before end" message; Run disabled | |
| 4.2 | Single-day range (start = end) | Runs successfully, returns 1 row | |
| 4.3 | Date range spanning Bangkok midnight (e.g., Jan 31 → Feb 01) | Both dates appear in results with correct data | |
| 4.4 | Orders placed at 23:59 Bangkok time are in correct day | Verify by cross-checking with existing P&L for same date | |

---

## 5. Run & Results

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 5.1 | Add metrics, set valid date range, click Run | Results table appears with rows + total row at bottom | |
| 5.2 | Empty data range (future dates with no data) | Table shows rows with all zeros; no crash | |
| 5.3 | Division by zero at runtime: expression `revenue / orders` on a day with 0 orders | That row shows "÷0" in muted text; other rows show value; no crash | |
| 5.4 | Revenue figures match Daily P&L for same date | Cross-check 2–3 sample dates | |
| 5.5 | Run button disabled while loading | Spinner/disabled state visible during fetch | |
| 5.6 | Total row sums correctly | Verify manually for 2–3 column values | |
| 5.7 | Currency columns use Thai locale formatting (e.g., 12,345.67) | Correct locale formatting in cells | |
| 5.8 | Orders/Units columns show integer (no decimals) | Count metrics show whole numbers | |

---

## 6. Export CSV

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 6.1 | Click "Export CSV" after a successful run | File downloads automatically | |
| 6.2 | Filename pattern: `analytics-builder-YYYYMMDD-HHmmss.csv` | Filename matches pattern (Bangkok time) | |
| 6.3 | Open CSV in Excel (Thai locale) | Thai characters display correctly (UTF-8 BOM applied) | |
| 6.4 | CSV values match on-screen result table | Spot-check 3 rows for each column | |
| 6.5 | CSV column headers match: Date, [metric names], [computed label] | Headers correct | |
| 6.6 | Division-by-zero row in CSV | Null computed exported as empty cell (not crash) | |

---

## 7. Preset CRUD

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 7.1 | Click "Save Preset" → type name "Test Preset" → Enter | Preset appears in list immediately | |
| 7.2 | Click "Save Preset" with empty name | Save button disabled / no action | |
| 7.3 | Click Load on a preset | Canvas metrics, expression, label, date range all restored | |
| 7.4 | After Load, results table clears (needs re-run) | Table empty until user clicks Run again | |
| 7.5 | Click pencil icon on preset → edit name → Enter | Name updates; list refreshes | |
| 7.6 | Click pencil → Escape | Rename cancelled, name unchanged | |
| 7.7 | Click trash icon on preset → Cancel | Preset not deleted | |
| 7.8 | Click trash icon → Delete | Preset removed from list | |
| 7.9 | `last_used_at` updates after Load | Preset shows "Last used: [date]" after loading | |
| 7.10 | Page refresh shows presets (fetched server-side) | Presets persist across page reload | |

---

## 8. Security — RLS Cross-User

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 8.1 | User A creates preset "A-Private" | Preset visible to User A | |
| 8.2 | Log in as User B | User B sees ZERO presets (cannot see User A's) | |
| 8.3 | User B creates preset "B-Private" | Visible only to User B | |
| 8.4 | Log back in as User A | Only "A-Private" visible; "B-Private" not shown | |
| 8.5 | User B's analytics data (revenue, etc.) is from User B's own orders | Totals differ from User A (if data differs) | |

---

## 9. No localStorage / No sessionStorage

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 9.1 | Open DevTools → Application → Local Storage | No analytics builder keys stored | |
| 9.2 | Open DevTools → Application → Session Storage | No analytics builder keys stored | |
| 9.3 | Close browser tab → reopen `/analytics/builder` | Canvas is empty (state not persisted client-side) | |

---

## 10. Bangkok Timezone

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 10.1 | Default end date = today in Bangkok, not UTC | If server is UTC+0, today Bangkok may differ; verify correct date | |
| 10.2 | Order placed at 23:30 UTC (= 06:30+07 next day Bangkok) | Bucketed to next Bangkok calendar day | |
| 10.3 | Export filename timestamp uses Bangkok time | Compare filename ts to Bangkok current time | |

---

## Sign-off

| Role | Name | Date | Sign |
|------|------|------|------|
| Developer | | | |
| QA | | | |

**All items must PASS before feature is merged.**
