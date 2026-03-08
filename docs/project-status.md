# Project Status

Mobile UX Improvement Progress

Last updated: 2026-03-08

---

## Completed

### Dashboard Performance
Route: /
Spec: (no separate spec — embedded in README history)
Changes:
- Preset-based date picker
- KPI cards optimized for mobile grid
- Calendar modal layout improved
- Confirm / Cancel footer actions added

### Ads Performance
Route: /ads
Spec: docs/ui-mobile/02-ads-performance.md
Changes:
- Import button hidden on mobile
- Header changed to "Ads Performance" with subtitle
- KPI cards: grid-cols-2 on mobile
- Daily Rollup: card list on mobile, table on desktop
- Campaign Breakdown: stacked cards on mobile, table on desktop

### Quick Actions
Route: /quick-actions
Spec: docs/ui-mobile/10-quick-actions.md
Changes:
- Dedicated mobile page for operational tasks
- Import buttons moved here from analytics pages
- Large tappable buttons
- Sections: Imports, Manual Entry

### Cash P&L
Route: /reports/cash-pl
Spec: docs/ui-mobile/03-cash-pnl.md
Changes:
- Compact header (text-xl sm:text-2xl)
- KPI cards: grid-cols-2 on mobile, md:grid-cols-3 on desktop
- Net Cash Change: full width on mobile (col-span-2), prominent
- Daily Cash Movement: card list on mobile, table on desktop

---

## Pending

### Sales Orders
Route: /sales
Spec: docs/ui-mobile/04-sales-orders.md
Required:
- compact header
- filters grouped into mobile sheet
- import buttons hidden on mobile
- orders table becomes card list on mobile
- SKU Outflow becomes cards on mobile

### Internal Affiliates
Route: /affiliates
Spec: docs/ui-mobile/05-internal-affiliates.md
Required:
- compact header
- Add Affiliate button full width on mobile
- search full width and sticky
- affiliate rows become cards on mobile

### Affiliate Performance Report
Route: /affiliates (report tab or sub-route)
Spec: docs/ui-mobile/06-affiliate-performance-report.md
Required:
- compact header
- KPI cards responsive
- charts sized for mobile
- performance tables become cards on mobile

### Expenses Page
Route: /expenses
Spec: (pending — not yet created)

### Wallets Page
Route: /wallets
Spec: (pending — not yet created)

### Bank Page
Route: /bank
Spec: (pending — not yet created)

### Bank Reconciliation
Route: /bank-reconciliation
Spec: (pending — not yet created)

### Company Cashflow
Route: /company-cashflow
Spec: (pending — not yet created)

---

## Planned

### Mobile Command Center
Routes: /mobile/home, /mobile/import, /mobile/jobs
Spec: docs/ui-mobile/07-mobile-command-center.md
Purpose:
- mobile-first operator console
- today summary, import shortcuts, job monitor
- reuses existing server actions and components
- does NOT replace desktop pages
- no new business logic

---

## Next Page To Improve

Sales Orders — /sales
Spec ready at: docs/ui-mobile/04-sales-orders.md

---

## Reference

- Shared UX rules: docs/ui-mobile/00-shared-rules.md
- Development workflow: docs/ai-dev-workflow.md
- Page specs: docs/ui-mobile/
