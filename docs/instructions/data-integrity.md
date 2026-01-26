# Data Integrity & Security Rules

## Source of Truth
- **Server/database is the source of truth** for calculations and validation.
- Keep the client thin; avoid duplicating complex logic in the UI.
- Do **not** use `localStorage` or `sessionStorage`.

## Server-Side Validation
- All critical validation must run server-side.
- Client-side validation is allowed only for UX (must not be authoritative).

## Row-Level Security (RLS)
- RLS must be enforced for all user data.
- Users can only read/write their own rows (or authorized scope).
- RLS policies are part of business correctness, not optional.

## Auditability
- Expense CRUD operations must create immutable audit log entries.
- Audit logs are append-only (no update/delete policies).

## Timezone Consistency
- **All date logic uses Asia/Bangkok timezone**.
- Shared utilities live in `frontend/src/lib/bangkok-time.ts`.
- Exports should include Bangkok timestamped filenames.

## Idempotency & Import Safety
- Imports must be **idempotent**.
- Use file hash deduplication (`import_batches.file_hash`) and in-file dedup where relevant.
- Never bypass dedup checks; fix data at the source and re-import.
- Detailed import rules are documented in `docs/instructions/import-dedup.md`.

## CSV/Excel Exports
- Exports are generated server-side for correctness and timezone consistency.
- Filters must be respected exactly as shown in the UI.
