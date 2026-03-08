# AI Development Workflow

This file defines the development workflow that AI agents must follow when modifying this repository.

---

## Steps

### 1. Read Documentation First

Before making any changes, read:

- docs/project-status.md
- docs/ui-mobile/README.md
- docs/ui-mobile/00-shared-rules.md
- docs/ui-mobile/<page-spec>.md (relevant page)
- docs/ai-dev-workflow.md

---

### 2. Create Implementation Plan

Before writing code, outline:

- What files will be changed
- What mobile changes are required
- What must NOT be changed (business logic, queries, calculations)

---

### 3. Apply UI Improvements

Follow rules from:

docs/ui-mobile/00-shared-rules.md

Key rules:

- Hide import buttons on mobile: `hidden lg:flex`
- Convert tables to cards on mobile
- KPI cards: `grid grid-cols-2 gap-3 md:grid-cols-4`
- Compact page headers on mobile
- Show loading states on interactive elements
- Do NOT modify analytics queries, calculations, or timezone logic

---

### 4. Run TypeScript Check

After applying changes, run:

```
cd frontend
npx tsc --noEmit
```

Fix any errors before committing.

---

### 5. Commit Changes

Stage only relevant files. Do not stage unrelated files.

Commit message style:

```
feat(ui): ads performance mobile — cards, compact header, hide import btn
fix(ui): daily rollup table overflow on mobile
docs: update ads performance status to completed
```

---

### 6. Push Changes

```
git push origin main
```

---

### 7. Update Documentation

After completing a page, update:

- The page spec file (e.g. `docs/ui-mobile/02-ads-performance.md`)
  - Change `Status: In Progress` → `Status: Completed`
  - Add `Date:` and `Changes implemented:` sections

- `docs/project-status.md`
  - Change page status from `Pending` → `Completed`

---

## Commit Message Reference

| Type | Example |
|---|---|
| New mobile UI | `feat(ui): <page> mobile — <summary>` |
| Bug fix | `fix(ui): <description>` |
| Docs update | `docs: update <page> status` |
| Docs new file | `docs(ai): add <description>` |

---

## What Agents Must Never Do

- Modify business logic or database queries
- Change analytics calculations
- Change timezone handling
- Skip the TypeScript check
- Commit unrelated files
- Modify desktop layout (desktop must remain unchanged)
