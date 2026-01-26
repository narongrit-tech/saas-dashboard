# Development Workflow

## MVP Priority (Order of Work)
1. Sales Orders: CRUD + filters/search + export.
2. Expenses: CRUD + categories + export.
3. Dashboard: real DB data (today + last 7 days).
4. Later: CSV import, inventory, payables, reports, tax, APIs.

## Development Rules
- Do **one feature at a time** (avoid parallel large features).
- If a change requires a **major refactor**, stop and ask first.
- Prefer server/db truth; keep client thin.
- Each table feature should include **edit + export**.
- Keep UI simple; avoid unnecessary visualizations.

## Workspace Permissions
- You may create/modify/delete files **inside this repo only**.
- Do not access files outside the project.
- If a change affects architecture or business logic, stop and ask.

## When You’re Stuck
### Before Making Changes
1. Check if changes touch critical business logic (see `docs/instructions/architecture.md`).
2. Review `BUSINESS_RULES_AUDIT.md` for context.
3. If timezone-related, confirm Bangkok timezone handling.
4. If adding new dependencies, ask first.

### When Adding Features
1. Follow existing patterns (see completed features in `docs/instructions/architecture.md`).
2. Use server-side calculations for correctness.
3. Add both client + server validation (server is authoritative).
4. Include NaN safety guards in numeric computations.
5. Test with empty data; should return 0 values.
6. Update documentation (`docs/PROJECT_STATUS.md` and instruction files) after completion.
