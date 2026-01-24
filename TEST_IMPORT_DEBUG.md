# Test Import with Debug Logs

## Purpose
Debug serialization issues before calling server actions

## Steps

### 1. Start Dev Server
```bash
cd frontend
npm run dev
```

### 2. Open Browser Console
- Press F12 (Chrome DevTools)
- Go to Console tab
- Clear existing logs

### 3. Test Sales Import
1. Navigate to http://localhost:3000/sales
2. Click "Import" button
3. Select a TikTok .xlsx file
4. Preview should load (check for any errors in console)
5. Click "Confirm Import"
6. **Check Console Output:**
   - Should see: `🐛 DEBUG: Checking Sales Import Payload Serialization`
   - Should see: `🔍 Debug Serialization: Sales Import Payload`
   - Should see: `✅ Serialization SUCCESS` (if working)
   - OR: `❌ Serialization FAILED` (if still broken)
   - If failed, debug logs will show problematic field path

### 4. Test Expenses Import
1. Navigate to http://localhost:3000/expenses
2. Click "Import" button
3. Select an expense template .xlsx/.csv file
4. Preview should load (check for any errors in console)
5. Click "Confirm Import"
6. **Check Console Output:**
   - Should see: `🐛 DEBUG: Checking Expenses Import Payload Serialization`
   - Should see: `🔍 Debug Serialization: Expenses Import Payload`
   - Should see: `✅ Serialization SUCCESS` (if working)
   - OR: `❌ Serialization FAILED` (if still broken)

## Expected Results

### If Working (✅):
```
🐛 DEBUG: Checking Sales Import Payload Serialization
🔍 Debug Serialization: Sales Import Payload
  ✅ Serialization SUCCESS
  Payload size: 12345 bytes
  Preview: {"fileHash":"abc123...","fileName":"order.xlsx","plainData":[...
```

### If Still Broken (❌):
```
🐛 DEBUG: Checking Sales Import Payload Serialization
🔍 Debug Serialization: Sales Import Payload
  ❌ Serialization FAILED: Converting circular structure to JSON
  🔎 Searching for problematic field...
  ⚠️ Found Date at root.plainData[0].order_date: 2024-01-01T00:00:00.000Z
```

## What to Look For

Debug logs will identify:
- **Date objects** → Should be strings (YYYY-MM-DD HH:mm:ss)
- **ArrayBuffer/TypedArray** → Should be converted to hash string
- **Map/Set** → Should be plain objects/arrays
- **Error instances** → Should be error messages (strings)
- **Class instances** → Should be plain objects

## After Testing

### If Serialization SUCCESS:
1. Remove debug logs from components
2. Delete this file
3. Commit: `chore: remove debug serialization logs (working)`

### If Serialization FAILED:
1. Note the problematic field path from console
2. Fix that specific field type (add conversion)
3. Test again
4. Remove debug logs once working
