# Sales Order View / Line View Implementation Summary

**Date**: 2026-01-28
**Feature**: Order View (default) + Line View toggle + Order Detail Drawer + Correct Aggregations

---

## PROBLEM STATEMENT

TikTok Shop exports are SKU-line based (1 order_id can have multiple rows). Current UI displays Product Name per row and sums `total_amount` across all lines, which inflates revenue when orders contain multiple SKUs.

**Example**:
- Order ID: `12345`
- Line 1: Product A, qty=2, total_amount=500 (order-level field)
- Line 2: Product B, qty=3, total_amount=500 (same order amount)

**Current Behavior** (WRONG):
- Shows 2 rows in table
- Revenue calculation: 500 + 500 = 1,000 THB ❌
- Orders count: 2 ❌

**Required Behavior** (CORRECT):
- Order View: 1 row, Revenue=500 THB, Units=5, Orders=1 ✅
- Line View: 2 rows (raw data), with aggregation awareness

---

## SOLUTION ARCHITECTURE

### A. Data Model (No Schema Changes Required)
Existing `sales_orders` table already has:
- `external_order_id`: Platform order ID (grouping key)
- `order_id`: Internal ID (may differ)
- `total_amount`: ORDER-LEVEL amount (duplicated across lines)
- `quantity`: LINE-LEVEL quantity

**Added**:
- `status_group` column (migration-028) for broader status filtering

### B. Aggregation Rules
1. **Group by**: `external_order_id` (or `order_id` if external not available)
2. **Order Amount**: `MAX(total_amount)` per order (should be identical across lines)
3. **Total Units**: `SUM(quantity)` across lines
4. **SKU Count**: `COUNT(*)` lines per order
5. **Orders Count**: `COUNT(DISTINCT order_id)`

### C. Backend (Server Actions)
**New Actions**:
- `getSalesOrdersGrouped()`: Returns `GroupedSalesOrder[]` (1 row per order)
- `getSalesOrderDetail()`: Returns `SalesOrder[]` (all lines for specific order)

**Updated Actions**:
- `getSalesAggregates()`: Now groups by order_id BEFORE computing metrics
- `exportSalesOrders()`: Will need update to support view parameter (future)

### D. Frontend (UI/UX)
**Components**:
- View Toggle: `[Order View] [Line View]` buttons
- OrderDetailDrawer: Sheet component with order summary + line items table
- Summary Cards: Use `getSalesAggregates()` (now order-level aware)

**State Management**:
- `view`: 'order' | 'line'
- `groupedOrders`: GroupedSalesOrder[] (Order View data)
- `orders`: SalesOrder[] (Line View data)
- `selectedOrderId`: string | null (for drawer)

---

## FILES CHANGED

### 1. Database Migration
**File**: `database-scripts/migration-028-add-status-group.sql`
**Status**: ✅ Created
**Changes**:
- Add `status_group` column to sales_orders
- Index for filtering
- Backfill from platform_status

### 2. Types
**File**: `frontend/src/types/sales.ts`
**Status**: ✅ Modified
**Changes**:
- Added `GroupedSalesOrder` interface
- Updated `SalesOrderFilters` to include `view?: 'order' | 'line'`

### 3. Backend Actions
**File**: `frontend/src/app/(dashboard)/sales/actions.ts`
**Status**: ✅ Modified
**Changes**:
- ✅ Added `getSalesOrdersGrouped()` (252 lines)
- ✅ Added `getSalesOrderDetail()` (35 lines)
- ✅ Updated `getSalesAggregates()` to use order-level grouping (added 80 lines)
- ⏳ TODO: Update `exportSalesOrders()` to support view parameter

### 4. UI Components
**File**: `frontend/src/components/sales/OrderDetailDrawer.tsx`
**Status**: ✅ Created (220 lines)
**Features**:
- Sheet drawer with order summary
- Line items table
- Platform, status, payment badges
- Date display (order_date, paid_at, shipped_at, delivered_at)

### 5. Main Sales Page
**File**: `frontend/src/app/(dashboard)/sales/page.tsx`
**Status**: ⏳ REQUIRES MANUAL IMPLEMENTATION
**Required Changes**: (see implementation guide below)

---

## IMPLEMENTATION GUIDE FOR page.tsx

### Step 1: Update Imports
```typescript
import { GroupedSalesOrder } from '@/types/sales'
import { getSalesOrdersGrouped, getSalesAggregates } from '@/app/(dashboard)/sales/actions'
import { OrderDetailDrawer } from '@/components/sales/OrderDetailDrawer'
import { Eye } from 'lucide-react'
```

### Step 2: Add State Variables (after line 83)
```typescript
const [view, setView] = useState<'order' | 'line'>('order')
const [groupedOrders, setGroupedOrders] = useState<GroupedSalesOrder[]>([])
const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
const [showDetailDrawer, setShowDetailDrawer] = useState(false)
```

### Step 3: Update fetchOrders() Function
```typescript
const fetchOrders = async () => {
  try {
    setLoading(true)
    setError(null)

    if (view === 'order') {
      // FETCH GROUPED ORDERS
      const result = await getSalesOrdersGrouped({
        sourcePlatform: filters.sourcePlatform,
        status: filters.status,
        paymentStatus: filters.paymentStatus,
        startDate: filters.startDate,
        endDate: filters.endDate,
        search: filters.search,
        dateBasis,
        page: filters.page,
        perPage: filters.perPage,
      })

      if (!result.success) {
        setError(result.error || 'เกิดข้อผิดพลาด')
        return
      }

      setGroupedOrders(result.data || [])
      setTotalCount(result.count || 0)
    } else {
      // FETCH LINE-LEVEL ORDERS (existing logic)
      const supabase = createClient()
      const offset = (filters.page - 1) * filters.perPage
      // ... existing Supabase query ...
      setOrders(data || [])
      setTotalCount(count || 0)
    }
  } catch (err) {
    // ... error handling ...
  } finally {
    setLoading(false)
  }
}
```

### Step 4: Update fetchAggregates()
Add `dateBasis` parameter:
```typescript
const result = await getSalesAggregates({
  sourcePlatform: filters.sourcePlatform,
  status: filters.status,
  paymentStatus: filters.paymentStatus,
  startDate: filters.startDate,
  endDate: filters.endDate,
  search: filters.search,
  dateBasis, // ADD THIS
})
```

### Step 5: Add useEffect to Refetch on View Change
```typescript
useEffect(() => {
  fetchOrders()
}, [view]) // Add view dependency
```

### Step 6: Add View Toggle UI (after date basis selector, ~line 574)
```tsx
{/* View Toggle Row */}
<div className="flex items-center gap-4 p-3 border rounded-lg bg-white">
  <label className="text-sm font-medium">แสดงข้อมูล:</label>
  <div className="flex items-center gap-2">
    <Button
      variant={view === 'order' ? 'default' : 'outline'}
      size="sm"
      onClick={() => setView('order')}
    >
      Order View (1 row per order)
    </Button>
    <Button
      variant={view === 'line' ? 'default' : 'outline'}
      size="sm"
      onClick={() => setView('line')}
    >
      Line View (raw data)
    </Button>
  </div>
  <span className="text-xs text-muted-foreground ml-auto">
    {view === 'order'
      ? 'แสดง 1 แถวต่อ Order ID (รวมหลาย SKU)'
      : 'แสดงทุกแถวแยกตาม SKU'}
  </span>
</div>
```

### Step 7: Update Table Headers (replace existing, ~line 700)
```tsx
<TableHeader className="sticky top-0 bg-white z-10">
  <TableRow>
    {view === 'order' ? (
      // ORDER VIEW HEADERS
      <>
        <TableHead className="min-w-[140px]">Order ID</TableHead>
        <TableHead className="min-w-[100px]">Platform</TableHead>
        <TableHead className="min-w-[140px]">Status</TableHead>
        <TableHead className="min-w-[80px]">Payment</TableHead>
        <TableHead className="text-right min-w-[80px]">Total Units</TableHead>
        <TableHead className="text-right min-w-[120px]">Order Amount</TableHead>
        <TableHead className="min-w-[100px]">Paid Date</TableHead>
        <TableHead className="min-w-[100px]">Shipped Date</TableHead>
        <TableHead className="text-right min-w-[100px]">Actions</TableHead>
      </>
    ) : (
      // LINE VIEW HEADERS (existing)
      <>
        <TableHead className="min-w-[140px]">Order ID</TableHead>
        <TableHead className="min-w-[100px]">Platform</TableHead>
        <TableHead className="min-w-[200px]">Product Name</TableHead>
        <TableHead className="text-right min-w-[60px]">Qty</TableHead>
        <TableHead className="text-right min-w-[120px]">Amount</TableHead>
        <TableHead className="min-w-[140px]">Status</TableHead>
        <TableHead className="min-w-[80px]">Payment</TableHead>
        <TableHead className="min-w-[100px]">Paid Date</TableHead>
        <TableHead className="text-right min-w-[100px]">Actions</TableHead>
      </>
    )}
  </TableRow>
</TableHeader>
```

### Step 8: Update Table Body (replace existing, ~line 770)
```tsx
<TableBody>
  {loading ? (
    // Loading skeleton (same as before)
    Array.from({ length: 5 }).map((_, index) => (
      <TableRow key={index}>
        {Array.from({ length: view === 'order' ? 9 : 9 }).map((_, i) => (
          <TableCell key={i}>
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
          </TableCell>
        ))}
      </TableRow>
    ))
  ) : view === 'order' ? (
    // ORDER VIEW ROWS
    groupedOrders.length === 0 ? (
      <TableRow>
        <TableCell colSpan={9} className="h-32 text-center">
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <p className="text-lg font-medium">ไม่พบข้อมูล</p>
          </div>
        </TableCell>
      </TableRow>
    ) : (
      groupedOrders.map((order) => (
        <TableRow key={order.order_id}>
          <TableCell className="font-medium" title={order.external_order_id || order.order_id}>
            <div className="max-w-[140px] truncate">
              {order.external_order_id || order.order_id}
            </div>
          </TableCell>
          <TableCell>{getPlatformLabel(order.source_platform || order.marketplace)}</TableCell>
          <TableCell>{getPlatformStatusBadge(order.platform_status)}</TableCell>
          <TableCell>{getPaymentStatusBadge(order.payment_status)}</TableCell>
          <TableCell className="text-right">
            <div className="font-medium">{order.total_units}</div>
            <div className="text-xs text-muted-foreground">{order.sku_count} SKUs</div>
          </TableCell>
          <TableCell className="text-right font-semibold">
            ฿{formatCurrency(order.order_amount)}
          </TableCell>
          <TableCell>{order.paid_at ? formatDate(order.paid_at) : '-'}</TableCell>
          <TableCell>{order.shipped_at ? formatDate(order.shipped_at) : '-'}</TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedOrderId(order.order_id)
                  setShowDetailDrawer(true)
                }}
                title="ดูรายละเอียด"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ))
    )
  ) : (
    // LINE VIEW ROWS (existing logic)
    orders.length === 0 ? (
      <TableRow>
        <TableCell colSpan={9} className="h-32 text-center">
          ไม่พบข้อมูล
        </TableCell>
      </TableRow>
    ) : (
      orders.map((order) => (
        <TableRow key={order.id}>
          {/* Existing line view row rendering */}
        </TableRow>
      ))
    )
  )}
</TableBody>
```

### Step 9: Add OrderDetailDrawer Component (before closing </div>, ~line 927)
```tsx
{/* Order Detail Drawer */}
<OrderDetailDrawer
  orderId={selectedOrderId}
  open={showDetailDrawer}
  onOpenChange={setShowDetailDrawer}
/>
```

### Step 10: Update Empty State Message (optional)
Add hint when no data in Order View:
```tsx
{dateBasis === 'paid_at' && view === 'order' && (
  <p className="text-sm text-amber-600 mt-2">
    💡 Order View แสดงเฉพาะออเดอร์ที่มี Paid Date
  </p>
)}
```

---

## AGGREGATION LOGIC EXPLAINED

### Backend Grouping (getSalesOrdersGrouped)
```typescript
// 1. Fetch ALL matching lines from DB
const lines = await supabase.from('sales_orders').select('*')./* filters */

// 2. Group by order_id
const orderMap = new Map()
for (const line of lines) {
  const orderId = line.external_order_id || line.order_id

  if (!orderMap.has(orderId)) {
    // First line: initialize
    orderMap.set(orderId, {
      order_amount: line.total_amount, // Order-level field
      total_units: line.quantity,       // Start sum
      sku_count: 1,                     // Start count
      // ... other fields
    })
  } else {
    // Subsequent lines: aggregate
    const existing = orderMap.get(orderId)
    existing.total_units += line.quantity
    existing.sku_count += 1
    existing.order_amount = Math.max(existing.order_amount, line.total_amount) // Safety
  }
}

// 3. Convert to array, sort, paginate
const groupedOrders = Array.from(orderMap.values())
```

### Summary Cards (getSalesAggregates)
```typescript
// 1. Group by order_id FIRST
const orderMap = new Map()
for (const line of lines) {
  const orderId = line.external_order_id || line.order_id
  if (!orderMap.has(orderId)) {
    orderMap.set(orderId, {
      order_amount: line.total_amount,
      total_units: line.quantity,
      is_cancelled: line.platform_status.includes('ยกเลิก'),
    })
  } else {
    orderMap.get(orderId).total_units += line.quantity
  }
}

// 2. Aggregate from order-level data
let revenue = 0
let orders = 0
let units = 0

for (const order of orderMap.values()) {
  if (!order.is_cancelled) {
    revenue += order.order_amount  // ✅ Correct: 1 per order
    orders += 1                     // ✅ Correct: count distinct
    units += order.total_units      // ✅ Correct: sum across lines
  }
}
```

---

## TESTING STRATEGY

### Test Data Setup
1. **Single-SKU Order**: Order A with 1 product, qty=5, amount=100
2. **Multi-SKU Order**: Order B with 2 products, qty=2+3, amount=500 (same across lines)
3. **Cancelled Order**: Order C, cancelled status

### Test Cases Priority
| # | Test Case | Critical? | Auto/Manual |
|---|-----------|-----------|-------------|
| 1 | Order View shows 1 row per order | ✅ HIGH | Manual |
| 2 | Summary cards accurate (no inflation) | ✅ HIGH | Manual |
| 3 | Line View shows raw lines | ✅ HIGH | Manual |
| 4 | Drawer opens with correct data | ✅ HIGH | Manual |
| 5 | Filters work in both views | ⚠️ MEDIUM | Manual |
| 6 | Pagination counts correct | ⚠️ MEDIUM | Manual |
| 7 | Export respects view | 🔵 LOW | Manual |
| 8 | Performance < 2s with 100 orders | 🔵 LOW | Manual |

See: `SALES_ORDER_VIEW_QA_CHECKLIST.md` for detailed test steps.

---

## KNOWN LIMITATIONS & RISKS

### Limitations
1. **Edit/Delete in Order View**: Disabled (must use Line View or Drawer)
   - Reason: Editing one line of multi-SKU order is confusing UX
2. **Aggregation Assumption**: Assumes `total_amount` identical across lines
   - Mitigation: Use MAX() and could add warning badge if mismatch
3. **Performance**: Grouping done client-side (JavaScript Map)
   - Risk: Slow with 1000+ orders
   - Mitigation: Move to Postgres aggregation query (future)

### Risks
1. **Data Inconsistency**: If imports have corrupted data (varying order_amount)
   - Mitigation: Import validation + MAX() safety
2. **Search by Product**: Requires fetching all lines then grouping
   - Mitigation: Acceptable for MVP, optimize later
3. **Refund Handling**: Not yet implemented
   - Mitigation: Add when TikTok refund data available

---

## PERFORMANCE CONSIDERATIONS

### Current Implementation (Client-Side Grouping)
- **Pros**: Simple, works with existing DB schema, no migrations needed
- **Cons**: All lines fetched then grouped (O(n) in JavaScript)
- **Acceptable for**: <500 orders on screen

### Future Optimization (Postgres Aggregation)
If performance becomes issue, move to DB-side aggregation:
```sql
SELECT
  COALESCE(external_order_id, order_id) as order_id,
  MAX(total_amount) as order_amount,
  SUM(quantity) as total_units,
  COUNT(*) as sku_count,
  MAX(paid_at) as paid_at,
  -- ...
FROM sales_orders
WHERE created_by = $1
GROUP BY COALESCE(external_order_id, order_id)
ORDER BY MAX(order_date) DESC
LIMIT $2 OFFSET $3
```

---

## NEXT STEPS

### Immediate (MVP)
1. ✅ Complete page.tsx implementation (follow guide above)
2. ✅ Run migration-028-add-status-group.sql
3. ✅ Manual QA testing (use checklist)
4. ✅ Fix any bugs found

### Short-Term (Post-MVP)
1. ⏳ Update exportSalesOrders() to support view parameter
2. ⏳ Add refund badge logic (if TikTok data available)
3. ⏳ Add "aggregation mismatch" warning badge
4. ⏳ Performance testing with large datasets

### Long-Term (Optimization)
1. 🔵 Move aggregation to Postgres query (Edge Function)
2. 🔵 Add caching for summary cards
3. 🔵 Implement virtual scrolling for large tables

---

## ROLLBACK PLAN

If critical issues found in production:

### Option 1: Feature Toggle (Recommended)
Add environment variable:
```env
NEXT_PUBLIC_ENABLE_ORDER_VIEW=false
```
Revert to Line View only until fixed.

### Option 2: Database Rollback
```sql
-- Rollback migration-028
ALTER TABLE sales_orders DROP COLUMN IF EXISTS status_group;
DROP INDEX IF EXISTS idx_sales_orders_status_group;
```

### Option 3: Code Rollback
```bash
git revert <commit-hash>
npm run build
# Deploy
```

---

## SIGN-OFF

**Implemented By**: Claude Sonnet 4.5 + Human Developer
**Reviewed By**: _____________
**Approved By**: _____________
**Date**: _____________

**Ready for Production**: [ ] YES / [ ] NO / [ ] WITH CAVEATS

**Caveats** (if any):
_____________________________________________
