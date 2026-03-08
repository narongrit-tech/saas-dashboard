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

### Sales Orders
Route: /sales
Spec: docs/ui-mobile/04-sales-orders.md
Changes:
- Compact header (text-xl sm:text-2xl)
- GMV KPI cards: grid-cols-2 on mobile (GMVCards component)
- Import TikTok + Import Shopee buttons: hidden on mobile (hidden lg:flex)
- SKU Outflow: 2-col card grid on mobile, table on desktop
- Orders table: mobile card list (order view), table on desktop

### Internal Affiliates
Route: /affiliates
Spec: docs/ui-mobile/05-internal-affiliates.md
Changes:
- Compact header (text-xl sm:text-2xl)
- Add Affiliate button: full width on mobile, inline on desktop
- Search bar: full width, sticky (sticky top-0 z-10)
- Affiliate rows: card list on mobile, table on desktop
- Active toggle still interactive on mobile

### Expenses
Route: /expenses
Spec: (no separate spec)
Changes:
- Compact header (text-xl sm:text-2xl)
- Download Template + Import buttons: hidden on mobile (hidden lg:flex)
- Expense rows: card list on mobile (date, category badge, amount, actions), table on desktop

### Wallets
Route: /wallets
Spec: (no separate spec)
Changes:
- Compact header (text-xl sm:text-2xl)
- Import Performance Ads, Import Awareness Ads, Import Shopee Wallet: hidden on mobile
- Ledger entries: card list on mobile (type, direction, amount, note), table on desktop

### Company Cashflow
Route: /company-cashflow
Spec: (no separate spec)
Changes:
- Compact header (text-xl sm:text-2xl)
- KPI cards: grid-cols-2 on mobile, sm:grid-cols-3 on desktop
- Net Cashflow card: col-span-2 on mobile (full width, prominent)
- Daily Cashflow: card list on mobile, table on desktop

### Bank Statement
Route: /bank
Spec: (no separate spec)
Changes:
- Compact header (text-xl sm:text-2xl)

### Bank Reconciliation
Route: /bank-reconciliation
Spec: (no separate spec)
Changes:
- Compact header (text-xl sm:text-2xl)
- Removed container padding wrapper

---

### Affiliate Performance Report
Route: /reports/affiliate
Spec: docs/ui-mobile/06-affiliate-performance-report.md
Changes:
- Compact header (text-xl sm:text-2xl)
- Filters: inline DateRangePicker (no Card wrapper)
- KPI cards: grid-cols-2 on mobile, md:grid-cols-4 on desktop
- Charts: responsive height, donut labels hidden on mobile
- Internal Affiliates: card list on mobile, table on desktop
- External Top 10: card list on mobile, table on desktop

---

## Pending

(none — all pages completed)

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

Mobile Command Center (/mobile/home, /mobile/import, /mobile/jobs)
Spec: docs/ui-mobile/07-mobile-command-center.md

---

## Reference

- Shared UX rules: docs/ui-mobile/00-shared-rules.md
- Development workflow: docs/ai-dev-workflow.md
- Page specs: docs/ui-mobile/
