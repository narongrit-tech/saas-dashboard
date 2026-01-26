# Business Rules (Authoritative)

## Daily P&L (Core Metric)
- **Revenue** = Sales orders that are completed + pending **(exclude cancelled)**.
- **Advertising Cost** = Expenses where category = `Advertising`.
- **COGS** = Expenses where category = `COGS`.
- **Operating** = Expenses where category = `Operating`.
- **Net Profit** = Revenue - Advertising - COGS - Operating.

## CEO Commission Flow (TikTok)
- TikTok pays commission into the CEO personal account.
- CEO may keep some personally.
- Remaining amount transferred to company = **Director's Loan (CEO → Company)**.
- System must keep **Personal Income** and **Director's Loan** separated.

## Cashflow vs Accrual
- **Accrual P&L (Performance)**: Revenue - Ad Spend (from reports) - COGS - Operating.
- **Cashflow Summary (Liquidity)**: Cash in/out + wallet movements.

## Company Cashflow
- **Cash In** = sum of settlement transactions.
- **Cash Out** = sum of expenses + wallet TOP_UP amounts.
- **Net Cashflow** = Cash In - Cash Out.
- **Running Balance** = cumulative net across the selected range.

## P&L vs Cashflow Reconciliation
- **Bridge items** explain the gap between accrual profit and cashflow.
- Verification formula:
  - `Accrual Net Profit + Total Bridge = Cashflow Net`.
- Bridge items currently include:
  1. Revenue not yet settled.
  2. Wallet top-ups (cash out, not an expense).
  3. Ad timing differences (placeholder when data is missing).

## Multi-Wallet Rules (Strict)
1. **ADS Wallet - SPEND Source Lock**
   - Ad Spend **must** come from Ads Reports only (`source=IMPORTED`).
   - Manual SPEND creation is blocked.

2. **Top-up is NOT an Expense**
   - Wallet top-up is a cash transfer, not a P&L expense.
   - Only actual Ad Spend (from reports) affects P&L.

3. **Subscription Wallet Rules**
   - Manual SPEND entries are allowed for subscription/SaaS costs.

4. **Immutable IMPORTED Entries**
   - `source=IMPORTED` entries cannot be edited or deleted.
   - Fix errors by updating the source file and re-importing.

5. **Entry Type + Direction Validation**
   - TOP_UP → **IN** only.
   - SPEND → **OUT** only.
   - REFUND → **IN** only.
   - ADJUSTMENT → **IN** or **OUT**.

## Ads Import Business Impact
- **Performance Ads (Product/Live)** create:
  - `ad_daily_performance` rows (analytics).
  - `wallet_ledger` SPEND entries (affects accrual P&L).
- **Tiger Awareness Ads** create:
  - `wallet_ledger` SPEND entries only (cashflow-only, no P&L impact).

## Bank Module Rules
- Opening balance formula:
  - `Opening = First Balance - First Deposit + First Withdrawal`.
- Daily aggregation uses Bangkok timezone.

## Expenses Subcategory
- Subcategory is optional and does **not** change the Daily P&L formula.
- P&L uses the main category only (Advertising/COGS/Operating).

## Related Detailed Docs
- Import formats, templates, and dedup rules: `docs/instructions/import-dedup.md`.
- Data integrity and security rules: `docs/instructions/data-integrity.md`.
- Architecture + feature map: `docs/instructions/architecture.md`.
