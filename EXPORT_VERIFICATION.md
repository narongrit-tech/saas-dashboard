# CSV Export Feature - Manual Verification Checklist

**Created:** 2026-01-23 (Phase 2B)
**Purpose:** Verify CSV export functionality for Sales Orders and Expenses

---

## Overview

CSV Export feature allows users to export filtered data to CSV files readable by Excel and Google Sheets.

**Key Features:**
- Server-side CSV generation (no client-side processing)
- Respects all active filters (marketplace/category, date range, search)
- Filename includes Bangkok timezone timestamp
- Proper CSV escaping (handles commas, quotes, newlines)
- UTF-8 encoding for Thai characters

---

## Test Prerequisites

Before testing, ensure you have:
- [ ] Sales Orders with various marketplaces (TikTok, Shopee, Lazada, etc.)
- [ ] Sales Orders with different statuses (Completed, Pending, Cancelled)
- [ ] Expenses with all 3 categories (Advertising, COGS, Operating)
- [ ] Data spanning multiple dates
- [ ] Some records with special characters in names/descriptions (commas, quotes, Thai text)

---

## 1. Sales Orders Export - Basic Tests

### 1.1 Export All Data (No Filters)
- [ ] Navigate to Sales Orders page
- [ ] Clear all filters (Marketplace = "All", no date range, no search)
- [ ] Click "Export CSV" button
- [ ] Verify file downloads with name format: `sales-orders-YYYYMMDD-HHMMSS.csv`
- [ ] Verify timestamp is in Bangkok timezone (UTC+7)

**Expected CSV Headers:**
```
Order ID,Marketplace,Product Name,Quantity,Unit Price,Total Amount,Status,Order Date,Created At
```

### 1.2 Export with Marketplace Filter
- [ ] Select a specific marketplace (e.g., "TikTok")
- [ ] Click "Export CSV"
- [ ] Open CSV and verify all rows have the selected marketplace
- [ ] Verify row count matches filtered view

### 1.3 Export with Date Range
- [ ] Set Start Date and End Date
- [ ] Click "Export CSV"
- [ ] Verify all exported orders fall within the date range
- [ ] Verify End Date includes records from entire day (not just up to 00:00)

### 1.4 Export with Search Filter
- [ ] Enter search term (e.g., partial order ID or product name)
- [ ] Click "Export CSV"
- [ ] Verify all exported rows contain the search term in Order ID or Product Name

### 1.5 Export with Multiple Filters
- [ ] Combine: Marketplace + Date Range + Search
- [ ] Click "Export CSV"
- [ ] Verify exported data matches all filter criteria

---

## 2. Expenses Export - Basic Tests

### 2.1 Export All Data (No Filters)
- [ ] Navigate to Expenses page
- [ ] Clear all filters (Category = "ทั้งหมด", no date range, no search)
- [ ] Click "Export CSV" button
- [ ] Verify file downloads with name format: `expenses-YYYYMMDD-HHMMSS.csv`

**Expected CSV Headers:**
```
Expense Date,Category,Amount,Description,Notes,Created At
```

### 2.2 Export with Category Filter
- [ ] Select a specific category (e.g., "ค่าโฆษณา" / Advertising)
- [ ] Click "Export CSV"
- [ ] Open CSV and verify all rows have the selected category
- [ ] Verify categories are in English ("Advertising", "COGS", "Operating")

### 2.3 Export with Date Range
- [ ] Set Start Date and End Date
- [ ] Click "Export CSV"
- [ ] Verify all exported expenses fall within the date range

### 2.4 Export with Search Filter
- [ ] Enter search term (e.g., part of description)
- [ ] Click "Export CSV"
- [ ] Verify all exported rows contain the search term in Description or Notes

### 2.5 Export with Multiple Filters
- [ ] Combine: Category + Date Range + Search
- [ ] Click "Export CSV"
- [ ] Verify exported data matches all filter criteria

---

## 3. CSV Format & Encoding Tests

### 3.1 Special Characters Handling

**Test Data to Create:**
1. Sales Order with product name: `Product, "Special" Name`
2. Sales Order with product name containing newline
3. Expense with description: `Description with "quotes" and, commas`

**Verification:**
- [ ] Export data containing special characters
- [ ] Open CSV in Excel/Google Sheets
- [ ] Verify data displays correctly (no broken rows)
- [ ] Verify commas inside fields don't break CSV parsing
- [ ] Verify quotes are properly escaped (`""`)

### 3.2 Thai Character Encoding
- [ ] Export data containing Thai text
- [ ] Open CSV in Excel/Google Sheets
- [ ] Verify Thai characters display correctly (not garbled)
- [ ] Encoding should be UTF-8

### 3.3 Numeric Precision
- [ ] Verify amounts show 2 decimal places in CSV
- [ ] Verify no scientific notation for large numbers
- [ ] Verify negative amounts (if any) display correctly

---

## 4. Edge Cases & Error Handling

### 4.1 Empty Result Set
- [ ] Apply filters that return no results
- [ ] Verify "Export CSV" button is **disabled**
- [ ] If enabled, clicking should show error: "ไม่พบข้อมูลที่จะ export"

### 4.2 Large Dataset Export
- [ ] Export with 100+ records (if available)
- [ ] Verify export completes without timeout
- [ ] Verify all records are included in CSV
- [ ] Note: Current limit is 10,000 records per export

### 4.3 Concurrent Exports
- [ ] Open Sales and Expenses pages in separate tabs
- [ ] Export from both simultaneously
- [ ] Verify both files download correctly with unique filenames

### 4.4 Button States
- [ ] Verify "Export CSV" button shows "Exporting..." during process
- [ ] Verify button is disabled while exporting
- [ ] Verify button re-enables after completion

---

## 5. File Compatibility Tests

### 5.1 Open in Microsoft Excel
- [ ] Export a CSV file
- [ ] Open in Microsoft Excel
- [ ] Verify:
  - All columns display correctly
  - Thai characters display correctly
  - Numbers format correctly
  - Dates display correctly

### 5.2 Open in Google Sheets
- [ ] Export a CSV file
- [ ] Upload to Google Sheets (File → Import)
- [ ] Select "Import" with UTF-8 encoding
- [ ] Verify same criteria as Excel

### 5.3 Re-import Test (Future)
- [ ] Export Sales Orders
- [ ] Note: CSV Import not yet implemented
- [ ] File format is ready for future import feature

---

## 6. Business Logic Verification

### 6.1 Sales Orders - Cancelled Status
- [ ] Export Sales Orders including cancelled orders
- [ ] Verify cancelled orders have `Status = "Cancelled"`
- [ ] Note: Total Amount for cancelled orders should be 0 (verify in CSV)

### 6.2 Expenses - Category Values
- [ ] Export Expenses
- [ ] Verify Category column contains only: "Advertising", "COGS", "Operating"
- [ ] No other category values should appear

### 6.3 Audit Fields
- [ ] Verify "Created At" timestamp is included in both exports
- [ ] Timestamps should be in ISO 8601 format
- [ ] Timezone in timestamps should be UTC (database storage format)

---

## 7. Security Tests

### 7.1 Authentication Required
- [ ] Log out of the application
- [ ] Attempt to access export endpoints directly (if possible)
- [ ] Verify: Should return authentication error

### 7.2 User Data Isolation (RLS)
- [ ] User A exports their data
- [ ] Log in as User B
- [ ] User B exports their data
- [ ] Verify: Each user only sees their own data (enforced by RLS)

---

## 8. Sample CSV Structure

### Sales Orders CSV Example:
```csv
Order ID,Marketplace,Product Name,Quantity,Unit Price,Total Amount,Status,Order Date,Created At
MAN-20260123-001,TikTok,Product A,2,150.00,300.00,Completed,2026-01-23,2026-01-23T10:30:00.000Z
MAN-20260123-002,Shopee,Product B,1,500.00,500.00,Pending,2026-01-23,2026-01-23T11:00:00.000Z
```

### Expenses CSV Example:
```csv
Expense Date,Category,Amount,Description,Notes,Created At
2026-01-23,Advertising,1500.00,Facebook Ads Campaign,January campaign,2026-01-23T09:00:00.000Z
2026-01-23,COGS,800.00,Product packaging,,2026-01-23T09:30:00.000Z
```

---

## 9. Known Limitations

1. **Export Limit:** Maximum 10,000 records per export (server safety)
2. **No Pagination in Export:** Exports all matching records (within limit)
3. **Server Timeout:** Very large exports (5,000+ records) may take 10-30 seconds
4. **Excel Date Import:** Excel may auto-format date columns - reformat as needed

---

## 10. Sign-Off

**Tester Name:** ___________________
**Test Date:** ___________________
**All Tests Passed:** [ ] Yes [ ] No

**Issues Found:**
1. ___________________________________
2. ___________________________________
3. ___________________________________

**Notes:**
___________________________________________
___________________________________________
___________________________________________

---

## Quick Test Summary

**Minimum Tests for Sign-Off:**
- [ ] Sales export with no filters (verify CSV opens in Excel)
- [ ] Sales export with marketplace filter
- [ ] Expenses export with no filters (verify CSV opens in Excel)
- [ ] Expenses export with category filter
- [ ] Thai characters display correctly in CSV
- [ ] Special characters (commas, quotes) handled correctly
- [ ] Filename includes Bangkok timezone timestamp
- [ ] Export button disabled when no data

**If all minimum tests pass → Feature is ready for production use.**
