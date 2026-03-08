# Affiliate Performance Report Page

Status: Completed
Date: 2026-03-08

Changes implemented:

* Header: text-xl sm:text-2xl, compact spacing (space-y-4)
* Filters: removed Card wrapper, inline DateRangePicker
* KPI cards: grid-cols-2 gap-3 on mobile, md:grid-cols-4 on desktop
* Donut chart: responsive height h-[220px] sm:h-[350px], labels hidden on mobile
* Bar chart: min-height 250px, YAxis width reduced for mobile readability
* Internal Affiliates: card list on mobile (channel, GMV, orders, commissions), table on desktop
* External Top 10: card list on mobile (rank badge, channel, commissions), table on desktop
* Desktop layout unchanged

Route: /affiliates/report (or /overview, verify actual route)

---

# Goal

Improve mobile UX for the Affiliate Performance Report page.

Focus:
- compact header
- filter section compact on mobile
- KPI cards responsive (2-column grid)
- charts resized and readable on mobile
- internal affiliates performance table becomes cards
- external affiliates top 10 becomes cards
- desktop charts and tables unchanged

---

# Current Issues

1. Page header spacing is too large for mobile
2. Filter section takes too much vertical space on mobile
3. KPI cards may not be in 2-column grid on mobile
4. Charts may overflow viewport width on small screens
5. Donut / bar charts may become unreadable on mobile
6. Performance tables overflow horizontally on phones

---

# Required Changes

## Compact Header

Mobile:
- text-xl font-bold
- sm:text-2xl on desktop

---

## Filter Section — Compact on Mobile

On desktop: keep inline filter layout.

On mobile: collapse filters into a compact row or a "Filters" button that opens a sheet.

Minimum required filters visible on mobile:
- Date range picker

---

## KPI Cards Layout

Mobile layout:

grid grid-cols-2 gap-3

Desktop layout:

md:grid-cols-4 or match existing

---

## Charts — Mobile Readability

Rules:
- Charts must not overflow viewport (max-w-full, overflow-hidden)
- Reduce chart height on mobile if needed (h-48 sm:h-64)
- Donut chart: ensure legend is readable; stack legend below chart if needed
- Bar chart: ensure bars are not too narrow to read

Do NOT change:
- Chart data source
- Chart calculation logic
- Chart library configuration (Recharts props beyond sizing)

---

## Internal Affiliates Performance Table → Cards on Mobile

Desktop:
Keep existing table.

Mobile:
Convert to card list.

Example card:

Alice Smith (ALICE10)
Orders  45    GMV  ฿38,200
Commission  ฿3,820

---

## External Affiliates Top 10 → Cards on Mobile

Desktop:
Keep existing table.

Mobile:
Convert to card list.

Example card:

#1  @influencer_handle
Orders  120    GMV  ฿95,000

---

# Do Not Change

- Affiliate GMV calculations
- Commission calculations
- Date range and timezone logic
- Chart data queries
- Ranking logic

---

# Done When

- Header compact on mobile
- Filters accessible on mobile
- KPI cards in 2-column grid
- Charts render without overflow on mobile
- Internal affiliate table shows as cards on mobile
- External affiliate top 10 shows as cards on mobile
- Desktop layout unchanged
