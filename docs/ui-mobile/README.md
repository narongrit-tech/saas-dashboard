# SaaS Dashboard — Mobile UX Improvement Plan

This folder documents the mobile UX redesign and rollout plan for the SaaS Dashboard.

Goals:
- Mobile friendly
- Easier to navigate
- Cleaner for analytics consumption
- Consistent across all pages

This folder is used by AI agents (Claude Code) to understand:
- Current UX rules
- What has already been implemented
- What pages still need work

All future UI improvements must reference and update this documentation.

---

# Completed Pages

## Dashboard Performance

Status: Completed

Route: /

Changes:
- Preset-based date picker
- KPI cards optimized for mobile grid (grid-cols-2)
- Calendar modal layout improved
- Confirm / Cancel footer actions added

## Ads Performance

Status: Completed

Route: /ads

Spec: docs/ui-mobile/02-ads-performance.md

Changes:
- Import button hidden on mobile (hidden lg:flex)
- Compact header: "Ads Performance" + subtitle
- KPI cards: grid-cols-2 gap-3 on mobile
- Daily Rollup: card list on mobile, table on desktop
- Campaign Breakdown: stacked cards on mobile, table on desktop

## Quick Actions

Status: Completed

Route: /quick-actions

Spec: docs/ui-mobile/10-quick-actions.md

Purpose:
Mobile users use this page for all operational tasks (imports, manual entry).
Import buttons are hidden from analytics pages on mobile.

---

# Page Specs

All page specs live in this folder:

| File | Page | Status |
|---|---|---|
| 00-shared-rules.md | Shared UX rules (all pages) | Active |
| 02-ads-performance.md | Ads Performance | Completed |
| 03-cash-pnl.md | Cash P&L | Pending |
| 04-sales-orders.md | Sales Orders | Pending |
| 05-internal-affiliates.md | Internal Affiliates | Pending |
| 06-affiliate-performance-report.md | Affiliate Performance Report | Pending |
| 07-mobile-command-center.md | Mobile Command Center | Planned |
| 10-quick-actions.md | Quick Actions | Completed |

---

# Mobile Command Center (Planned)

The Mobile Command Center is a new mobile-first operational layer.

Routes: /mobile/home, /mobile/import, /mobile/jobs

It is NOT a replacement for desktop pages.
It provides mobile users with:
- today's key metrics
- fast access to all imports
- job and COGS processing status

See full spec: docs/ui-mobile/07-mobile-command-center.md

---

# Shared UX Rules

See: docs/ui-mobile/00-shared-rules.md

Key rules:
- Hide import buttons on mobile: `hidden lg:flex`
- Tables become card lists on mobile
- KPI cards: `grid grid-cols-2 gap-3`
- Compact page headers on mobile
- Desktop layout must remain unchanged

---

# Development Workflow

When improving a page, follow docs/ai-dev-workflow.md exactly:

1. Read docs/project-status.md
2. Read docs/ui-mobile/00-shared-rules.md
3. Read the relevant page spec
4. Create implementation plan
5. Apply UI improvements
6. Run: cd frontend && npx tsc --noEmit
7. Commit + push
8. Update the page spec (Status: Completed + changes list)
9. Update docs/project-status.md

---

# Important Rule

Every time a page is improved, update:
1. The page spec file — set Status: Completed, add Date and Changes implemented
2. docs/project-status.md — move page from Pending to Completed

This ensures future agents know what has been done and what still needs work.

---

# Pages Still Pending

- Cash P&L (/reports/cash-pl)
- Sales Orders (/sales)
- Internal Affiliates (/affiliates)
- Affiliate Performance Report
- Expenses (/expenses)
- Wallets (/wallets)
- Bank (/bank)
- Bank Reconciliation (/bank-reconciliation)
- Company Cashflow (/company-cashflow)
