# Future Scale & Risk Analysis

**Purpose:** Analyze risks as system scales and propose mitigation strategies (NO CODE)
**Date:** 2026-01-19
**Scope:** Future-looking analysis for growth planning

---

## 1. DATA VOLUME RISKS

### Risk 1.1: Large Dataset Performance Degradation
**Current State:**
- Queries fetch all matching records (no LIMIT on aggregations)
- Dashboard loads 7 days of data
- P&L/Cashflow load 1 day at a time

**Trigger Points:**
- 10,000+ orders per month
- 1,000+ expenses per month
- 100,000+ total records

**Symptoms:**
- Dashboard load time > 3 seconds
- P&L queries slow
- User experience degradation

**Impact:** HIGH
**Likelihood:** MEDIUM (depends on business growth)

**Mitigation Strategies:**

1. **Query Optimization**
   ```
   Priority: HIGH
   Effort: LOW

   - Add database indexes:
     * sales_orders: (order_date, status, user_id)
     * expenses: (expense_date, category, user_id)

   - Use LIMIT on aggregation queries when appropriate
   - Add query result caching (Redis)
   ```

2. **Pagination for Large Date Ranges**
   ```
   Priority: MEDIUM
   Effort: MEDIUM

   - Limit cashflow range queries to max 90 days
   - Add "load more" functionality for long ranges
   - Warn user if selecting very long date range
   ```

3. **Database Partitioning**
   ```
   Priority: LOW (only if 1M+ records)
   Effort: HIGH

   - Partition tables by month/year
   - Archive old data after 2 years
   - Keep hot data in fast storage
   ```

---

### Risk 1.2: Running Balance Calculation Becomes Slow
**Current State:**
- Cashflow range queries calculate running balance sequentially
- Each date fetched in parallel, then accumulated

**Trigger Points:**
- Date ranges > 90 days
- Multiple concurrent users requesting long ranges

**Impact:** MEDIUM
**Likelihood:** LOW

**Mitigation Strategies:**

1. **Pre-calculated Balance Table**
   ```
   Priority: LOW
   Effort: MEDIUM

   - Create daily_balance table
   - Update via trigger or scheduled job
   - Query from cached table instead of calculating
   ```

2. **Limit Maximum Date Range**
   ```
   Priority: MEDIUM
   Effort: LOW

   - Restrict cashflow range to 90 days max
   - Show error if user selects longer
   - Provide alternative: export to CSV for long ranges
   ```

---

## 2. MULTI-USER GROWTH RISKS

### Risk 2.1: Concurrent User Load
**Current State:**
- No caching layer
- Each page load queries database directly
- No rate limiting

**Trigger Points:**
- 20+ concurrent users
- Multiple users viewing dashboard simultaneously
- Peak hours traffic

**Impact:** MEDIUM
**Likelihood:** LOW (internal tool, <5 users planned)

**Mitigation Strategies:**

1. **Redis Cache Layer**
   ```
   Priority: MEDIUM
   Effort: MEDIUM

   - Cache dashboard stats (TTL: 5 minutes)
   - Cache Daily P&L results (TTL: 1 hour)
   - Invalidate on new data entry
   ```

2. **Connection Pooling**
   ```
   Priority: HIGH (if scaling beyond 10 users)
   Effort: LOW

   - Configure Supabase connection pool
   - Set appropriate pool size
   - Monitor connection usage
   ```

3. **CDN for Static Assets**
   ```
   Priority: LOW
   Effort: LOW

   - Use CDN for JS/CSS assets
   - Reduce load on application server
   ```

---

### Risk 2.2: User Data Isolation Failure
**Current State:**
- RLS enforced at database level
- All queries include user context

**Trigger Points:**
- Code changes bypass RLS
- RLS policies misconfigured
- Security vulnerability introduced

**Impact:** CRITICAL
**Likelihood:** VERY LOW (but catastrophic if occurs)

**Mitigation Strategies:**

1. **RLS Policy Testing**
   ```
   Priority: HIGH
   Effort: LOW

   - Add automated tests for RLS
   - Test data isolation between users
   - Verify in staging before production
   ```

2. **Security Audit**
   ```
   Priority: HIGH (before external users)
   Effort: MEDIUM

   - Review all server actions
   - Verify auth checks present
   - Penetration testing
   ```

3. **Read-Only API Keys**
   ```
   Priority: MEDIUM
   Effort: LOW

   - Use separate API keys for read vs write
   - Limit blast radius if key compromised
   ```

---

## 3. IMPORT AUTOMATION RISKS

### Risk 3.1: CSV Import Data Quality
**Current State:**
- No CSV import yet (future feature)
- Manual entries only

**Trigger Points:**
- CSV import feature added
- Bulk data imports from marketplaces
- Automated daily imports

**Impact:** HIGH (incorrect data → wrong decisions)
**Likelihood:** HIGH (if CSV import added)

**Mitigation Strategies:**

1. **Import Validation Layer**
   ```
   Priority: CRITICAL (when building CSV import)
   Effort: MEDIUM

   Required Validations:
   - Date format validation
   - Amount validation (positive, 2 decimals)
   - Category validation (enum check)
   - Duplicate detection
   - Total row count limits

   Fail-Safe:
   - Never overwrite manual entries (check source field)
   - Import to staging table first
   - Require manual approval before committing
   ```

2. **Import Audit Trail**
   ```
   Priority: HIGH
   Effort: LOW

   - Log all imports (filename, timestamp, user, row count)
   - Store original file for 30 days
   - Enable import rollback if errors found
   ```

3. **Reconciliation Report**
   ```
   Priority: HIGH
   Effort: MEDIUM

   - Show before/after comparison
   - Flag suspicious changes (e.g., revenue drop 50%)
   - Require user confirmation
   ```

---

### Risk 3.2: Duplicate Data from Multiple Sources
**Current State:**
- Single data source (manual entry)
- Order IDs auto-generated (MAN-YYYYMMDD-XXX)

**Trigger Points:**
- CSV imports enabled
- API integrations added
- Multiple marketplaces importing daily

**Impact:** HIGH (inflated revenue numbers)
**Likelihood:** HIGH (if multiple sources added)

**Mitigation Strategies:**

1. **Unique Constraint on order_id**
   ```
   Priority: CRITICAL
   Effort: LOW

   - Add UNIQUE constraint to order_id column
   - Reject duplicate imports at database level
   - Log duplicate attempts for investigation
   ```

2. **Import Deduplication Logic**
   ```
   Priority: HIGH
   Effort: MEDIUM

   - Check for existing order_id before insert
   - Match on (date + marketplace + amount) if no order_id
   - Warn user about potential duplicates
   ```

3. **Source Priority Rules**
   ```
   Priority: MEDIUM
   Effort: LOW

   - Manual > API > CSV (in case of conflicts)
   - Document rule clearly
   - Enforce in import logic
   ```

---

## 4. TIMEZONE EXPANSION RISKS

### Risk 4.1: Multi-Timezone Operations
**Current State:**
- Hardcoded Asia/Bangkok timezone (+07:00)
- Assumes single timezone

**Trigger Points:**
- Business expands to other countries
- Users in different timezones
- Need for UTC standardization

**Impact:** MEDIUM
**Likelihood:** LOW (single-country operation)

**Mitigation Strategies:**

1. **User Timezone Preference**
   ```
   Priority: LOW (only if multi-country)
   Effort: HIGH

   - Add timezone field to user profile
   - Convert all displays to user timezone
   - Store all dates in UTC in database
   ```

2. **Explicit Timezone Handling**
   ```
   Priority: HIGH (before cloud deploy)
   Effort: MEDIUM

   - Install date-fns-tz
   - Replace all new Date() with toZonedTime()
   - Standardize on Asia/Bangkok explicitly
   ```

---

### Risk 4.2: Cloud Deployment Timezone Mismatch
**Current State:**
- Code assumes server timezone = Asia/Bangkok
- Works if deployed to Bangkok datacenter
- Breaks if deployed to UTC cloud (AWS, Vercel, etc.)

**Trigger Points:**
- Deploy to cloud platform (Vercel, AWS, GCP)
- Server timezone is UTC by default

**Impact:** CRITICAL (all dates wrong by 7 hours)
**Likelihood:** HIGH (if cloud deploy without fix)

**Mitigation Strategies:**

1. **Fix Before Cloud Deploy (REQUIRED)**
   ```
   Priority: CRITICAL
   Effort: MEDIUM

   Steps:
   1. Install date-fns-tz
   2. Replace all date logic with explicit timezone
   3. Test thoroughly with UTC server
   4. Verify dates match expectations

   Files to fix:
   - lib/daily-pl.ts
   - lib/finance/marketplace-wallets.ts
   - app/(dashboard)/actions.ts
   - sales/actions.ts
   ```

2. **Server Timezone Configuration**
   ```
   Priority: MEDIUM (alternative to code fix)
   Effort: LOW

   - Set TZ=Asia/Bangkok environment variable
   - Verify in deployment config
   - Document in README
   ```

---

## 5. CACHE REQUIREMENT RISKS

### Risk 5.1: Stale Data Visibility
**Current State:**
- No caching (always fresh data)
- Every page load queries database

**Trigger Points:**
- Cache layer added for performance
- Multiple users see different values
- Cache invalidation bugs

**Impact:** MEDIUM
**Likelihood:** MEDIUM (if cache added)

**Mitigation Strategies:**

1. **Short TTL for Financial Data**
   ```
   Priority: HIGH
   Effort: LOW

   - Dashboard stats: 5 minutes max
   - P&L results: 10 minutes max
   - Never cache for more than 1 hour
   ```

2. **Cache Invalidation on Write**
   ```
   Priority: HIGH
   Effort: MEDIUM

   - Clear relevant cache keys on insert/update
   - Invalidate user-specific cache only
   - Use cache tagging for smart invalidation
   ```

3. **Cache Bypass for Real-Time Needs**
   ```
   Priority: MEDIUM
   Effort: LOW

   - Add "Refresh" button to force fresh data
   - Show cache timestamp ("as of X minutes ago")
   - Allow user to bypass cache
   ```

---

### Risk 5.2: Cache Synchronization Issues
**Current State:**
- N/A (no cache yet)

**Trigger Points:**
- Multiple app instances behind load balancer
- Redis cache added
- Race conditions between writes

**Impact:** MEDIUM
**Likelihood:** LOW (internal tool, likely single instance)

**Mitigation Strategies:**

1. **Centralized Cache (Redis)**
   ```
   Priority: MEDIUM
   Effort: MEDIUM

   - Use single Redis instance
   - All app instances share cache
   - Atomic cache operations
   ```

2. **Cache Version Keys**
   ```
   Priority: LOW
   Effort: MEDIUM

   - Include version number in cache keys
   - Invalidate all on version change
   - Safe deployment strategy
   ```

---

## 6. FINANCIAL CALCULATION RISKS

### Risk 6.1: Floating Point Accumulation Errors
**Current State:**
- All calculations round to 2 decimals (HARDENED)
- Running balance re-rounded each step

**Trigger Points:**
- Very large cumulative sums (> ฿1,000,000,000)
- Thousands of transactions per day
- Years of accumulated running balance

**Impact:** LOW (rounding already applied)
**Likelihood:** VERY LOW

**Mitigation Strategies:**

1. **Periodic Balance Reconciliation**
   ```
   Priority: LOW
   Effort: LOW

   - Monthly: Recalculate running balance from scratch
   - Compare with accumulated value
   - Alert if difference > ฿0.10
   ```

2. **Use Decimal Type in Database**
   ```
   Priority: LOW (only if issues observed)
   Effort: HIGH

   - Change amount columns to DECIMAL(15,2)
   - Ensures exact precision in database
   - Application still needs rounding
   ```

---

### Risk 6.2: Business Logic Changes
**Current State:**
- Formula: Net Profit = Revenue - Ads - COGS - Operating
- Well documented and hardened

**Trigger Points:**
- Business requirements change (new expense category, tax, etc.)
- Formula modifications needed
- Refactoring attempts

**Impact:** CRITICAL (wrong numbers → wrong decisions)
**Likelihood:** MEDIUM (business needs evolve)

**Mitigation Strategies:**

1. **Change Control Process**
   ```
   Priority: HIGH
   Effort: LOW

   Required for any formula change:
   1. Document new business requirement
   2. Get written approval from owner
   3. Update BUSINESS_RULES_AUDIT.md
   4. Add test cases to FINANCIAL_CORRECTNESS_QA.md
   5. Run full QA before deploying
   6. Announce change to all users
   ```

2. **Version Control for Formulas**
   ```
   Priority: MEDIUM
   Effort: MEDIUM

   - Tag releases with formula version
   - Keep changelog of formula changes
   - Enable comparison between versions
   ```

3. **Automated Formula Testing**
   ```
   Priority: HIGH
   Effort: HIGH

   - Write unit tests for all calculations
   - Include known-answer tests
   - Run on every deploy
   - Block deploy if tests fail
   ```

---

## 7. COMPLIANCE & AUDIT RISKS

### Risk 7.1: Tax Authority Audit
**Current State:**
- Audit trail exists (source, created_by, created_at)
- No tax-specific fields yet

**Trigger Points:**
- Tax audit from authorities
- Need to prove revenue/expense numbers
- Export requirements for accountants

**Impact:** HIGH (regulatory)
**Likelihood:** MEDIUM (depends on business size)

**Mitigation Strategies:**

1. **Immutable Audit Log**
   ```
   Priority: HIGH (before external use)
   Effort: MEDIUM

   - Log all modifications to separate table
   - Store before/after values
   - Include user, timestamp, reason
   - Make append-only (no deletes)
   ```

2. **Export for Accountants**
   ```
   Priority: HIGH
   Effort: LOW

   - Export to CSV with all fields
   - Include audit trail columns
   - Format for tax software import
   ```

3. **Backup & Retention Policy**
   ```
   Priority: HIGH
   Effort: LOW

   - Daily database backups
   - Retain for 7 years (tax requirement)
   - Test restore process quarterly
   ```

---

### Risk 7.2: Financial Reporting Requirements
**Current State:**
- Real-time P&L available
- No historical comparison yet
- No month-end close process

**Trigger Points:**
- Need for monthly reports
- Year-over-year comparisons
- Accountant requirements

**Impact:** MEDIUM
**Likelihood:** HIGH (business necessity)

**Mitigation Strategies:**

1. **Month-End Snapshots**
   ```
   Priority: MEDIUM
   Effort: MEDIUM

   - Create monthly_summary table
   - Store P&L snapshot at month end
   - Enable historical comparison
   - Freeze past months (no retroactive changes)
   ```

2. **Report Templates**
   ```
   Priority: LOW
   Effort: LOW

   - Pre-defined report layouts
   - Export to PDF/Excel
   - Include company branding
   ```

---

## 8. DEPLOYMENT & INFRASTRUCTURE RISKS

### Risk 8.1: Single Point of Failure
**Current State:**
- Single Supabase instance
- No redundancy

**Trigger Points:**
- Supabase outage
- Database corruption
- Network issues

**Impact:** HIGH (business stops)
**Likelihood:** LOW (Supabase has HA)

**Mitigation Strategies:**

1. **Backup Strategy**
   ```
   Priority: HIGH
   Effort: LOW

   - Enable Supabase automated backups
   - Test restore process
   - Document recovery procedure
   - RTO: 4 hours, RPO: 24 hours
   ```

2. **Monitoring & Alerts**
   ```
   Priority: MEDIUM
   Effort: MEDIUM

   - Health check endpoint
   - Alert on errors/downtime
   - Monitor query performance
   ```

---

### Risk 8.2: Deployment Errors
**Current State:**
- Manual deployment (likely)
- No CI/CD pipeline

**Trigger Points:**
- Deploy wrong code version
- Environment config missing
- Breaking changes deployed

**Impact:** HIGH
**Likelihood:** MEDIUM (manual process)

**Mitigation Strategies:**

1. **Staging Environment**
   ```
   Priority: HIGH
   Effort: MEDIUM

   - Deploy to staging first
   - Test with real-like data
   - Verify before production
   ```

2. **Rollback Plan**
   ```
   Priority: HIGH
   Effort: LOW

   - Tag releases in git
   - Document rollback procedure
   - Keep previous version ready
   ```

3. **CI/CD Pipeline**
   ```
   Priority: MEDIUM (nice-to-have)
   Effort: HIGH

   - Automated tests on commit
   - Automated deployment
   - Gradual rollout
   ```

---

## PRIORITY MATRIX

### CRITICAL (Do First)
1. Fix timezone before cloud deploy
2. Add unique constraint on order_id (before CSV import)
3. RLS policy testing (before external users)
4. Change control process for formulas

### HIGH (Do Soon)
1. Database indexes for performance
2. Backup & retention policy
3. Import validation layer (when building CSV feature)
4. Audit log for modifications

### MEDIUM (Do When Needed)
1. Redis cache layer (if >10 users)
2. Connection pooling (if >10 users)
3. Month-end snapshots
4. Staging environment

### LOW (Do If Time Permits)
1. Database partitioning (only if 1M+ records)
2. Pre-calculated balance table
3. Multi-timezone support
4. CDN for static assets

---

## RISK SCORES

| Risk | Impact | Likelihood | Score | Priority |
|------|--------|-----------|-------|----------|
| Cloud timezone mismatch | CRITICAL | HIGH | **CRITICAL** | 1 |
| Duplicate imports | HIGH | HIGH | **HIGH** | 2 |
| User data isolation failure | CRITICAL | VERY LOW | **HIGH** | 3 |
| Import data quality | HIGH | HIGH | **HIGH** | 4 |
| Formula changes | CRITICAL | MEDIUM | **HIGH** | 5 |
| Large dataset performance | HIGH | MEDIUM | **MEDIUM** | 6 |
| Tax audit | HIGH | MEDIUM | **MEDIUM** | 7 |
| Deployment errors | HIGH | MEDIUM | **MEDIUM** | 8 |
| Concurrent user load | MEDIUM | LOW | **LOW** | 9 |
| Floating point errors | LOW | VERY LOW | **VERY LOW** | 10 |

---

## SUMMARY & RECOMMENDATIONS

### What to Do Next (Ordered)

**Phase 1: Pre-Cloud Deploy (MUST DO)**
1. Fix timezone handling (CRITICAL)
2. Test with UTC server
3. Set up backups
4. Document rollback procedure

**Phase 2: Before Scaling (Do if >10 users)**
5. Add database indexes
6. Set up Redis cache
7. Configure connection pooling
8. Add monitoring/alerts

**Phase 3: Before CSV Import (Do when building feature)**
9. Add unique constraint on order_id
10. Build validation layer
11. Implement audit log
12. Create reconciliation report

**Phase 4: Before External Users (Do if opening to public)**
13. Security audit
14. RLS policy testing
15. Penetration testing
16. Rate limiting

---

## CONCLUSION

**Current System:** Well-hardened, ready for internal use with real money

**Key Risks:** Timezone (CRITICAL), CSV imports (HIGH), Scale (MEDIUM)

**Mitigation:** Most risks have clear, documented mitigation strategies

**Confidence:** HIGH for current scope, documented path for future growth

---

*Last Updated: 2026-01-19*
*Analysis Type: Future-Looking, No Code*
*Purpose: Growth Planning & Risk Management*
