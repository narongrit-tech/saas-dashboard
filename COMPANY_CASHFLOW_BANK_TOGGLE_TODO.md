# Company Cashflow Bank Toggle - TODO

**File:** `frontend/src/app/(dashboard)/company-cashflow/page.tsx`

**Current State:** Uses marketplace-based cashflow (settlement_transactions + expenses + wallet_ledger)

**Required Changes:**

## 1. Add Toggle State
```tsx
const [source, setSource] = useState<'bank' | 'marketplace'>('marketplace') // default to marketplace for backward compatibility
```

## 2. Add Toggle UI
Before the date range picker, add:
```tsx
<div className="flex items-center gap-2">
  <Button
    variant={source === 'bank' ? 'default' : 'outline'}
    onClick={() => setSource('bank')}
  >
    Bank View
  </Button>
  <Button
    variant={source === 'marketplace' ? 'default' : 'outline'}
    onClick={() => setSource('marketplace')}
  >
    Marketplace View
  </Button>
</div>
```

## 3. Update fetchData() to pass source
```tsx
const result = await getCompanyCashflow(dateRange.startDate, dateRange.endDate, source)
```

## 4. Update handleExport() to pass source
```tsx
const result = await exportCompanyCashflow(dateRange.startDate, dateRange.endDate, source)
```

## 5. Add Info Alert
Below the toggle buttons:
```tsx
{source === 'bank' && (
  <Alert>
    <Info className="h-4 w-4" />
    <AlertDescription>
      Bank View shows actual cash flow from bank transactions (source of truth).
      Requires bank statement import to have data.
    </AlertDescription>
  </Alert>
)}
{source === 'marketplace' && (
  <Alert>
    <Info className="h-4 w-4" />
    <AlertDescription>
      Marketplace View shows calculated cashflow from internal records
      (settlements, expenses, wallet top-ups).
    </AlertDescription>
  </Alert>
)}
```

## 6. Backend Support (Already Implemented)
The `getCompanyCashflow()` and `exportCompanyCashflow()` actions already support
the `source` parameter (Phase 7 Task A).

**Default:** 'marketplace' (for backward compatibility)
**Bank source:** Uses `bank_transactions` table

## Implementation Priority
- **Medium** - Nice to have but not blocking
- Can be done after Expenses subcategory UI (higher priority)
- Requires bank module to be functional first

## Testing
1. Toggle to Bank View → Should show empty state if no bank data imported
2. Import bank statement → Bank View should show data
3. Toggle to Marketplace View → Should show existing logic data
4. Export from both views → CSV should match the selected source
