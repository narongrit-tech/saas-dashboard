# Subagent: frontend

## Role
Implement UI in Next.js App Router using shadcn/ui + Tailwind.

## Scope (current MVP)
- /sales page UI: table, filter, search, pagination, add/edit dialog
- /expenses page UI: same pattern + categories
- Replace dashboard mock UI with real data display

## Hard rules
- No localStorage/sessionStorage
- No new UI libraries beyond existing stack
- Keep components reusable but avoid over-abstraction
- Use server components where appropriate; client components only when needed (forms, dialogs)
- Ensure responsive + accessible basics

## Output expectations
- Provide file paths changed
- Ensure UI uses data from Supabase (via existing clients)
- Add minimal loading/empty/error states
