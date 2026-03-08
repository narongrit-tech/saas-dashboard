# Mobile Command Center

Status: Planned

---

# Overview

The Mobile Command Center is a NEW mobile-first operational layer.

It is NOT a replacement for desktop pages.
It is NOT a duplicate of existing analytics pages.

It provides mobile users with a focused operator console:
- today's key metrics at a glance
- fast access to import and operational tasks
- job and processing status visibility

Desktop pages remain unchanged.
Mobile pages reuse existing server actions and data services.
No duplicate business logic.

---

# Architecture Principle

Desktop → Full analytics + management UI
Mobile Command Center → Operator shortcuts + status monitoring

Routes will be under:

/mobile/home
/mobile/import
/mobile/jobs

These are additional routes, not replacements.

---

# Page 1 — Mobile Home

Route: /mobile/home

Purpose:
Today's key performance summary for quick mobile consumption.

Content:

## Today Summary

- Today's GMV (from fetchGMVByDay, today range)
- Today's Ad Spend (from wallet_ledger ADS wallets)
- Today's Net P&L (GMV - AdSpend - COGS estimate)
- Today's Orders count

Layout:
- grid grid-cols-2 gap-3 (same as shared KPI card rule)
- Large readable numbers
- Color coded (green = positive, red = negative)

## Shortcuts

Quick navigation buttons to:
- /mobile/import (Import Center)
- /mobile/jobs (Job Monitor)
- /quick-actions (existing Quick Actions page)
- /ads (Ads Performance analytics)
- /sales (Sales Orders)

Layout:
- Large tappable buttons
- Icon + label
- 2-column or single column

## Notes

- Data fetched server-side (reuse existing server actions)
- No new DB queries — reuse getPerformanceDashboard() or equivalent
- Bangkok timezone (same as all pages)
- export const dynamic = 'force-dynamic'

---

# Page 2 — Mobile Import Center

Route: /mobile/import

Purpose:
Central place to trigger all imports from mobile without hunting through pages.

Content:

## Import Sections

### TikTok
- Import TikTok Orders (.xlsx)
- Import TikTok Ads (.xlsx)
- Import TikTok Finance / Cashflow (.xlsx)

### Affiliate
- Import Affiliate Orders (.xlsx)

### Shopee
- Import Shopee Orders (.csv)
- Import Shopee Wallet (.csv)
- Import Shopee Settlement (.csv)

### Bank
- Import Bank Statement (.csv)

Layout:
- Grouped sections with section headings
- Each import = large tappable button with icon + label
- Reuse existing ImportDialog components (render in sheet/drawer for mobile)

## Notes

- All import dialogs already exist — this page just renders them in a mobile-friendly context
- No new import logic
- No new server actions
- Just UI wiring of existing dialog components

---

# Page 3 — Mobile Jobs / Task Monitor

Route: /mobile/jobs

Purpose:
Monitor background processing status without going to desktop.

Content:

## COGS Allocation Status

- List of recent cogs_allocation_runs (reuse listNotifications or getCogsRun)
- Status: Running / Completed / Failed
- Link to run detail page (/inventory/cogs-runs/[id])

## Import Processing Status

- Recent import_batches (last 10)
- Marketplace + report type
- Status: processing / completed / failed / partial
- Row count + error count

## Quick Actions

- Button: Apply COGS (MTD) → opens ApplyCOGSMTDModal
- Button: Fix Missing SKU → opens FixMissingSkuDialog

## Notes

- Reuse existing server actions: listNotifications, getCogsRun, etc.
- Reuse existing modal components
- No new backend logic

---

# Implementation Notes

## What to Reuse

| Feature | Reuse From |
|---|---|
| Today GMV | getPerformanceDashboard() or fetchGMVByDay() |
| Today Ad Spend | wallet_ledger query (same as dashboard) |
| Import Dialogs | existing ImportDialog components |
| COGS Run list | cogs-run-actions.ts → getCogsRun / listNotifications |
| Import batch list | import_batches table query |

## What Is New

- /mobile/home page (layout + data stitching)
- /mobile/import page (layout only — wires existing dialogs)
- /mobile/jobs page (layout + reuse existing actions)

## What Is NOT Changed

- All existing desktop pages
- All business logic
- All server actions
- All analytics calculations
- All timezone handling

---

# Design Rules

Follow all rules from docs/ui-mobile/00-shared-rules.md:

- Large tap targets (minimum 44px)
- Compact text sizes
- 2-column KPI grid
- Loading states on all interactive elements
- No horizontal overflow

---

# Status

Planned — spec only.
No implementation yet.
Implementation should begin after core analytics pages are mobile-optimized.

Next steps:
1. Implement /mobile/home
2. Implement /mobile/import
3. Implement /mobile/jobs
4. Add Mobile Command Center link to sidebar (mobile only, hidden lg:hidden)
