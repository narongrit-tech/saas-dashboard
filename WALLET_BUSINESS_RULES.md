# Wallet System - Business Rules Documentation

**Created:** 2026-01-23 (Phase 3 - Multi-Wallet Foundation)
**Purpose:** Lock and document critical business rules for wallet system

---

## Overview

The Wallet System manages prepaid accounts for advertising and subscriptions. It enforces strict rules to prevent accounting errors and ensure data integrity.

**Key Principle:** **Advertising Spend Source of Truth = Ads Report ONLY**

---

## Why We Have 2 Views: Accrual P&L vs Cashflow Summary

### 1. Accrual Daily P&L (Performance View)
**Purpose:** Measure business performance - how much profit did we actually make?

**Formula:**
```
Revenue (Sales Completed + Pending, excludes Cancelled)
- Advertising Cost (from Ads Report ONLY)
- COGS (Cost of Goods Sold)
- Operating Expenses
= Net Profit
```

**Key Characteristics:**
- Revenue includes Pending orders (accrual accounting)
- Ad Spend comes from Ads Report (actual performance data)
- Shows true business profitability
- Used for: Business decisions, ROI analysis, performance tracking

---

### 2. Cashflow Summary (Liquidity View)
**Purpose:** Track actual money movement - do we have enough cash to operate?

**Formula:**
```
Cash In (Completed Sales ONLY - actual money received)
- Cash Out (All Expenses - actual money spent)
± Wallet Movements (Top-ups, Ad Spend)
= Available Cash
```

**Key Characteristics:**
- Only counts completed transactions (cash basis)
- Includes wallet top-ups (cash leaving bank account)
- Shows liquidity and cash availability
- Used for: Cash management, payment planning, withdrawal decisions

---

## Critical Business Rules (LOCKED)

### Rule 1: ADS Wallet - SPEND Source Lock 🔒

**The Rule:**
- **Ad Spend MUST come from Ads Report ONLY**
- **Manual SPEND creation is BLOCKED**
- Ad Spend = `wallet_ledger` where `entry_type=SPEND` AND `source=IMPORTED`

**Why This Rule Exists:**
1. **Single Source of Truth:** Ads Report is the only reliable source for ad spend
2. **Prevent Double-Counting:** Manual entries could duplicate imported data
3. **Accuracy:** Platform reports are more accurate than manual entries
4. **Auditability:** All ad spend can be traced back to platform reports

**Implementation:**
- Server-side validation in `wallets/actions.ts`
- If `wallet_type=ADS` AND `entry_type=SPEND` AND `source=MANUAL` → **BLOCKED**
- Error message: "❌ ห้ามสร้าง SPEND แบบ Manual สำหรับ ADS Wallet"

**Example:**
```typescript
// ✅ ALLOWED: Imported from TikTok Ads Report
entry_type = 'SPEND'
source = 'IMPORTED'
import_batch_id = '...'

// ❌ BLOCKED: Manual SPEND creation
entry_type = 'SPEND'
source = 'MANUAL'
// System will reject this
```

---

### Rule 2: ADS Wallet - TOP_UP is NOT an Expense

**The Rule:**
- **Wallet Top-up is NOT a P&L expense**
- **Top-up is a cash transfer (Bank → Wallet)**
- **Only actual Ad Spend (from report) is an expense**

**Why This Rule Exists:**
1. **Prevent Double-Counting:** If we count top-up as expense, and later count ad spend, we count twice
2. **Correct Accounting:** Top-up is a transfer, not a cost
3. **P&L Accuracy:** Only actual usage should affect profit

**Implementation:**
- `wallet_ledger` entries with `entry_type=TOP_UP` are excluded from P&L
- Daily P&L calculation uses Ads Report data ONLY
- Wallet balance tracks liquidity separately from P&L

**Example:**
```
Day 1: Top-up ฿10,000 to ADS Wallet
→ P&L Impact: ฿0 (it's a transfer, not an expense)
→ Cashflow Impact: -฿10,000 (money left bank account)

Day 2: Ads Report shows ฿3,000 spend
→ P&L Impact: -฿3,000 (this is the real expense)
→ Cashflow Impact: ฿0 (money already left on Day 1)
```

---

### Rule 3: SUBSCRIPTION Wallet - Manual SPEND Allowed

**The Rule:**
- **SUBSCRIPTION wallet CAN have manual SPEND entries**
- **Used for monthly SaaS subscriptions (AI tools, GSuite, domains, etc.)**

**Why Different from ADS Wallet:**
- Subscription charges are predictable and recurring
- No automated report system available
- Small number of transactions (manageable manually)
- Lower risk of errors compared to daily ad spend

**Implementation:**
- No restriction on manual SPEND for `wallet_type=SUBSCRIPTION`
- Still requires proper note/reference for auditability

---

### Rule 4: Immutable IMPORTED Entries

**The Rule:**
- **IMPORTED entries cannot be edited or deleted**
- **Source data must be updated and re-imported**

**Why This Rule Exists:**
1. **Data Integrity:** Imported data matches source reports
2. **Audit Trail:** Manual changes break traceability
3. **Consistency:** Re-import ensures all related data updates together

**Implementation:**
- Edit button disabled for `source=IMPORTED`
- Delete button disabled for `source=IMPORTED`
- Error message: "ไม่สามารถแก้ไข/ลบรายการที่ import มาได้"

---

### Rule 5: Entry Type and Direction Combinations

**The Rule:**
- **TOP_UP** → MUST be `direction=IN`
- **SPEND** → MUST be `direction=OUT`
- **REFUND** → MUST be `direction=IN`
- **ADJUSTMENT** → CAN be `direction=IN` OR `OUT`

**Implementation:**
- UI auto-sets direction based on entry type
- Server-side validation enforces correct combinations
- Error message if combination is invalid

---

## Common Mistakes Prevented by System

### ❌ Mistake 1: Counting Top-up as Advertising Expense
**What people might do wrong:**
- Create manual "Advertising" expense when topping up ADS wallet
- This double-counts the cost (top-up + actual ad spend)

**How system prevents:**
- Advertising expenses with `source=MANUAL` are blocked
- Only imported ad spend from reports is allowed

---

### ❌ Mistake 2: Manual Ad Spend Entry
**What people might do wrong:**
- Manually enter ad spend based on rough estimates
- Creates discrepancy with actual platform data

**How system prevents:**
- ADS wallet `entry_type=SPEND` with `source=MANUAL` is blocked
- Forces user to import from Ads Report

---

### ❌ Mistake 3: Editing Imported Data
**What people might do wrong:**
- Manually adjust imported ad spend numbers
- Breaks audit trail and creates inconsistency

**How system prevents:**
- Edit/Delete buttons disabled for `source=IMPORTED`
- Clear error message explaining why

---

### ❌ Mistake 4: Confusing P&L with Cashflow
**What people might do wrong:**
- Use wallet balance as profit indicator
- Misunderstand when money actually left the business

**How system prevents:**
- Separate views: Daily P&L (performance) vs Cashflow (liquidity)
- Clear documentation of what each view represents
- Balance summary shows both opening/closing AND P&L impact

---

## Wallet Types Reference

### ADS (Advertising Wallet)
- **Purpose:** Track advertising spending
- **Top-up:** Manual only (`source=MANUAL`)
- **Spend:** Import from Ads Report only (`source=IMPORTED`)
- **P&L Impact:** Only actual ad spend (not top-ups)
- **Example:** TikTok Ads Wallet, Facebook Ads Wallet

---

### SUBSCRIPTION (Subscription Wallet)
- **Purpose:** Track SaaS subscriptions and recurring services
- **Top-up:** Manual only (`source=MANUAL`)
- **Spend:** Manual allowed (`source=MANUAL`)
- **P&L Impact:** All spending (recurring subscriptions)
- **Example:** GSuite, ChatGPT Plus, Canva Pro, domain renewals

---

### OTHER (General Wallet)
- **Purpose:** Future expansion for other prepaid services
- **Top-up:** Manual
- **Spend:** Manual or Imported (depending on use case)
- **P&L Impact:** Depends on transaction type

---

## Data Flow Diagrams

### ADS Wallet Flow
```
[TikTok Ads Platform]
       ↓ (Run Ads)
[Daily Ads Report CSV]
       ↓ (Import)
[wallet_ledger: SPEND, IMPORTED]
       ↓
[Daily P&L: Advertising Cost]

Separately:
[Bank Account] → [Top-up ฿10,000] → [ADS Wallet]
(Cashflow Impact ONLY, NO P&L Impact)
```

---

### SUBSCRIPTION Wallet Flow
```
[SaaS Provider] → [Monthly Charge]
       ↓ (Manual Entry)
[wallet_ledger: SPEND, MANUAL]
       ↓
[Both P&L Operating Expense AND Cashflow Out]

[Bank Account] → [Top-up ฿5,000] → [SUBSCRIPTION Wallet]
(Cashflow Impact ONLY, NO P&L Impact)
```

---

## Validation Matrix

| Wallet Type | Entry Type | Direction | Source  | Allowed? | Import Batch Required? |
|-------------|------------|-----------|---------|----------|------------------------|
| ADS         | TOP_UP     | IN        | MANUAL  | ✅ Yes   | No                     |
| ADS         | SPEND      | OUT       | MANUAL  | ❌ No    | -                      |
| ADS         | SPEND      | OUT       | IMPORTED| ✅ Yes   | ✅ Yes                 |
| ADS         | REFUND     | IN        | MANUAL  | ✅ Yes   | No                     |
| ADS         | ADJUSTMENT | IN/OUT    | MANUAL  | ✅ Yes   | No                     |
| SUBSCRIPTION| TOP_UP     | IN        | MANUAL  | ✅ Yes   | No                     |
| SUBSCRIPTION| SPEND      | OUT       | MANUAL  | ✅ Yes   | No                     |
| SUBSCRIPTION| REFUND     | IN        | MANUAL  | ✅ Yes   | No                     |
| OTHER       | (any)      | (any)     | MANUAL  | ✅ Yes   | No                     |

---

## Future Considerations

### Phase 4+: Additional Wallet Types
- **BANK_TRANSFER**: Track money transfers between accounts
- **CRYPTO**: Track cryptocurrency wallets
- **PREPAID_CARDS**: Track prepaid business cards

### Phase 4+: Enhanced Reporting
- Wallet balance history charts
- Spend trend analysis per wallet
- Low balance alerts
- Forecast based on historical spend

### Phase 5+: Automation
- Auto-import from payment gateways
- Bank API integration for top-up tracking
- Real-time balance sync

---

## Performance Ads (Product/Live) - Daily Sales Tracking

### What is Performance Ads Import?

Performance Ads Import is for **product and live campaigns with sales metrics**:
- **Product Ads** = Creative/Product campaigns (daily import typical)
- **Live Ads** = Livestream campaigns (weekly import typical)
- **Must have sales metrics** (GMV/Orders/ROAS)
- **Tracked daily** for ROI optimization
- **Affects Accrual P&L** (Advertising Cost)
- **Creates ad_daily_performance records** (analytics)

---

### Why Daily Breakdown?

Unlike awareness ads (monthly aggregation), performance ads are:
1. **Optimized for conversions** - need daily ROI tracking
2. **Tied to revenue** - GMV/Orders attribution
3. **Analyzed for ROAS** - daily performance comparison
4. **Used for budget decisions** - which campaigns to scale

**Example:**
```
Performance Ads (Daily):
Day 1: Spend ฿1,000, GMV ฿3,000, ROAS = 3.0 ✅ Scale this campaign
Day 2: Spend ฿1,000, GMV ฿800, ROAS = 0.8 ❌ Pause this campaign

Awareness Ads (Monthly):
Month: Spend ฿50,000, Reach 500K ✅ Brand awareness goal
No daily optimization needed
```

---

### Import Requirements

**File Format:**
- Must be `.xlsx` (Excel format)
- No specific filename requirement

**Required Columns:**
- Date (ad date)
- Campaign (name)
- Cost / Spend
- GMV / Revenue
- Orders / Conversions
- ROAS / ROI (optional, will calculate if missing)

**Must Have Sales Metrics:**
- If file has NO GMV/Orders/ROAS → **BLOCKED** (must use Tiger Import)

**Campaign Type Selection:**
- User selects: Product (Daily) or Live (Weekly)
- Both use same import logic (daily breakdown)
- Difference is metadata only (campaign_type field)

---

### What Happens During Import?

1. **File Validation:**
   - Check file extension (.xlsx)
   - Verify required columns exist
   - Validate sales metrics present

2. **Deduplication:**
   - Calculate SHA256 hash of file content
   - Check if file already imported
   - If duplicate → REJECT with message

3. **Daily Breakdown:**
   - Parse each row with date + campaign + metrics
   - Create one ad_daily_performance record per row
   - Aggregate spend per day for wallet entries

4. **Database Writes:**
   - **ad_daily_performance** (one per day per campaign):
     ```
     marketplace: tiktok
     ad_date: YYYY-MM-DD
     campaign_type: product | live
     campaign_name: [name]
     spend, orders, revenue, roi
     source: imported
     import_batch_id: [batch id]
     ```
   - **wallet_ledger** (one per day, aggregated):
     ```
     entry_type: SPEND
     direction: OUT
     amount: [daily total spend]
     date: YYYY-MM-DD
     source: IMPORTED
     import_batch_id: [batch id]
     ```
   - **import_batches**:
     ```
     report_type: tiktok_ads_product | tiktok_ads_live
     status: success
     ```

5. **Where It Appears:**
   - ✅ Accrual P&L (as Advertising Cost)
   - ✅ Ads performance analytics (daily ROI tracking)
   - ✅ Cashflow Summary (cash outflow)
   - ✅ Wallet ledger table

---

### Business Rules

1. **Performance Import → Full System**
   - Creates ad_daily_performance records (analytics)
   - Creates wallet SPEND entries (cashflow)
   - Affects Accrual P&L (performance-driven spend)

2. **Independent Imports:**
   - Product and Live imports are fully independent
   - No coupling or completeness enforcement
   - Can import partial data (real-world frequency)
   - Each import stands alone

3. **ADS Wallet Rules Still Apply:**
   - SPEND must be IMPORTED (enforced)
   - Entry is immutable (cannot edit/delete)
   - Requires import_batch_id

4. **Daily Breakdown:**
   - One ad_daily_performance record per date per campaign
   - One wallet_ledger entry per date (aggregated)
   - Enables daily ROI analysis

---

### Performance vs Awareness: Key Differences

| Feature | Performance Ads | Awareness Ads (Tiger) |
|---------|----------------|----------------------|
| Sales Metrics | **Required** (GMV/Orders/ROAS) | **Prohibited** (no sales) |
| Breakdown | **Daily** (one per day per campaign) | **Monthly** (single aggregate) |
| ad_daily_performance | **Created** (analytics) | **NOT created** |
| Accrual P&L | **Included** (performance cost) | **Excluded** (awareness only) |
| Optimization | **Daily ROI tracking** | **No optimization** |
| Purpose | Conversion tracking | Brand awareness |
| Import Frequency | Daily or multi-day | Monthly |

---

## Awareness Ads (Tiger) - Monthly Cash Treatment

### What is Tiger Awareness Import?

Tiger Awareness Import is a **special import feature** for monthly awareness/reach/video view campaigns that:
- **Do NOT have sales metrics** (no GMV/Orders/ROAS)
- Are **brand awareness campaigns only**
- Must be tracked as **monthly cash outflow** in wallet
- **Do NOT affect Accrual P&L** (not performance ads)
- **Show ONLY in Cashflow Summary** (cash-based view)

---

### Why Monthly Aggregation?

Unlike performance ads which are tracked daily for ROI analysis, awareness campaigns are:
1. **Not optimized for conversions** - they measure reach/impressions/views
2. **Cannot be tied to revenue** - no sales attribution
3. **Purchased in monthly packages** - spending happens over the month
4. **Cash tracking purpose only** - we only care about total spend

**Example:**
```
Performance Ads (Daily):
Day 1: Spend ฿1,000, Revenue ฿3,000, ROAS = 3.0 ✅ Track daily for optimization

Awareness Ads (Monthly):
Month Dec: Spend ฿50,000, Reach 500K people, Views 2M ✅ Track once per month
```

---

### Import Requirements

**File Format:**
- Must be `.xlsx` (Excel format)
- Filename must contain "Tiger" OR "Campaign Report"
- Date range format: `(YYYY-MM-DD to YYYY-MM-DD)` in filename

**Required Columns:**
- Campaign (name)
- Cost (spend amount)
- Currency (optional, defaults to THB)

**Must NOT Have (Validation):**
- GMV / Orders / ROAS / Conversion Value / CPA / Purchase
- If these columns exist → **BLOCKED** (must use Performance Ads Import)

**Example Filename:**
```
Tiger x CoolSmile - client's credit card-Campaign Report-(2024-12-01 to 2024-12-31).xlsx
```

---

### What Happens During Import?

1. **File Validation:**
   - Check file extension (.xlsx)
   - Check filename contains "Tiger" or "Campaign Report"
   - Verify date range exists in filename
   - Validate template (must have Campaign + Cost, must NOT have sales metrics)

2. **Deduplication:**
   - Calculate SHA256 hash of file content
   - Check if file already imported
   - If duplicate → REJECT with message

3. **Data Aggregation (MONTHLY):**
   - Sum total Cost across ALL campaigns in file
   - Extract report end date (posting date)
   - Create import_batch record

4. **Wallet Entry Creation (1 entry only):**
   ```
   wallet_ledger:
     entry_type: SPEND
     direction: OUT
     amount: [total monthly spend]
     date: [report end date]
     source: IMPORTED
     import_batch_id: [batch id]
     note: "Monthly Awareness Spend (Tiger) - YYYY-MM"
   ```

5. **Where It Appears:**
   - ✅ Cashflow Summary (as cash outflow)
   - ✅ Wallet ledger table
   - ❌ Accrual P&L (excluded)
   - ❌ Ads performance analytics (excluded)

---

### Business Rules

1. **Tiger Import → Wallet ONLY**
   - Creates wallet SPEND entry ONLY
   - Does NOT create ad_daily_performance records
   - Does NOT affect Accrual P&L calculation

2. **ADS Wallet Rules Still Apply:**
   - SPEND must be IMPORTED (enforced)
   - Entry is immutable (cannot edit/delete)
   - Requires import_batch_id

3. **Monthly = Single Entry:**
   - One file = One wallet entry
   - No daily breakdown
   - Posting date = Report end date

4. **Currency Support:**
   - Defaults to THB if not specified
   - Respects currency from file if provided

---

### Common Mistakes Prevented

**❌ Mistake: Treating Awareness as Performance Ads**
- **Wrong:** Import Tiger report → Create daily ad_daily_performance records
- **Why wrong:** Awareness campaigns have no sales data, cannot calculate ROI
- **System prevention:** Template validation blocks files with sales metrics

**❌ Mistake: Importing into P&L**
- **Wrong:** Tiger spend shows up as "Advertising Cost" in Daily P&L
- **Why wrong:** P&L should only show performance-driven ad spend (with ROAS)
- **System prevention:** Tiger imports are wallet-only, excluded from P&L queries

**❌ Mistake: Daily Splitting**
- **Wrong:** Divide ฿50,000/30 days = ฿1,667/day and create daily entries
- **Why wrong:** Unnecessary complexity, awareness isn't optimized daily
- **System prevention:** Import logic creates single monthly entry only

---

### Example: Tiger vs Performance Import

**Performance Ads (Daily):**
```
File: TikTok Ads Report - Daily Performance (2024-12-01 to 2024-12-31).xlsx
Columns: Date, Campaign, Spend, GMV, Orders, ROAS

Import Result:
→ 31 ad_daily_performance records (one per day)
→ 31 wallet_ledger SPEND entries (one per day)
→ Shows in Accrual P&L (Advertising Cost)
→ Shows in Ads Analytics (ROI tracking)
```

**Awareness Ads (Monthly):**
```
File: Tiger x CoolSmile - Campaign Report-(2024-12-01 to 2024-12-31).xlsx
Columns: Campaign, Cost, Currency

Import Result:
→ 0 ad_daily_performance records
→ 1 wallet_ledger SPEND entry (monthly total)
→ Does NOT show in Accrual P&L
→ Shows in Cashflow Summary ONLY
```

---

### File Location & Code

**Import Logic:**
- `frontend/src/app/(dashboard)/wallets/tiger-import-actions.ts`

**UI Component:**
- `frontend/src/components/wallets/TigerImportDialog.tsx`

**Integration:**
- Wallets page: Import button visible for ADS wallet only

---

## Summary: Key Takeaways

1. **2 Views = 2 Purposes**
   - Accrual P&L → Performance (profit/loss)
   - Cashflow Summary → Liquidity (cash availability)

2. **ADS Wallet Rules (STRICT)**
   - Ad Spend = Ads Report ONLY
   - Top-up ≠ Expense
   - Manual SPEND = BLOCKED

3. **Tiger Awareness = Cash Tracking ONLY**
   - Monthly aggregation (1 entry per file)
   - Wallet SPEND only (no P&L impact)
   - No sales metrics (awareness campaigns only)
   - Shows in Cashflow Summary ONLY

4. **Data Integrity**
   - IMPORTED entries = immutable
   - Source of truth = platform reports
   - Manual entries = auditable with notes

5. **Scalable Design**
   - Add new wallets without schema changes
   - Wallet types define behavior
   - Business rules enforced at server-side

---

## Contact & Questions

For questions about business rules or accounting logic:
- Review this document first
- Check `CLAUDE.md` for system architecture
- See `wallets/actions.ts` for validation logic
- See `wallets/tiger-import-actions.ts` for Tiger import logic
- Test with `WALLET_VERIFICATION.md` checklist

---

**Last Updated:** 2026-01-23
**Version:** 1.1 (Tiger Awareness Import Added)
