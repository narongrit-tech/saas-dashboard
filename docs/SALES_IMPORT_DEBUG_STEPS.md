# Sales Import Debug Steps

**Purpose:** Debug why import flow stops after `createImportBatch` without executing `importSalesChunk` or `finalizeImportBatch`.

**Date:** 2026-01-27

---

## Pre-requisites

1. Code changes have been applied to:
   - `frontend/src/app/(dashboard)/sales/sales-import-actions.ts` (server-side logs + debug switch)
   - `frontend/src/components/sales/SalesImportDialog.tsx` (UI-side logs + error handling)

2. **IMPORTANT:** After code changes, you MUST restart the dev server:
   ```bash
   # Stop current server (Ctrl+C)
   cd frontend
   npm run dev
   ```

---

## Debug Mode Options

### Option 1: Normal Mode (Production Logging)

**Purpose:** Track import flow with detailed logs but allow normal execution.

**Setup:**
```bash
# No env flag needed - logs are always active
npm run dev
```

**Expected Terminal Logs:**
```
[createImportBatch] Starting import, Project: <project-name>
[createImportBatch] File: OrderSKUList.xlsx, Rows: 1432
[createImportBatch] ✓ Batch created: <batch-id-full> (<batch-id-short>)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[importSalesChunk] ✓ ENTER - Function called successfully
[importSalesChunk] Batch ID: <batch-id>
[importSalesChunk] Chunk: 1/3
[importSalesChunk] Data size: 45678 bytes
[importSalesChunk] Project: <project-name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[importSalesChunk] Parsing chunk data...
[importSalesChunk] Upserting 500 rows...
[importSalesChunk] ✓ Upsert completed: 500 rows processed

... (repeat for chunks 2, 3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[finalizeImportBatch] ✓ ENTER - Function called successfully
[finalizeImportBatch] Batch: <batch-id>
[finalizeImportBatch] Project URL: <project-name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[finalizeImportBatch] Verifying rows for batch: <batch-id>
[finalizeImportBatch] Verification result: count=1432, error=none
[finalizeImportBatch] ✓ Verification passed: 1432 rows found in database
```

**Expected Browser Console Logs:**
```
[UI] Starting chunk import: 3 chunks, batchId: <batch-id>
[UI] Calling importSalesChunk: chunk 1/3, rows: 500
[UI] importSalesChunk result: { success: true, inserted: 500, ... }
[UI] Calling importSalesChunk: chunk 2/3, rows: 500
[UI] importSalesChunk result: { success: true, inserted: 500, ... }
[UI] Calling importSalesChunk: chunk 3/3, rows: 432
[UI] importSalesChunk result: { success: true, inserted: 432, ... }
[UI] Calling finalizeImportBatch...
[UI] finalizeImportBatch result: { success: true, inserted: 1432, ... }
```

---

### Option 2: Debug Mode (Hard Fail Test)

**Purpose:** Force functions to throw errors to DEFINITIVELY prove they are being executed.

**Setup:**
```bash
# Create .env.local if it doesn't exist
cd frontend

# Add debug flag
echo "SALES_IMPORT_DEBUG_THROW=1" >> .env.local

# Restart server (required!)
npm run dev
```

**Expected Behavior:**
- Import starts normally
- `createImportBatch` succeeds
- `importSalesChunk` throws error: `"DEBUG: importSalesChunk executed successfully (chunk 1/3)"`
- `finalizeImportBatch` throws error: `"DEBUG: finalizeImportBatch executed successfully"`

**Expected Terminal Logs:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[importSalesChunk] ✓ ENTER - Function called successfully
[importSalesChunk] Batch ID: <batch-id>
[importSalesChunk] Chunk: 1/3
[importSalesChunk] Data size: 45678 bytes
[importSalesChunk] Project: <project-name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[importSalesChunk] 🔥 DEBUG MODE: Throwing test error
```

**Expected Browser Console:**
```
[UI] Calling importSalesChunk: chunk 1/3, rows: 500
[UI] Import flow caught error: Error: DEBUG: importSalesChunk executed successfully (chunk 1/3)
[UI] Error stack: Error: DEBUG: importSalesChunk executed successfully (chunk 1/3)
    at importSalesChunk (sales-import-actions.ts:650)
    ...
```

**Expected UI:**
- Red toast notification: "Import Error"
- Error message includes "DEBUG: importSalesChunk executed successfully"

**To Disable Debug Mode:**
```bash
# Remove or comment out the line in .env.local
# SALES_IMPORT_DEBUG_THROW=1

# Or set to 0
SALES_IMPORT_DEBUG_THROW=0

# Restart server
npm run dev
```

---

## Test Procedure

### Step 1: Prepare Environment

```bash
cd frontend
npm run dev
```

### Step 2: Open Browser with Console

1. Navigate to `http://localhost:3000/sales`
2. Open browser DevTools (F12)
3. Switch to Console tab
4. Keep terminal visible to see server logs

### Step 3: Start Import

1. Click "Import" button
2. Upload TikTok OrderSKUList .xlsx file
3. Review preview
4. Click "Confirm Import"

### Step 4: Monitor Logs

**Watch Terminal for:**
- `[createImportBatch]` logs appear → ✅ Function executed
- `[importSalesChunk]` logs appear → ✅ Function executed
- `[finalizeImportBatch]` logs appear → ✅ Function executed

**Watch Browser Console for:**
- `[UI] Calling importSalesChunk` appears → ✅ Server action called
- `[UI] importSalesChunk result` appears → ✅ Server action returned
- `[UI] Calling finalizeImportBatch` appears → ✅ Server action called
- `[UI] finalizeImportBatch result` appears → ✅ Server action returned

---

## Troubleshooting

### Issue 1: No Terminal Logs at All

**Symptom:** Terminal shows nothing after import starts.

**Possible Causes:**
1. Dev server not restarted after code changes
2. Code changes not saved
3. Wrong project/terminal window

**Solution:**
```bash
# 1. Stop server (Ctrl+C)
# 2. Verify file changes
cd frontend/src/app/\(dashboard\)/sales
cat sales-import-actions.ts | grep "DEFINITIVE LOG"
# Should see: console.log(`━━━━━━...`)

# 3. Restart server
cd ../../../..  # back to frontend/
npm run dev

# 4. Try import again
```

---

### Issue 2: Only `[createImportBatch]` Logs Appear

**Symptom:** Terminal shows batch creation but no chunk/finalize logs.

**Diagnosis:** Server actions are NOT being called or failing silently.

**Solution:**
```bash
# Enable debug mode to force hard fail
echo "SALES_IMPORT_DEBUG_THROW=1" >> .env.local
npm run dev

# Try import again
# If you see error in browser console → Functions ARE being called
# If NO error → Functions are NOT being called (Next.js Server Action issue)
```

---

### Issue 3: Browser Console Shows `[UI] Calling ...` but No Result

**Symptom:** Browser shows `[UI] Calling importSalesChunk` but never shows `[UI] importSalesChunk result`.

**Diagnosis:** Server action called but failed without returning response.

**Check Terminal for:**
- Error stack traces
- Uncaught exceptions
- Network errors

**Check Browser Network Tab:**
- Look for failed POST requests to `/sales`
- Check response status (500 = server error)

---

### Issue 4: Debug Mode Shows No Error

**Symptom:** `SALES_IMPORT_DEBUG_THROW=1` set but no error thrown.

**Possible Causes:**
1. `.env.local` not loaded (restart server)
2. Typo in env variable name
3. Code not reading env variable

**Solution:**
```bash
# Verify env variable is loaded
cd frontend
node -e "console.log(process.env.SALES_IMPORT_DEBUG_THROW)"
# Should print: 1

# If prints: undefined
# → Check .env.local exists in frontend/ directory
# → Check spelling: SALES_IMPORT_DEBUG_THROW (not THROW_DEBUG or similar)
# → Restart server
```

---

## Success Criteria

### Normal Mode Success

✅ **All logs appear in correct order:**
1. Terminal: `[createImportBatch]` logs
2. Browser: `[UI] Starting chunk import`
3. Terminal: `[importSalesChunk] ✓ ENTER` (for each chunk)
4. Browser: `[UI] importSalesChunk result` (for each chunk)
5. Terminal: `[finalizeImportBatch] ✓ ENTER`
6. Browser: `[UI] finalizeImportBatch result`
7. UI: Success toast with "Import completed: 1432 rows"

✅ **Database verification:**
```sql
-- In Supabase SQL Editor
SELECT COUNT(*) FROM sales_orders
WHERE import_batch_id = '<batch-id-from-logs>';
-- Should return: 1432 (matches inserted_count)
```

### Debug Mode Success

✅ **Error is thrown and caught:**
1. Terminal: `[importSalesChunk] 🔥 DEBUG MODE: Throwing test error`
2. Browser: `[UI] Import flow caught error: DEBUG: importSalesChunk executed`
3. UI: Red error toast with "DEBUG: importSalesChunk executed"

This PROVES the server action is being called and executed.

---

## Next Steps Based on Results

### If All Logs Appear (Normal Mode)

✅ **Import flow is working correctly.**

**Next:** Investigate why production had empty sales_orders:
- Run `database-scripts/debug-sales-import-mystery.sql`
- Check environment mismatch (see `docs/SALES_IMPORT_MYSTERY_INVESTIGATION.md`)

### If `createImportBatch` Logs but No Chunk Logs

❌ **Server actions are not being called.**

**Next:**
1. Enable debug mode (`SALES_IMPORT_DEBUG_THROW=1`)
2. Check browser console for errors
3. Check browser Network tab for failed requests
4. Verify Next.js Server Actions are enabled:
   ```typescript
   // next.config.js should have:
   experimental: {
     serverActions: true  // or default enabled in Next.js 14
   }
   ```

### If Debug Mode Shows Error

✅ **Server actions ARE executing.**

**Next:** Investigate why normal mode doesn't work:
- Check error handling in `SalesImportDialog.tsx`
- Check FormData serialization
- Check chunk size (might be too large)

---

## File Locations

- Server Actions: `frontend/src/app/(dashboard)/sales/sales-import-actions.ts`
- UI Component: `frontend/src/components/sales/SalesImportDialog.tsx`
- Environment: `frontend/.env.local`
- Investigation Docs: `docs/SALES_IMPORT_MYSTERY_INVESTIGATION.md`
- Diagnostic SQL: `database-scripts/debug-sales-import-mystery.sql`

---

## Related Documentation

- [Sales Import Mystery Investigation](./SALES_IMPORT_MYSTERY_INVESTIGATION.md)
- [Sales Import Fix Summary](./SALES_IMPORT_FIX_SUMMARY.md)
- [Sales Page Rerender Fix](./SALES_PAGE_RERENDER_FIX.md)

---

**Status:** ✅ Debug instrumentation complete, ready for testing
