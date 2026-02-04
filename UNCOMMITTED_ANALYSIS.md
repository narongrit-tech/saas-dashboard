# Uncommitted Changes Analysis

Generated: 2026-02-04
Total uncommitted files: 60+

## 📊 สรุปภาพรวม

| Category | Count | Action |
|----------|-------|--------|
| Documentation (Bugs/Summaries) | 18 | ✅ ควร commit |
| Migration Scripts | 16 | ✅ ควร commit |
| Verification SQL | 7 | ⚠️ Optional commit |
| Debug/Analysis Scripts | 10 | ❌ ไม่ควร commit |
| Screenshots | 1 folder | ❌ ไม่ควร commit |
| Raw Data | 1 folder | ❌ ไม่ควร commit |
| Settings | 1 file | ⚠️ ดูก่อน commit |
| Components | 2 files | ✅ ควร commit |

---

## ✅ **ควร Commit ทันที** (High Priority)

### 📝 Documentation - Bug Fixes & Summaries
**สถานะ**: เอกสารสรุปการแก้ไข bugs และ features สำคัญ

```
Root level:
✅ BUGFIX_2ROW_HEADER_PARSING.md          - Bug fix documentation
✅ BUGFIX_IMPORT_COLUMN_MISMATCH.md       - Import issue fix
✅ BUGFIX_SHIPPING_FEE_AFTER_DISCOUNT.md  - Shipping fee calculation
✅ COMMIT_MESSAGE_040.md                  - Commit message template
✅ SUMMARY_BUNDLE_COGS.md                 - Bundle COGS feature
✅ SUMMARY_GMV_CARDS.md                   - GMV cards feature
✅ SUMMARY_GMV_STABILIZATION.md           - GMV stabilization (CRITICAL!)
✅ SUMMARY_STOCK_IN_FIX.md                - Stock management fix

docs/ folder:
✅ BUGFIX_ADS_RACE_CONDITION.md           - Ads race condition fix
✅ BUGFIX_APPLY_COGS_BAD_REQUEST.md       - COGS application issue
✅ FIX_PROFIT_REBUILD_AUTH.md             - Profit rebuild auth
✅ QA_APPLY_COGS_DATE_RANGE.md            - QA documentation
✅ QA_BUNDLE_COGS.md                      - Bundle QA
✅ QA_BUNDLE_ON_HAND.md                   - Bundle on-hand QA
✅ QA_GMV_RECONCILIATION.md               - GMV reconciliation QA
✅ QA_STOCK_IN_FLOW.md                    - Stock flow QA
✅ SUMMARY_ADS_RACE_FIX.md                - Ads fix summary
✅ SUMMARY_APPLY_COGS_DATE_RANGE.md       - COGS date range
```

**ทำไมควร commit**: เอกสารเหล่านี้สำคัญสำหรับ:
- ติดตาม bugs ที่แก้ไปแล้ว
- QA checklist สำหรับ testing
- Knowledge transfer ให้ทีม
- Audit trail สำหรับการเปลี่ยนแปลง business logic

**Recommendation**:
```bash
git add BUGFIX_*.md SUMMARY_*.md COMMIT_MESSAGE_*.md
git add docs/BUGFIX_*.md docs/QA_*.md docs/SUMMARY_*.md docs/FIX_*.md
git commit -m "docs: add bug fixes, QA checklists, and feature summaries"
```

---

### 🗄️ Database Migration Scripts
**สถานะ**: Migration scripts สำหรับ schema changes และ data fixes

```
✅ migration-039-fix-rebuild-profit-summaries-duplicates.sql
✅ migration-040-fix-stock-in-item-id.sql
✅ migration-041-add-stock-in-quantity-item-id.sql
✅ migration-042-profit-order-rollup-view.sql
✅ migration-044-order-financials.sql              (CRITICAL!)
✅ migration-045-add-gmv-cards-created-time.sql
✅ migration-046-opening-balance-void-with-reversal.sql
✅ migration-049-fix-gmv-view.sql
✅ migration-050-populate-order-amount.sql
✅ README-migration-039.md
✅ README-migration-040.md
✅ README-migration-049.md
✅ README-migration-050.md
✅ README-migration-051.md
✅ apply-migration-039.sh
✅ fix-sku-canonicalization-NEWONN.sql
```

**ทำไมควร commit**:
- **Version control สำหรับ database schema**
- Track การเปลี่ยนแปลง schema เพื่อ rollback ได้
- Documentation สำหรับ production deployment
- **migration-044, 045, 049-052 เป็น critical fixes ที่ถูก apply แล้ว**

**Recommendation**:
```bash
git add database-scripts/migration-*.sql
git add database-scripts/README-migration-*.md
git add database-scripts/fix-sku-canonicalization-NEWONN.sql
git add database-scripts/apply-migration-039.sh
git commit -m "feat(migrations): add migrations 039-050 for GMV stabilization and inventory fixes

- migration-044: order_financials table (GMV source of truth)
- migration-045: GMV cards created_time
- migration-046: opening balance void with reversal
- migration-039-042: profit summaries and stock fixes
- migration-049-050: GMV view fixes
- Add README docs for each migration"
```

---

### 🎨 Frontend Components
**สถานะ**: UI components ที่ยังไม่ได้ commit

```
✅ frontend/src/components/ui/tooltip.tsx          - Tooltip component
⚠️ frontend/src/app/(dashboard)/sales/actions-refactored.ts  - Refactored actions
```

**ทำไมควร commit**:
- `tooltip.tsx`: shadcn/ui component ที่จำเป็นสำหรับ UI
- `actions-refactored.ts`: ถ้าเป็น refactored version ที่ใช้งานได้แล้ว

**⚠️ ตรวจสอบก่อน commit**:
```bash
# ดูว่า actions-refactored.ts ถูกใช้งานหรือเป็นแค่ draft
grep -r "actions-refactored" frontend/src/app/(dashboard)/sales/
```

**Recommendation**:
```bash
# ถ้า refactored version ใช้งานแล้ว:
git add frontend/src/components/ui/tooltip.tsx
git add frontend/src/app/(dashboard)/sales/actions-refactored.ts
git commit -m "feat(ui): add tooltip component and refactor sales actions"

# ถ้ายังไม่ใช้งาน actions-refactored:
git add frontend/src/components/ui/tooltip.tsx
git commit -m "feat(ui): add shadcn tooltip component"
```

---

## ⚠️ **Optional Commit** (Medium Priority)

### 🔍 Verification SQL Scripts
**สถานะ**: SQL queries สำหรับ verify data integrity

```
⚠️ verify-gmv-cards.sql
⚠️ verify-migration-039.sql
⚠️ verify-migration-044.sql
⚠️ verify-migration-051.sql
⚠️ verify-stock-in-flow.sql
⚠️ check-import-status.sql
⚠️ check-imported-dates.sql
```

**ทำไมอาจควร commit**:
- มีประโยชน์สำหรับ QA และ debugging
- สามารถใช้ซ้ำได้ใน future testing
- **แนะนำ**: commit ถ้าเป็น reusable verification queries

**ทำไมอาจไม่ควร commit**:
- ถ้าเป็น one-time debugging queries
- ถ้ามี hard-coded IDs หรือ timestamps specific to current data

**Recommendation**:
```bash
# ดู content ก่อนว่า generic หรือ specific
cat database-scripts/verify-gmv-cards.sql

# ถ้า generic และ reusable:
git add database-scripts/verify-*.sql
git add database-scripts/check-*.sql
git commit -m "test: add verification SQL scripts for migrations and data integrity"

# ถ้า specific: ไม่ต้อง commit หรือเพิ่ม .gitignore
```

---

### ⚙️ Settings File
**สถานะ**: Claude settings (local configuration)

```
⚠️ .claude/settings.local.json
```

**ตรวจสอบ**:
```bash
git diff .claude/settings.local.json
```

**Recommendation**:
- ถ้าเป็น personal settings (API keys, paths): **ไม่ควร commit**, add to `.gitignore`
- ถ้าเป็น team settings (features, configs): **ควร commit**

```bash
# ถ้าเป็น personal settings:
git restore .claude/settings.local.json
echo ".claude/settings.local.json" >> .gitignore

# ถ้าเป็น team settings:
git add .claude/settings.local.json
git commit -m "chore: update claude settings"
```

---

## ❌ **ไม่ควร Commit** (Should Ignore/Delete)

### 🧪 Debug & Analysis Scripts
**สถานะ**: Temporary scripts สำหรับ debugging และ analysis

```
❌ frontend/analyze_raw_data.js
❌ frontend/analyze_sales_daily_breakdown.js
❌ frontend/analyze_sales_detailed_logic.js
❌ frontend/analyze_sales_export.js
❌ frontend/analyze_sales_final_logic.js
❌ frontend/analyze_sales_january_only.js
❌ frontend/analyze_sales_order_level.js
❌ frontend/debug-gmv-filter.js
❌ frontend/test-date-parsing.js
❌ frontend/test-date-range.js
```

**ทำไมไม่ควร commit**:
- **Temporary debugging tools** - ไม่มีประโยชน์ใน production
- **One-time analysis** - specific to current debugging session
- **Clutters repository** - ทำให้ repo ยุ่ง
- **May contain sensitive data** - อาจมี hard-coded values

**Recommendation**:
```bash
# Option 1: Delete
rm frontend/analyze_*.js frontend/debug-*.js frontend/test-*.js

# Option 2: Add to .gitignore
echo "frontend/analyze_*.js" >> .gitignore
echo "frontend/debug-*.js" >> .gitignore
echo "frontend/test-*.js" >> .gitignore
echo "database-scripts/delete-*.sql" >> .gitignore
echo "database-scripts/debug-*.sql" >> .gitignore
```

---

### 🗑️ Temporary/Debug SQL Scripts
**สถานะ**: One-time SQL queries สำหรับ debugging

```
❌ database-scripts/debug-imported-dates.sql
❌ database-scripts/delete-all-sales-and-affiliate-data.sql
❌ database-scripts/delete-january-orders.sql
❌ database-scripts/find-missing-orders.sql
❌ database-scripts/quick-check-dates.sql
```

**ทำไมไม่ควร commit**:
- **Dangerous scripts** - `delete-*.sql` เป็น destructive operations
- **One-time debugging** - specific to current issue
- **Not reusable** - hard-coded dates/IDs

**Recommendation**:
```bash
# Delete หรือ move to local backup
rm database-scripts/delete-*.sql
rm database-scripts/debug-*.sql
rm database-scripts/quick-check-*.sql
rm database-scripts/find-missing-*.sql

# หรือ backup locally
mkdir -p ~/backup/sql-debug
mv database-scripts/delete-*.sql ~/backup/sql-debug/
mv database-scripts/debug-*.sql ~/backup/sql-debug/
```

---

### 📸 Screenshots
**สถานะ**: Binary files สำหรับ documentation (ถ้ามี)

```
❌ Screenshot/
```

**ทำไมไม่ควร commit**:
- **Large binary files** - ทำให้ repo bloated
- **Better in separate storage** - ใช้ Notion, Google Drive, หรือ GitHub Issues
- **Git LFS required** - ถ้าต้องการ track binary files

**Recommendation**:
```bash
# Add to .gitignore
echo "Screenshot/" >> .gitignore
echo "screenshots/" >> .gitignore
echo "*.png" >> .gitignore
echo "*.jpg" >> .gitignore

# Move to docs folder or external storage
mv Screenshot/ ~/Documents/project-screenshots/
```

---

### 📁 Raw Data
**สถานะ**: Excel files, CSV exports, etc.

```
❌ raw.data/
```

**ทำไมไม่ควร commit**:
- **Large files** - ทำให้ repo bloated
- **Sensitive data** - อาจมี customer data, financial records
- **Not code** - ไม่ใช่ source code
- **Should use .gitignore** - เป็น standard practice

**Recommendation**:
```bash
# Add to .gitignore
echo "raw.data/" >> .gitignore
echo "*.xlsx" >> .gitignore
echo "*.csv" >> .gitignore
echo "*.pdf" >> .gitignore

# Backup externally
# ใช้ Google Drive, Dropbox, หรือ secure backup service
```

---

## 🎯 **Action Plan แนะนำ**

### Phase 1: Commit ไฟล์สำคัญ (ควรทำทันที)
```bash
# 1. Documentation
git add BUGFIX_*.md SUMMARY_*.md COMMIT_MESSAGE_*.md
git add docs/BUGFIX_*.md docs/QA_*.md docs/SUMMARY_*.md docs/FIX_*.md
git commit -m "docs: add bug fixes, QA checklists, and feature summaries

- BUGFIX: 2ROW header parsing, import column mismatch, shipping fee
- SUMMARY: Bundle COGS, GMV cards, GMV stabilization, stock-in fix
- QA: Apply COGS, bundle features, GMV reconciliation, stock flow
- FIX: Ads race condition, COGS bad request, profit rebuild auth

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 2. Migration Scripts
git add database-scripts/migration-039*.sql database-scripts/migration-040*.sql
git add database-scripts/migration-041*.sql database-scripts/migration-042*.sql
git add database-scripts/migration-044*.sql database-scripts/migration-045*.sql
git add database-scripts/migration-046*.sql database-scripts/migration-049*.sql
git add database-scripts/migration-050*.sql
git add database-scripts/README-migration-*.md
git add database-scripts/fix-sku-canonicalization-NEWONN.sql
git add database-scripts/apply-migration-039.sh
git commit -m "feat(migrations): add migrations 039-050 for GMV and inventory

- migration-039: fix rebuild profit summaries duplicates
- migration-040-041: fix stock-in item_id and quantity
- migration-042: profit order rollup view
- migration-044: order_financials table (GMV source of truth)
- migration-045: add GMV cards created_time
- migration-046: opening balance void with reversal
- migration-049-050: fix GMV view and populate order_amount
- Add README docs and apply scripts

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 3. UI Components
git add frontend/src/components/ui/tooltip.tsx
git commit -m "feat(ui): add shadcn tooltip component

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Phase 2: Cleanup ไฟล์ที่ไม่ควร commit
```bash
# 1. Update .gitignore
cat >> .gitignore <<'EOF'

# Debug & Analysis Scripts (temporary)
frontend/analyze_*.js
frontend/debug-*.js
frontend/test-*.js

# Temporary SQL Scripts
database-scripts/delete-*.sql
database-scripts/debug-*.sql
database-scripts/quick-check-*.sql
database-scripts/find-missing-*.sql

# Screenshots & Media
Screenshot/
screenshots/
*.png
*.jpg
*.jpeg
*.gif

# Raw Data & Exports
raw.data/
exports/
*.xlsx
*.csv

# Local Settings
.claude/settings.local.json
EOF

git add .gitignore
git commit -m "chore: update .gitignore for debug scripts and data files"

# 2. Delete temporary files
rm frontend/analyze_*.js frontend/debug-*.js frontend/test-*.js
rm database-scripts/delete-*.sql database-scripts/debug-*.sql
rm database-scripts/quick-check-*.sql database-scripts/find-missing-*.sql

# 3. Restore local settings if changed
git restore .claude/settings.local.json
```

### Phase 3: Optional - Commit verification scripts
```bash
# ถ้าต้องการเก็บ verification scripts (ดู content ก่อน)
git add database-scripts/verify-*.sql
git add database-scripts/check-import-status.sql
git commit -m "test: add verification SQL scripts for data integrity

- verify-gmv-cards: GMV calculation verification
- verify-migration-*: migration integrity checks
- check-import-status: import process verification

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Phase 4: Push to remote
```bash
git push origin main
```

---

## 📋 **Summary**

| Action | Files | Reason |
|--------|-------|--------|
| ✅ **Commit Now** | 18 docs + 16 migrations + 1 component | Critical documentation & schema changes |
| ⚠️ **Review First** | 7 verification SQL + 1 settings | Useful but need content review |
| ❌ **Don't Commit** | 10 debug scripts + screenshots + raw data | Temporary/sensitive/large files |

**Total Cleanup**: ~20 files ที่ไม่ควร commit
**Total Commit**: ~35 files ที่ควร commit

---

## 🎓 **Best Practices**

### What TO commit:
- ✅ Source code (`.ts`, `.tsx`, `.js`)
- ✅ Configuration files (shared team configs)
- ✅ Documentation (`.md` files)
- ✅ Database migrations (`.sql` schema changes)
- ✅ Tests (unit/integration tests)

### What NOT to commit:
- ❌ Debug/analysis scripts (temporary tools)
- ❌ Raw data files (`.xlsx`, `.csv`, `.pdf`)
- ❌ Screenshots/images (use external storage)
- ❌ Personal settings (`.local` files)
- ❌ Sensitive data (credentials, API keys)
- ❌ Large binary files (without Git LFS)
- ❌ Temporary/cache files
- ❌ IDE-specific files (already in `.gitignore`)

### How to decide:
**Ask yourself**:
1. จะมีคนอื่นใช้ไฟล์นี้ไหม? → Yes = commit, No = ignore
2. ไฟล์นี้เป็นส่วนหนึ่งของ codebase ไหม? → Yes = commit
3. ไฟล์นี้เปลี่ยนแปลงบ่อยไหม (per machine)? → Yes = ignore
4. ไฟล์นี้มี sensitive data ไหม? → Yes = ห้าม commit!
5. ไฟล์นี้ใหญ่กว่า 1MB ไหม? → Yes = พิจารณา Git LFS หรือ external storage

---

**Generated**: 2026-02-04
**Next Review**: After committing Phase 1-2
