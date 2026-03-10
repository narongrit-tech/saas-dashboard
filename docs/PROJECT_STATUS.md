# Project Status
**Last Updated:** 2026-03-10
**Deployment:** ✅ Live on Vercel (Production)
**Branch:** main → auto-deploy on push

> ⚠️ **Workflow Rule:** ทุกการแก้ไขต้อง Commit & Push ทุกครั้ง เพื่อให้ตรวจสอบจากหน้าจริงที่ออนไลน์ได้
> Migration ต้อง apply ใน Supabase **ก่อน** push code ขึ้น Vercel เสมอ

---

## ✅ Features Complete (as of 2026-03-10)

### Core Modules
- **Sales Orders** — CRUD + Import (TikTok, Shopee) + Export ✅
- **Expenses** — CRUD + Template + Import + Export + Draft→Paid workflow + Attachments ✅
- **Daily P&L** — Revenue, Advertising, COGS, Operating, Net Profit ✅
- **Performance Dashboard** (`/`) — 7-day Economic P&L, GMV/AdSpend/Net chart, Basis toggles ✅
- **Cash P&L** (`/reports/cash-pl`) — Bank inflows vs outflows ✅
- **Company Cashflow** — Pre-aggregated Sankey chart (Bank Statement-First) ✅
- **Wallets** — Multi-wallet system, TikTok/Shopee import, ledger ✅
- **Ads Import** — Product/Live campaigns, daily breakdown, staging handshake ✅
- **Bank** — Statement import (append/replace_range/replace_all), classifications ✅
- **Reconciliation** — P&L vs Cashflow bridge ✅
- **Inventory & COGS** — FIFO + Moving Average, bundles, returns, SKU mappings ✅
- **SKU Mappings** — Channel→internal SKU mapping CRUD ✅
- **Settings** — General, Appearance, Users, Roles, Permissions, Finance Defaults, Security ✅
- **Notifications** — Bell inbox, polls every 30s ✅
- **Shopee Finance** — Balance report + Settlement import ✅

### Recent Completions (2026-02-19 → 2026-03-10)

| Date | Feature | Migration |
|------|---------|-----------|
| 2026-02-19 | Shopee Orders + Wallet Import | 062 |
| 2026-02-19 | COGS Run Notifications (Bell) | 064 |
| 2026-02-19 | Shopee Finance (Balance + Settlement) | 065 |
| 2026-02-22 | RLS Security Fixes (6 critical tables) | 066 |
| 2026-02-24 | Fix Missing SKU + allocate | — |
| 2026-02-25 | Returns + SKU Mappings Refactor | 070 |
| 2026-02-25 | Expenses Draft→Paid + Attachments | 071, 072 |
| 2026-03-02 | Performance Dashboard v2 + Cash P&L | — |
| 2026-03-05 | Revenue Basis: Bank Inflows | 075 |
| 2026-03-08 | Settings Module | 077 |
| 2026-03-09 | Bank Dedup + Bangkok Timezone Fix | 078, 079, 080 |
| 2026-03-10 | **Cashflow Sankey (Bank Statement-First)** | 081 |
| 2026-03-10 | **Ads Import Auto-Suggest (APPEND/REPLACE/SKIP/REVIEW)** | 082 |

---

## 🚧 IN PROGRESS

None

---

## 📋 TODO (Future Enhancements)

### High Priority
- [ ] Import History UI — หน้าแสดงประวัติ import_batches ทั้งหมด (`/imports`)
- [ ] Ads Import: Rollback UI button — ให้ user rollback batch เองจากหน้า Wallets
- [ ] CEO Commission Flow — Personal income vs Director's Loan tracking

### Medium Priority
- [ ] Audit Log UI — `/expenses/[id]/audit-log`
- [ ] Inventory: Reorder points + Low stock alerts
- [ ] Payables/Receivables — Supplier payment tracking, aging reports
- [ ] Tax Calculation — VAT, Withholding tax

### Low Priority / Phase 9
- [ ] Dark mode support
- [ ] Mobile responsive optimization
- [ ] Automated Testing (Playwright E2E)
- [ ] Monitoring & alerting (Sentry)

---

## 🔴 KNOWN ISSUES

| Issue | Impact | Workaround |
|-------|--------|-----------|
| CSV formula injection (no sanitization) | Low | Internal users only |
| No file size limit on some import dialogs | Low | Max enforced on ads import |
| COGS no DB transaction wrapper | Medium | Idempotent re-run safe |
| submitReturn: channel logic shopee-only | Low | Others default 'tiktok' |
| Existing ads batches before migration-082 have no import_scope_key | Low | Date overlap detection still works via date_min/date_max |

---

## 🗄️ Database Migrations Applied

| # | Description |
|---|-------------|
| 001–060 | Core tables (sales, expenses, wallets, inventory, etc.) |
| 062 | Shopee wallet transactions |
| 064 | COGS runs + notifications |
| 065 | Shopee finance tables |
| 066 | RLS policy fixes |
| 070 | SKU mappings + returns columns |
| 071–072 | Expenses Draft/Paid + attachments |
| 073 | (removed — analytics builder abandoned) |
| 074 | Ad import staging rows |
| 075 | Bank revenue classification |
| 076 | Ad daily source_row_hash unique index |
| 077 | Settings module |
| 078–080 | Bank dedup + hash canonical format |
| 081 | Cashflow Sankey classifications |
| **082** | **Ads import scope key (import_scope_key)** |

---

## ⚙️ Tech Stack

- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui, Recharts
- **Backend:** Supabase Postgres, RLS, Google OAuth
- **Hosting:** Vercel (Production) — auto-deploy from `main`
- **Timezone:** Bangkok (Asia/Bangkok) — authoritative for all date logic

---

## ⚠️ CRITICAL FILES — DO NOT MODIFY CASUALLY

- `frontend/src/lib/daily-pl.ts` — P&L calculation
- `frontend/src/lib/wallet-balance.ts` — Wallet balance
- `frontend/src/lib/reconcile/settlement-reconcile.ts` — Bulk reconciliation
- `frontend/src/app/(dashboard)/company-cashflow/actions.ts` — Company cashflow
- `frontend/src/app/(dashboard)/reconciliation/actions.ts` — Reconciliation
- `frontend/src/app/(dashboard)/expenses/actions.ts` — Expense CRUD + Audit
- All `/wallets/*-actions.ts` — Wallet business rules
