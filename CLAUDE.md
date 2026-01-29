# SaaS Dashboard (Multi-Channel E-Commerce) – Project Rules

## Start Here
- Read this file first for immutable rules and a quick overview.
- Then review: `docs/instructions/business-rules.md`, `docs/instructions/data-integrity.md`, `docs/instructions/import-dedup.md`, `docs/instructions/architecture.md`, `docs/instructions/dev-workflow.md`, and `docs/instructions/glossary.md`.
- For latest feature status and roadmap, see `docs/PROJECT_STATUS.md`.

## Project Overview (10–20 lines)
- Internal dashboard for a small team (≤5 users) to track **Daily P&L** accurately.
- Core modules: Sales Orders, Expenses, Daily P&L, Dashboard, Cashflow, Wallets, Ads Imports, Bank, Reconciliation, Company Cashflow, Inventory & COGS.
- Built with Next.js App Router (React 18 + TypeScript), Tailwind, shadcn/ui, Recharts.
- Data source is Supabase Postgres with **RLS** and Google OAuth auth.
- **Bangkok timezone** is authoritative for all date handling and exports.
- Imports are a major workflow (TikTok cashflow, ads, sales/expenses, bank statements).
- P&L and Cashflow are separate views; reconciliation bridges the difference.
- Wallet ledger rules are strict: ad spend must come from imports, top-ups are not expenses.
- **Inventory costing**: FIFO and Moving Average methods for accurate COGS calculation, bundle support, returns reversal.
- CSV/Excel exports are server-side for accuracy.
- Client UI stays thin; server actions enforce business correctness.

## Immutable Rules (Do Not Break)
- **Always respond in Thai** and keep responses clear/technical (English only if asked).
- **No localStorage/sessionStorage** usage.
- **Server/DB is the source of truth**; critical validation and calculations are server-side.
- **RLS is mandatory** for all user data access.
- **Import idempotency is required**; do not bypass dedup rules.
- **Bangkok timezone** must be used for all date logic.
- If a change affects **architecture or business logic**, stop and ask first.
- Do not modify critical business logic files without review (see `docs/instructions/architecture.md`).

## Documentation Map
- Business rules: `docs/instructions/business-rules.md`.
- Data integrity & security: `docs/instructions/data-integrity.md`.
- Import formats & dedup: `docs/instructions/import-dedup.md`.
- Architecture + feature map: `docs/instructions/architecture.md`.
- Development workflow: `docs/instructions/dev-workflow.md`.
- Glossary: `docs/instructions/glossary.md`.

## Common Commands
```bash
cd frontend
npm install
npm run dev
npm run lint
npm run build
```
