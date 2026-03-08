# Internal Affiliates Page

Status: Pending

Route: /affiliates

---

# Goal

Improve mobile UX for the Internal Affiliates management page.

Focus:
- compact header
- full-width Add Affiliate button on mobile
- sticky full-width search bar on mobile
- affiliate rows become cards on mobile
- active/inactive toggle remains interactive
- desktop table unchanged

---

# Current Issues

1. Page header may be large on mobile
2. Add Affiliate button may be too small to tap comfortably
3. Search bar may not be full width on mobile
4. Affiliate table overflows on small screens

---

# Required Changes

## Compact Header

Mobile:
- text-xl font-bold
- sm:text-2xl on desktop

---

## Add Affiliate Button

Mobile:
- full width: w-full
- large tap target

Desktop:
- keep existing button size and position

---

## Search Bar

Mobile:
- full width: w-full
- sticky position at top of list (sticky top-0 bg-background z-10)

Desktop:
- keep existing layout

---

## Affiliate Rows → Cards on Mobile

Desktop:
Keep existing table with columns:
- Name
- Code
- Commission Rate
- Status
- Actions

Mobile:
Convert each row to a card.

Example card:

Alice Smith
Code: ALICE10  ·  10%

[Active toggle]   [Edit] [Delete]

Implementation:
- hidden sm:block for table wrapper
- sm:hidden for card list

Active toggle must remain interactive (not display-only).

---

## Edit / Delete Actions

On mobile cards:
- show icon-only buttons or compact action row
- ensure tap targets are at least 44px

---

# Do Not Change

- Affiliate creation logic
- Commission rate calculation
- Active/inactive toggle logic
- Any data fetching

---

# Done When

- Header compact on mobile
- Add Affiliate button full width on mobile
- Search bar full width and sticky on mobile
- Affiliate rows show as cards on mobile
- Active toggle still works on mobile
- Desktop table unchanged
