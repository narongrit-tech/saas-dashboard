# Quick Start Guide - YTD 2026 Stock Allocation

## 📋 What This Does

Allocates ALL unshipped orders from January-June 2026 using FIFO method with automatic bundle explosion.

## 🚀 Quick Start

### Prerequisites
```bash
pip install supabase python-dotenv
```

### Setup
Ensure `.env.local` in `frontend/` has:
```env
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=sk_service_...
```

### Run

**Test Mode (no DB changes)**:
```bash
python allocate-ytd-2026.py --dry-run
```

**Production (writes to DB)**:
```bash
python allocate-ytd-2026.py
```

## 📊 What Gets Allocated

| Month | Orders | Status |
|-------|--------|--------|
| Jan 2026 | 0 | Already shipped |
| Feb 2026 | 0 | Already shipped |
| Mar 2026 | 0 | Already shipped |
| Apr 2026 | 90 | ✅ Allocated |
| May 2026 | 66 | ✅ Allocated |
| Jun 2026 | 0 | No orders |

## 📦 Bundle SKUs Handled

6 bundle types automatically exploded:
- **NEWONN003**: Fresh Up + Wind Down combo
- **NEWONN011**: Fresh Up double pack
- **#0007, #0008, #0080**: Bundle variants
- **NEWONN111**: Fresh Up single

## 📈 Results

```
Orders Processed:      156 line items
Allocations Created:   197 records
Total Quantity:        319 units allocated

Bundle Units Sold:     40 bundles
  - NEWONN003: 32 bundles
  - NEWONN011: 8 bundles

Remaining Stock:
  Fresh Up (NEWONN001):  1,714 units
  Wind Down (NEWONN002):   438 units
```

## ✅ Validation

Expected vs Actual:
- Fresh Up:  Expected 789, Got 1,714 (925 units over)
- Wind Down: Expected 441, Got 438 (3 units under)

⚠️ **Note**: Targets suggest more allocation needed. Current run allocates available YTD 2026 orders only.

## 🔧 Configuration

Edit script to modify:
- **Expected Stock**: Lines 66-70
- **Bundle SKUs**: Lines 72-79
- **Date Range**: Lines 304-305

## 📚 Documentation

- `ALLOCATE_YTD_2026_REPORT.md` - Summary & findings
- `ALLOCATE_YTD_2026_TECHNICAL.md` - Algorithm & specs
- `TASK_COMPLETION_SUMMARY.md` - Full task overview

## ⚠️ Common Issues

**Missing .env.local**
```
ERROR: Missing Supabase credentials in .env.local
```
→ Create `.env.local` with Supabase credentials

**No orders found**
```
No unshipped orders. Exiting.
```
→ Check date range filter (currently Jan-Jun 2026)

**Insufficient stock warnings**
```
✗ Insufficient stock for NEWONN001: needed 100, short by 50
```
→ Check receipt layers have stock. May need to add more.

## 🎯 Next Steps

1. Run `--dry-run` to preview results
2. Review allocation counts and stock levels
3. Confirm expected remaining levels (789, 441)
4. Run without `--dry-run` to persist to database
5. Verify results in `inventory_cogs_allocations` table

## 💾 Database

All allocations inserted to `inventory_cogs_allocations`:
- Deterministic UUIDs prevent duplicates
- Batch inserts (500 per batch)
- Upsert safe for re-runs

## 📞 Support

Check script output for detailed:
- Step-by-step progress
- Bundle explosion details
- Stock allocation breakdown
- Issues and warnings

Good luck! 🎉
