# Shared Mobile UX Rules

These rules apply to ALL dashboard pages.

---

# Goal

Improve mobile usability while keeping desktop layout intact.

The dashboard is primarily used for:

* viewing analytics
* quick operational checks

---

# Rule 1 — Hide Import Buttons On Mobile

Import buttons should NOT appear on mobile screens.

Reason:

Analytics pages should focus on viewing data.

Operational actions should be performed from:

/quick-actions

Implementation example:

className="hidden lg:flex"

Desktop → visible
Mobile → hidden

---

# Rule 2 — Tables On Mobile

Large tables should not appear on small screens.

Mobile behavior:

Convert tables into card or stacked layout.

Desktop:

Keep table layout.

---

# Rule 3 — KPI Cards

Mobile layout should use:

grid grid-cols-2 gap-3

Cards must remain readable and tappable.

---

# Rule 4 — Page Headers

Mobile pages should have compact headers.

Avoid large titles that push content down.

---

# Rule 5 — Date Picker

Use the shared date picker component.

Behavior:

Preset dropdown first

Example presets:

Today
Yesterday
Last 7 days
Last 30 days
This Month
Custom

When Custom is selected:

Show calendar selector.

---

# Rule 6 — Loading Feedback

Interactive UI elements must show loading state.

Examples:

* toggles
* buttons
* filters

Prevent repeated clicks.

---

# Rule 7 — Do Not Modify

Do NOT change:

* analytics queries
* data calculations
* backend logic
* timezone logic

This initiative is UI/UX only.

---

# Expected Result

* Clean mobile analytics pages
* Consistent layout
* Desktop experience unchanged
