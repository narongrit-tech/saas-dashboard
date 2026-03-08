# Cash P&L Page

Status: Pending

Route: /reports/cash-pl

---

# Goal

Improve mobile UX for the Cash P&L report page.

Focus:
- compact header
- readable KPI cards on mobile
- Daily Cash Movement table becomes cards on mobile
- Net Cash Change highlighted clearly
- mini trend chart section readable on small screens

---

# Current Issues

1. Page header spacing too large for mobile
2. KPI cards use desktop-only layout
3. Daily Cash Movement table overflows on small screens
4. Net Cash Change not visually emphasized on mobile

---

# Required Changes

## Compact Mobile Header

Reduce title size on mobile.

Current title:
Cash P&L

Mobile:
- text-xl on mobile
- sm:text-2xl on desktop

---

## KPI Cards Layout

Mobile layout:

grid grid-cols-2 gap-3

Desktop layout:

md:grid-cols-4

Net Cash Change card:
- highlight with border color (green if positive, red if negative)
- font-bold, text-lg minimum

---

## Mini Trend Chart

Chart section:
- ensure chart renders within viewport width on mobile
- avoid horizontal overflow
- height can be reduced on mobile (h-40 sm:h-56)

---

## Daily Cash Movement Table → Cards on Mobile

Desktop:
Keep existing table layout.

Mobile:
Convert to card list.

Example card:

01 Mar

Cash In   ฿120,000
Cash Out  ฿85,000
Net       ฿35,000

Implementation:
- hidden sm:block for table
- sm:hidden for card list

---

# Do Not Change

- Cash In / Cash Out calculation logic
- Bank transaction queries
- Wallet TOP_UP logic
- Date filtering logic
- Bangkok timezone handling

---

# Done When

- Header compact on mobile
- KPI cards readable in 2-column grid on mobile
- Net Cash Change highlighted
- Daily Cash Movement shows as cards on mobile
- Desktop layout unchanged
