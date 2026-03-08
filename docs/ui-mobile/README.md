# SaaS Dashboard — Mobile UX Improvement Plan

This folder documents the **mobile UX redesign and rollout plan** for the SaaS Dashboard.

The goal is to make the system:

* Mobile friendly
* Easier to navigate
* Cleaner for analytics consumption
* Consistent across all pages

This folder is also used by AI agents (Claude Code / Codex) to understand:

* Current UX rules
* What has already been implemented
* What pages still need work

All future UI improvements should reference and update this documentation.

---

# Current Progress

## Dashboard Performance Page

Status: Completed

Changes implemented:

* Added preset-based Date Picker
* Preset dropdown appears first
* Custom date selector opens calendar
* Improved mobile spacing
* KPI cards optimized for mobile grid
* Calendar modal layout improved
* Confirm / Cancel footer actions added

Date picker behavior:

Preset → choose range quickly
Custom → open calendar selector

---

## Quick Actions Page

Status: Completed

Route created:

/quick-actions

Purpose:

Mobile users should not see import buttons everywhere.
Instead they use **Quick Actions page** for operational tasks.

Example actions:

* Import Ads Data
* Import Orders
* Import Expenses
* Import Bank Statement
* Add Expense
* Add Wallet Transaction

Design goals:

* Mobile friendly
* Large buttons
* Easy to tap
* Operational tasks separated from analytics pages

---

# Shared UX Rules

See:

docs/ui-mobile/00-shared-rules.md

These rules apply to all dashboard pages.

Important examples:

* Hide import buttons on mobile
* Tables convert to cards on small screens
* Desktop layout remains unchanged
* Mobile pages prioritize readability

---

# Pages In Scope

Planned mobile UX improvements:

* Dashboard Performance
* Ads Performance
* Sales Orders
* Expenses
* Wallets
* Company Cashflow
* Bank
* Bank Reconciliation
* Profit Reports

---

# Development Workflow

When improving a page:

1. Read shared rules:

docs/ui-mobile/00-shared-rules.md

2. Read the page spec.

Example:

docs/ui-mobile/02-ads-performance.md

3. Implement UX improvements.

4. Do NOT change:

* business logic
* database queries
* analytics calculations

5. After implementation:

Update the spec file with:

Status: Completed
Date:
Changes implemented:

---

# Important Rule

Every time a page is improved, update this documentation.

This ensures future agents understand:

* what has been implemented
* what still needs work
* UX consistency rules

---

# Future Work

Remaining pages to optimize:

* Ads Performance
* Sales
* Expenses
* Wallets
* Bank
* Cashflow
* Profit Reports
