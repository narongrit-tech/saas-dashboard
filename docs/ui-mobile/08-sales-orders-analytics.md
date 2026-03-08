# Sales Orders Analytics Layer

Status: Completed

Date: 2026-03-08

Changes implemented:
- New server action `getSalesPlatformBreakdown` in actions.ts (parallel query, same cohort logic as getSalesGMVSummary, adds source_platform grouping)
- New component `SalesPlatformAnalytics.tsx` — Platform Distribution (donut + horizontal bars on desktop, compact cards with progress bars on mobile) + Leakage by Platform (orange bars on desktop, orange cards on mobile)
- SalesPageClient.tsx wired: new state `platformBreakdown/platformBreakdownLoading`, `fetchPlatformBreakdown()` with race guard, component inserted between GMV Cards and filters
- Page order now: KPI cards → Platform Distribution → Leakage by Platform → Filters → SKU Outflow → Table
- No business logic changed

Route:
Dashboard → Sales Orders

Purpose:
Upgrade the Sales Orders page from a basic KPI + table screen into a real sales control panel.

Do NOT modify business logic.

---

# Goal

The Sales Orders page should immediately answer:

- which platform is driving most sales
- where leakage is coming from
- how created orders compare with fulfilled orders
- which platform needs attention

This page should feel like an operational analytics dashboard, not just a raw order table.

---

# Existing Page Structure

Current blocks:

- GMV (Orders Created)
- Fulfilled GMV
- Cancel / Leakage
- Filters
- Main SKU Outflow
- Orders Table

These should remain, but a new analytics layer should be added above filters.

---

# New Section: Platform Distribution

Add a new analytics block below the KPI cards and above Filters.

Section title:
Platform Distribution

Purpose:
Show sales contribution by platform.

Use data grouped by platform such as:

TikTok
Shopee
Other / Unknown

If more marketplaces exist, include them.

---

# Desktop Layout

Desktop should show two complementary views:

## View A — GMV Share by Platform

Preferred chart:
Donut chart

Display:
- platform name
- GMV amount
- percentage share

Example:

TikTok   ฿110,000   72%
Shopee   ฿40,000    21%
Other    ฿8,000      7%

## View B — Orders Share by Platform

Preferred chart:
Horizontal bar chart

Display:
- platform name
- orders count
- percentage share

Example:

TikTok   480 orders
Shopee   120 orders
Other     26 orders

Desktop layout:
Use 2-column layout if space allows:

left = donut chart
right = horizontal bars / summary list

---

# Mobile Layout

On mobile, avoid large charts.

Preferred mobile layout:

Use compact stacked cards with progress bars.

Example:

TikTok
Orders 480
GMV ฿110,000
72%

Shopee
Orders 120
GMV ฿40,000
21%

Other
Orders 26
GMV ฿8,000
7%

Use small horizontal progress bars to visualize share.

Avoid large donut charts on mobile unless they remain readable.

---

# New Section: Leakage by Platform

Add a second analytics block below Platform Distribution.

Section title:
Leakage by Platform

Purpose:
Show cancellation / leakage distribution by platform.

Display:
- platform
- leakage amount
- percent of platform created GMV if possible

Example:

TikTok   ฿15,000
Shopee   ฿5,000
Other    ฿1,000

Desktop:
horizontal bar chart or list with bars

Mobile:
stacked compact cards or progress rows

Use warning / orange styling.

---

# Optional Section: Order Flow by Platform

If data is already available without new backend work, add a small summary section:

Created Orders
Fulfilled Orders
Leakage

Grouped by platform.

Example:

TikTok
Created 500
Fulfilled 430
Leakage 70

Shopee
Created 126
Fulfilled 111
Leakage 15

Only implement if current page data or existing queries already support it easily.

Do NOT add new APIs just for this.

---

# Placement Rules

Final page order should become:

1. KPI cards
2. Platform Distribution
3. Leakage by Platform
4. Filters
5. Main SKU Outflow
6. Orders Table

Keep existing filters and tables below the analytics layer.

---

# Design Rules

## Desktop
- charts allowed
- summary rows allowed
- 2-column analytics layout allowed

## Mobile
- prioritize readability
- avoid oversized charts
- use cards + progress bars
- keep sections compact
- no horizontal scrolling for analytics blocks

---

# Existing KPI Cards

Keep existing KPI cards:

- GMV (Orders Created)
- Fulfilled GMV
- Cancel / Leakage

You may improve visual hierarchy, but do not change calculations.

---

# Data Rules

Do NOT change business logic.

Do NOT change:
- order aggregation logic
- created vs shipped logic
- cancellation logic
- platform classification logic
- affiliate logic
- COGS logic

Reuse existing data if available.
If a small derived calculation is needed in UI from already-fetched data, that is acceptable.
Do not introduce heavy backend changes.

---

# Mobile UX Notes

Sales Orders mobile should feel like a control panel.

Users should be able to quickly answer:

- which platform is strongest
- where leakage is highest
- whether performance is concentrated in one marketplace

without reading the raw table first.

---

# Done When

- Platform Distribution section exists
- Leakage by Platform section exists
- Desktop layout is analytical and readable
- Mobile layout is compact and readable
- Existing page logic remains unchanged
- Existing filters / SKU outflow / table remain in place