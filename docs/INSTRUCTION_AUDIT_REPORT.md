# Instruction Audit Report

## Scope
- Audited `CLAUDE.md` and checked for `.claude/CLAUDE.md` (not present).
- Reviewed instruction layout, size, and consistency with current repo docs.

## File Size Findings
- **CLAUDE.md (before refactor):** 50,385 chars.
- **CLAUDE.md (after refactor):** 2,409 chars.
- **`.claude/CLAUDE.md`:** not found.

### Top 10 Largest Markdown Files (current)
1. `frontend/node_modules/xlsx/README.md` — 161,500 bytes
2. `frontend/node_modules/date-fns-jalali/CHANGELOG.md` — 120,192 bytes
3. `frontend/node_modules/date-fns/CHANGELOG.md` — 120,192 bytes
4. `frontend/node_modules/eslint-plugin-import/CHANGELOG.md` — 116,206 bytes
5. `frontend/node_modules/d3-shape/README.md` — 94,916 bytes
6. `frontend/node_modules/d3-scale/README.md` — 91,532 bytes
7. `frontend/node_modules/ajv/README.md` — 85,598 bytes
8. `frontend/node_modules/es-toolkit/CHANGELOG.md` — 72,468 bytes
9. `frontend/node_modules/d3-array/README.md` — 62,983 bytes
10. `frontend/node_modules/es-abstract/CHANGELOG.md` — 48,932 bytes

## Instruction Layout Review
- **Before:** `CLAUDE.md` held the entire system map and long feature descriptions (50k+ chars).
- **After:** `CLAUDE.md` is a short index with immutable rules and links to split docs.
- Long content has been moved into `docs/instructions/*` to keep the entry point under 25k chars.

## Outdated / Mismatched Instructions Detected
- `CLAUDE.md` referenced an external plan file at `~/.claude/plans/staged-stirring-mist.md`, which is **not stored in this repo**.
- `CLAUDE.md` stated “Current System State (Updated: 2026-01-25)”, but `docs/PROJECT_STATUS.md` includes **2026-01-26** updates (e.g., import batch rollback system, ads import upsert fix).
- “Phase 7 - Advanced Features” header existed without actual content, which adds noise.

## Refactor Plan (Target < 25k chars)
1. **Keep `CLAUDE.md` as a slim index**: overview + immutable rules + links + common commands.
2. **Split into focused documents** under `docs/instructions/`:
   - `business-rules.md`
   - `data-integrity.md`
   - `import-dedup.md`
   - `dev-workflow.md`
   - `architecture.md`
   - `glossary.md`
3. **Centralize status updates** in `docs/PROJECT_STATUS.md` and reference it from the index.
4. **Avoid duplication**: keep each rule in exactly one document and link when needed.

## Changes Applied
- Created `docs/instructions/` with split instruction files.
- Rewrote `CLAUDE.md` as an index of immutable rules and links.
- Moved the full architecture map and system state to `docs/instructions/architecture.md`.
