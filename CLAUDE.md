# SaaS Dashboard (Multi-Channel E-Commerce) – Project Rules

# Language & Communication Rules

- Always respond in Thai.
- Use clear, concise, technical Thai.
- Do not switch to English unless explicitly asked.
- Code comments can be in English if clearer, but explanations must be in Thai.

## Goal (MVP)
Build internal dashboard (<=5 users) to track Daily P&L accurately.
Primary goal: Daily P&L ที่ใช้งานจริงและแม่นยำ เพื่ออุดรูรั่วรายได้

## Tech Stack (must follow)
- Next.js 14 (App Router), React 18, TypeScript
- Tailwind CSS, shadcn/ui, Recharts
- Supabase (Postgres + RLS), Supabase Auth + Google OAuth
- No localStorage/sessionStorage

## Critical Business Logic (must not be wrong)
### Daily P&L
Revenue (all channels)
- Advertising Cost (daily)
- COGS
= Profit/Loss

### CEO Commission Flow (TikTok)
- TikTok pays commission into CEO personal account
- CEO may use some personally
- Remaining transferred to company = Director's Loan (CEO -> Company)
System must separate:
1) Personal income
2) Director's Loan to company

## MVP Priority (do in this order)
1) Sales Orders: CRUD (view/add/edit/delete), filter/search, export
2) Expenses: CRUD + categories (Advertising/Operating/COGS), export
3) Dashboard: replace mock with real DB data (today + last 7 days)
Later: CSV import, inventory, payables, reports, tax, APIs

## Development Rules
- Do one feature at a time (no parallel big features)
- If needs major refactor: STOP and ask first
- Prefer server/db truth; keep client thin
- Always include edit + export for each table feature
- Keep UI simple, no fancy visualization beyond essentials


##
- Prefer direct, structured answers.
- Avoid verbose explanations.
- Focus on implementation details and next actions.

## Workspace Permissions

- You are allowed to create, modify, and delete files freely
  ONLY inside this project directory.
- Do not ask for confirmation before editing files within this workspace.
- Never access files outside this project.
- If a change would affect architecture or business logic,
  STOP and ask before proceeding.
