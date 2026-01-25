# Expenses Page Subcategory Update - TODO

**File:** `frontend/src/app/(dashboard)/expenses/page.tsx`

**Changes Required:**

## 1. Add Subcategory State
```tsx
const [subcategoryFilter, setSubcategoryFilter] = useState<string>('All')
const [subcategories, setSubcategories] = useState<string[]>([])
```

## 2. Fetch Unique Subcategories
After fetching expenses, extract unique subcategories:
```tsx
useEffect(() => {
  if (expenses.length > 0) {
    const unique = Array.from(new Set(expenses.map(e => e.subcategory).filter(Boolean)))
    setSubcategories(unique.sort())
  }
}, [expenses])
```

## 3. Add Subcategory Filter UI
Below the Category filter dropdown:
```tsx
<Select value={subcategoryFilter} onValueChange={setSubcategoryFilter}>
  <SelectTrigger className="w-[200px]">
    <SelectValue placeholder="ทุกหมวดหมู่ย่อย" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="All">ทุกหมวดหมู่ย่อย</SelectItem>
    {subcategories.map((sub) => (
      <SelectItem key={sub} value={sub}>
        {sub}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

## 4. Apply Subcategory Filter
In the filter logic:
```tsx
let filtered = expenses
if (categoryFilter !== 'All') {
  filtered = filtered.filter(e => e.category === categoryFilter)
}
if (subcategoryFilter !== 'All') {
  filtered = filtered.filter(e => e.subcategory === subcategoryFilter)
}
// ... rest of filters
```

## 5. Add Subcategory Column to Table
After Category column:
```tsx
<TableHead>หมวดหมู่ย่อย</TableHead>

// In table body:
<TableCell>{expense.subcategory || '-'}</TableCell>
```

## 6. Update CSV Export Headers
Already done in `actions.ts` (Phase 2) - CSV includes subcategory column

## Status
- ✅ Backend actions updated (Phase 2)
- ✅ AddExpenseDialog updated (Phase 3)
- ✅ EditExpenseDialog updated (Phase 3)
- ⏳ Main page update (THIS TODO)

## Testing Checklist
- [ ] Create expense with subcategory → Shows in table
- [ ] Create expense without subcategory → Shows "-" in table
- [ ] Filter by subcategory → Only shows matching expenses
- [ ] CSV export → Subcategory column included
- [ ] Daily P&L → Still uses main category only (unchanged)
