# Quick Reference: import-inventory-receipts.ts

## File Location
```
D:\AI_OS\projects\saas-dashboard\frontend\scripts\import-inventory-receipts.ts
```

## Quick Start

### 1. Setup Environment
```bash
cd D:\AI_OS\projects\saas-dashboard\frontend
# Create .env.local with:
# NEXT_PUBLIC_SUPABASE_URL=your_url
# SUPABASE_SERVICE_ROLE_KEY=your_key
```

### 2. Run Dry Run (Preview)
```bash
npx tsx scripts/import-inventory-receipts.ts --dry-run
```

### 3. Run Real Import
```bash
npx tsx scripts/import-inventory-receipts.ts
```

---

## Data Being Imported

| Date | Product | Qty | Unit Price | PO Number | Total Cost |
|------|---------|-----|-----------|-----------|-----------|
| 2026-05-18 | Fresh Up | 938 | 48 | PO001/2026 | 45,024 |
| 2026-05-18 | Wind Down | 500 | 70 | PO029 | 35,000 |
| 2026-05-29 | Fresh Up | 1,000 | 48 | PO002/2026 | 48,000 |
| **TOTAL** | | **2,438** | | | **80,084** |

---

## Output Format

```json
{
  "receipts_added": 3,
  "returns_processed": 0,
  "total_qty": 2438,
  "total_cost": 80084,
  "dry_run": false,
  "errors": []
}
```

---

## Function Reference

| Function | Purpose |
|----------|---------|
| `uuidv4()` | Generate UUID v4 using Node.js crypto |
| `printUsage()` | Display CLI help |
| `parseArgs()` | Parse command-line arguments |
| `getReceiptData()` | Load hardcoded receipt data for dates |
| `generateRefId()` | Extract PO# or generate UUID |
| `createReceiptLayers()` | Build receipt layer rows |
| `getReturnableItems()` | Query returnable items from DB |
| `createAdjustmentRows()` | Build adjustment rows for returns |
| `main()` | Orchestrate the import process |

---

## Database Tables Affected

### inventory_receipt_layers
- **Inserted**: 3 rows
- **Columns**: id, ref_type, ref_id, product_name, quantity, unit_cost, total_cost, receipt_date, notes, created_at

### inventory_adjustments
- **Inserted**: 0+ rows (depends on inventory_returns data)
- **Columns**: id, type, product_name, quantity, unit_cost, total_cost, reason, notes, created_at

---

## Key Features

✅ Batch processing (100 records per batch)
✅ Progress indicators
✅ Error collection without stopping
✅ Dry-run preview mode
✅ Bangkok timezone (UTC+7)
✅ PO number parsing to ref_id
✅ Returnable items auto-detection
✅ Graceful error handling
✅ JSON structured output

---

## Environment Variables Required

```env
NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "SUPABASE_SERVICE_ROLE_KEY not set" | Add to .env.local in frontend/ |
| "Module not found" | Run `npm install` first |
| "Failed to fetch returnable items" | Check inventory_returns table exists |
| "Insert failed" | Verify table schema matches expectations |

---

## Performance

- **Batch Size**: 100 records
- **Total Records**: 3 receipts + returnable items
- **Processing Time**: < 1 second typically
- **Memory**: Minimal (streaming inserts)

---

## Files in This Delivery

1. **import-inventory-receipts.ts** - Main script (312 lines, 8.9 KB)
2. **import-inventory-receipts.README.md** - Full documentation
3. **IMPORT_SCRIPT_SUMMARY.md** - Detailed completion report
4. **QUICK_REFERENCE.md** - This file

---

## Next Steps

1. ✅ Verify .env.local exists
2. ✅ Run with --dry-run to preview
3. ✅ Check output JSON for accuracy
4. ✅ Execute real import
5. ✅ Verify records in database
