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

## Summary: Key Takeaways

1. **2 Views = 2 Purposes**
   - Accrual P&L → Performance (profit/loss)
   - Cashflow Summary → Liquidity (cash availability)

2. **ADS Wallet Rules (STRICT)**
   - Ad Spend = Ads Report ONLY
   - Top-up ≠ Expense
   - Manual SPEND = BLOCKED

3. **Data Integrity**
   - IMPORTED entries = immutable
   - Source of truth = platform reports
   - Manual entries = auditable with notes

4. **Scalable Design**
   - Add new wallets without schema changes
   - Wallet types define behavior
   - Business rules enforced at server-side

---

## Contact & Questions

For questions about business rules or accounting logic:
- Review this document first
- Check `CLAUDE.md` for system architecture
- See `wallets/actions.ts` for validation logic
- Test with `WALLET_VERIFICATION.md` checklist

---

**Last Updated:** 2026-01-23
**Version:** 1.0 (Multi-Wallet Foundation)
