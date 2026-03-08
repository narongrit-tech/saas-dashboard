# Ads Performance Page

Status: Completed
Date: 2026-03-08

Changes implemented:

* Import Ads Data button hidden on mobile (hidden lg:flex)
* Header changed to "Ads Performance" with subtitle "Product GMV Max + Live GMV Max analytics"
* Header spacing reduced (text-xl → sm:text-2xl, space-y-4)
* KPI cards: grid-cols-2 gap-3 on mobile, md:grid-cols-4 on desktop
* Daily Rollup: table hidden on mobile; card list (2-col grid per row) shown on mobile
* Campaign Breakdown: table hidden on mobile; stacked cards shown on mobile
* Desktop layout unchanged

---

# Goal

Improve mobile UX for the Ads Performance analytics page.

Focus:

* better readability
* cleaner layout
* mobile friendly data display

---

# Current Issues

1. Import Ads button still visible on mobile
2. Page header spacing is too large
3. Daily Rollup table is too wide for phones
4. Campaign Breakdown table is difficult to read on small screens

---

# Required Changes

## Hide Import Button On Mobile

The button:

Import Ads Data (.xlsx)

Should be visible only on desktop.

Implementation example:

className="hidden lg:flex"

---

## Improve Header Layout

Current:

Ads Performance Overview

Change to:

Ads Performance

Subtitle:

Product GMV Max + Live GMV Max analytics

Reduce vertical spacing.

---

## KPI Cards Layout

Cards:

Spend
GMV
Orders
ROAS

Mobile layout:

grid grid-cols-2 gap-3

---

## Daily Rollup Mobile Layout

Desktop:

Keep table.

Mobile:

Convert to card layout.

Example:

28 Feb

Spend  ฿1,520
Orders 53
GMV    ฿13,504
ROAS   8.88

---

## Campaign Breakdown Mobile Layout

Desktop:

Keep table.

Mobile:

Convert rows to stacked cards.

Example:

Date
28 Feb

Campaign Type
Product

Campaign Name
23022026 ALL

Spend
฿1,520

---

# Do Not Change

Do not modify:

* Ads calculations
* Data queries
* Date filtering logic
* Campaign grouping logic

---

# Done When

* Import button hidden on mobile
* Tables become cards on mobile
* Page spacing improved
* Desktop layout remains unchanged
