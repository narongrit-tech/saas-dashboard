# Sales Orders Page

Status: Pending

Route: /sales

---

# Goal

Improve mobile UX for the Sales Orders page.

Focus:
- compact header
- readable KPI summary cards
- filters usable on small screens
- large order table converts to card list on mobile
- operational/import buttons hidden on mobile
- SKU Outflow section becomes cards on mobile

---

# Current Issues

1. Page header is large and pushes content down on mobile
2. KPI summary cards may not use 2-column mobile grid
3. Filter bar (date, marketplace, status) is too wide for phones
4. Display options popover is hard to use on mobile
5. Import buttons (TikTok, Shopee) visible on mobile — should be hidden
6. Orders table overflows horizontally on phones
7. SKU Outflow table overflows on mobile

---

# Required Changes

## Compact Header

Mobile:
- text-xl font-bold
- sm:text-2xl on desktop

---

## KPI Summary Cards

Mobile layout:

grid grid-cols-2 gap-3

Desktop layout:

md:grid-cols-4 or md:grid-cols-3 (match existing)

---

## Filters — Mobile Sheet

On desktop: keep inline filter bar.

On mobile: group filters into a sheet or drawer.

Trigger: a "Filters" button that opens a bottom sheet.

Sheet contains:
- Date range picker
- Marketplace selector
- Status selector
- Any other existing filters

---

## Display Options

Keep existing display options popover.

On mobile: ensure popover is scrollable and does not overflow viewport.

---

## Hide Import Buttons On Mobile

Buttons to hide:
- Import TikTok
- Import Shopee
- Any other import buttons

Implementation:

className="hidden lg:flex"

Users should use /quick-actions for imports on mobile.

---

## Orders Table → Card List on Mobile

Desktop:
Keep existing table.

Mobile:
Show card list.

Example card:

Order #TK12345678
2 Mar · TikTok · Completed

GMV       ฿1,240
Items     3
Affiliate -

Implementation:
- hidden sm:block for table wrapper
- sm:hidden for card list

---

## SKU Outflow Table → Cards on Mobile

Desktop:
Keep existing table.

Mobile:
Convert to cards.

Example card:

SKU: PROD-001
Qty Sold    120
GMV         ฿48,000

---

# Do Not Change

- GMV calculation logic
- Order grouping and dedup logic
- SKU allocation logic
- Date range and timezone logic
- Import parsing logic

---

# Done When

- Import buttons hidden on mobile
- Header compact on mobile
- KPI cards in 2-column grid on mobile
- Filters accessible via sheet on mobile
- Orders table shows as card list on mobile
- SKU Outflow shows as cards on mobile
- Desktop layout unchanged
