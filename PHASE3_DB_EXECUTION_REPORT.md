# PHASE3_DB_EXECUTION_REPORT

Date: 2026-04-03

## Scope

Strict scope followed:

- SQL / database only
- no UI changes
- no SaaS integration
- no wallet / finance / reconciliation / P&L / `sales_orders` work
- no scope expansion

Target chain requested:

1. `database-scripts/migration-096-tiktok-content-order-attribution.sql`
2. `database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql`
3. `database-scripts/verify-tiktok-affiliate-content-profit-layer.sql`

## Executive Result

Final recommendation: **NO-GO**

Reason:

- I could inspect the SQL objects and their dependencies in the repo.
- I could not execute the migrations or verification on the actual database from this machine.
- The required database target and SQL execution toolchain are both unavailable in the current environment.

This is an environment blocker, not a confirmed SQL-runtime blocker.

## Environment Discovery Result

I verified the following facts on the current machine:

- `DATABASE_URL` is not set in the active shell.
- No `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, or `PG*` variables are set in the active shell.
- No matching user-level or machine-level Windows environment variables are set.
- No project `.env.local` or other repo-local connection file exists.
- `psql` is not installed or not available on `PATH`.
- `supabase` CLI is not installed or not available on `PATH`.

Because of that, the "correct database/environment" could not be identified or reached from local context.

## SQL Objects Inspected

### Required by `migration-096-tiktok-content-order-attribution.sql`

Objects created:

- function `public.tiktok_affiliate_resolve_actual_commission(numeric, numeric)`
- function `public.tiktok_affiliate_rollup_status(text[])`
- function `public.tiktok_affiliate_map_business_bucket(text)`
- view `public.content_order_attribution_candidates`
- view `public.content_order_attribution`

Dependencies confirmed in repo:

- table `public.content_order_facts`
- table `public.tiktok_affiliate_order_raw_staging`
- function `public.tiktok_affiliate_status_rank(text)`

### Required by `migration-097-tiktok-affiliate-content-profit-layer.sql`

Objects created:

- table `public.tt_content_costs`
- table `public.tt_content_cost_allocations`
- table `public.content_profit_attribution_summary`
- function `public.refresh_tt_content_cost_allocations(uuid)`
- function `public.refresh_content_profit_attribution_summary(uuid)`
- function `public.refresh_content_profit_layer(uuid)`

Dependencies confirmed in repo:

- view `public.content_order_attribution`
- function `public.update_updated_at_column()`
- `auth.users`
- `auth.uid()`

## Static Verification Findings

Static inspection of the checked-in SQL shows the requested business rules are represented in the definitions:

- status mapping:
  - `settled -> realized`
  - `pending -> open`
  - `awaiting_payment -> open`
  - `ineligible -> lost`
- unknown / unsupported statuses surface as `unknown`
- attribution winner grain is `created_by + order_id + product_id`
- attribution candidate grain is `created_by + order_id + product_id + content_id`
- profit uses `commission_realized`
- `roi` is nullable and constrained to require `total_cost > 0` when non-null
- content-only cost allocation uses commission share first, then GMV share, then explicit unallocated rows

Important limitation:

- These were not proven against the live database because the migrations and validation queries could not be executed.

## Commands And Scripts Run

Commands executed during this verification attempt:

```powershell
Get-ChildItem -Path . -Recurse -File -Filter 'migration-096-tiktok-content-order-attribution.sql' | Select-Object -ExpandProperty FullName
Get-ChildItem -Path . -Recurse -File -Filter 'migration-097-tiktok-affiliate-content-profit-layer.sql' | Select-Object -ExpandProperty FullName
Get-ChildItem -Path . -Recurse -File -Filter 'verify-tiktok-affiliate-content-profit-layer.sql' | Select-Object -ExpandProperty FullName
git status --short

rg --files "projects/saas-dashboard" | rg "database-scripts|db|supabase|postgres|\.env|docker-compose|package.json|README|migration-09[67]|verify-tiktok-affiliate-content-profit-layer"
Get-ChildItem -Path 'projects/saas-dashboard' -Force | Select-Object Mode,Name,FullName
Get-ChildItem -Path 'projects/saas-dashboard' -Force -Filter '.git' -Recurse -Directory -ErrorAction SilentlyContinue | Select-Object -First 5 -ExpandProperty FullName

Get-Content -Path 'projects/saas-dashboard/database-scripts/migration-096-tiktok-content-order-attribution.sql' -TotalCount 260
Get-Content -Path 'projects/saas-dashboard/database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql' -TotalCount 320
Get-Content -Path 'projects/saas-dashboard/database-scripts/verify-tiktok-affiliate-content-profit-layer.sql' -TotalCount 320
rg -n --hidden -S "SUPABASE|DATABASE_URL|POSTGRES|PGHOST|PGPORT|PGUSER|PGPASSWORD|psql|supabase db|db push|connection string|service_role" 'projects/saas-dashboard'

$env:DATABASE_URL; if ($env:DATABASE_URL) { 'DATABASE_URL_SET' } else { 'DATABASE_URL_MISSING' }
Get-ChildItem -Path 'frontend' -Force -Filter '.env*' | Select-Object Name,FullName
Get-Content -Path 'database-scripts/README-tiktok-content-order-attribution.md' -TotalCount 220
Get-Content -Path 'database-scripts/README-tiktok-affiliate-content-profit-layer.md' -TotalCount 220
rg -n "tiktok_affiliate_status_rank|content_order_facts|update_updated_at_column|refresh_content_profit_layer|refresh_content_profit_attribution_summary|refresh_tt_content_cost_allocations" database-scripts

rg --files -g ".env*" 'projects/saas-dashboard'
Get-ChildItem -Path 'D:\AI_OS\projects\saas-dashboard' -Force | Where-Object { $_.Name -like '.env*' } | Select-Object Name,FullName
Get-ChildItem Env: | Where-Object { $_.Name -match 'SUPABASE|DATABASE_URL|POSTGRES|PG' } | Sort-Object Name | ForEach-Object { "{0}={(set)}" -f $_.Name }
Get-Content -Path 'docs/content-ops/07-phase-3-profit-layer.md' -TotalCount 220

psql --version
supabase --version
rg --files 'projects/saas-dashboard' | rg "supabase/|docker-compose|compose\.ya?ml|postgres|\.sql$|config\.toml$"
Get-ChildItem -Path $HOME -Force | Where-Object { $_.Name -in '.pgpass','.psql_history','.postgresql','.supabase' } | Select-Object Name,FullName
Get-Process | Where-Object { $_.ProcessName -match 'postgres|docker|supabase' } | Select-Object ProcessName,Id,Path

Get-ChildItem -Path 'D:\AI_OS\projects\saas-dashboard' -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.env*' -or $_.Extension -in '.ps1','.cmd','.bat','.sh','.toml' } | Select-Object -ExpandProperty FullName
rg -n --hidden -S "supabase\.co|db\.|postgresql://|postgres://|DATABASE_URL=|NEXT_PUBLIC_SUPABASE_URL=|SUPABASE_SERVICE_ROLE_KEY=|SUPABASE_URL=" 'D:\AI_OS\projects\saas-dashboard'
Get-Content -Path 'frontend/package.json' -TotalCount 260
Get-Content -Path 'database-scripts/tiktok-affiliate-content-profit-pipeline.sql' -TotalCount 120
Get-Content -Path 'database-scripts/verify-tiktok-content-order-attribution.sql' -TotalCount 280

git -C 'D:\AI_OS\projects\saas-dashboard' status --short
Get-ChildItem -Path 'D:\AI_OS\projects\saas-dashboard' -Force | Where-Object { $_.Name -in '.vercel','.netlify','.github' } | Select-Object Name,FullName
rg -n --hidden -S "project-ref|project ref|supabase project|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_ANON_KEY|service_role|vercel env|remote env|production" 'D:\AI_OS\projects\saas-dashboard\.claude' 'D:\AI_OS\projects\saas-dashboard\docs' 'D:\AI_OS\projects\saas-dashboard'
Get-ChildItem -Path $HOME -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.env*' -or $_.Name -like '*supabase*' -or $_.Name -like '*postgres*' } | Select-Object -First 200 -ExpandProperty FullName

$names = 'DATABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGPORT','PGUSER','PGDATABASE'; foreach ($n in $names) { $u=[Environment]::GetEnvironmentVariable($n,'User'); $m=[Environment]::GetEnvironmentVariable($n,'Machine'); if ($u) { "$n=USER_SET" }; if ($m) { "$n=MACHINE_SET" } }
Get-ChildItem 'HKCU:\Environment' | Select-Object -ExpandProperty Name
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' | Select-Object -ExpandProperty Name

Get-Content -Path 'database-scripts/migration-098-tiktok-affiliate-content-review-fixes.sql' -TotalCount 260
Get-Content -Path 'REVIEW_PHASE3.md' -TotalCount 260
Get-Content -Path 'PHASE3_IMPLEMENTATION_SUMMARY.md' -TotalCount 260
Get-Content -Path 'database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql' -Tail 260

python --version
py --version
node --version
```

Scripts actually executed against the database:

- None

## Exact Errors Encountered

### Blocking environment errors

1. Missing database connection variable:

```text
DATABASE_URL_MISSING
```

2. Missing PostgreSQL CLI:

```text
psql : The term 'psql' is not recognized as the name of a cmdlet, function, script file, or operable program. Check 
the spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ psql --version
+ ~~~~
    + CategoryInfo          : ObjectNotFound: (psql:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

3. Missing Supabase CLI:

```text
supabase : The term 'supabase' is not recognized as the name of a cmdlet, function, script file, or operable program. 
Check the spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ supabase --version
+ ~~~~~~~~
    + CategoryInfo          : ObjectNotFound: (supabase:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### Non-blocking workspace noise

Initial broad recursive file discovery hit broken archive paths outside the target module. That did not affect Phase 3 SQL inspection and I switched to repo-local `rg` inspection after that.

## Row Count / Sanity Query Status

Requested sanity checks were identified but **not executed** because the database connection was unavailable:

- row counts before / after attribution
- duplicates by `(order_id, product_id, content_id)`
- bucket distribution
- cost rollup by `content_id`
- profit samples
- rows with `null content_id` or `null product_id`
- rows with unsupported statuses

The checked-in verification scripts already cover part of this:

- `database-scripts/verify-tiktok-content-order-attribution.sql`
- `database-scripts/verify-tiktok-affiliate-content-profit-layer.sql`

But I could not run either one on a real database from this machine.

## Exact Fixes Applied

SQL fixes applied:

- None

Documentation fixes applied:

- Added this execution report only.

I intentionally did **not** modify the migrations without evidence from a real database run.

## Uncommitted Repo State Observed

The repo already had unrelated modified and untracked files before this report was added. I did not revert or alter those changes.

## What Is Still Needed To Complete The Requested Verification

To complete the end-to-end database proof on the actual environment, this machine needs all of:

1. A real target connection
   - `DATABASE_URL`, or
   - Supabase project ref plus direct DB credentials, or
   - a confirmed alternative execution path

2. A SQL execution tool
   - `psql`, or
   - `supabase` CLI with linked project, or
   - another approved Postgres SQL runner available locally

3. Then run, in order:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -f database-scripts/migration-096-tiktok-content-order-attribution.sql
psql $env:DATABASE_URL -f database-scripts/migration-097-tiktok-affiliate-content-profit-layer.sql
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-content-order-attribution.sql
psql $env:DATABASE_URL -f database-scripts/verify-tiktok-affiliate-content-profit-layer.sql
```

If user-scoped data exists and profit refresh is required for validation:

```powershell
cd D:\AI_OS\projects\saas-dashboard
psql $env:DATABASE_URL -v created_by="'<auth_user_uuid>'" -f database-scripts/tiktok-affiliate-content-profit-pipeline.sql
```

## Go / No-Go Recommendation

**NO-GO**

Rationale:

- `content_order_attribution` was not proven to build on the real database.
- the profit layer was not proven to build on the real database.
- the validation script was not run on the real database.
- the mandatory sanity checks were not run on the real database.

The correct next step is not to change architecture or broaden scope. The correct next step is to provide a real database execution path, then rerun this exact Phase 3 verification end-to-end.
