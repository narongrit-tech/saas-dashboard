# Test Scenario: TikTok Product Ads (Thai Headers)

## File Structure
- Sheet name: "Data"
- Header row: Row 1
- Headers (Thai):
  - วันเริ่มต้น
  - ชื่อแคมเปญ
  - ต้นทุน
  - รายได้ขั้นต้น
  - ยอดการซื้อ

## Expected Behavior
1. findBestSheet should:
   - Scan rows 1-30 for header
   - Find "วันเริ่มต้น" → map to date
   - Find "ชื่อแคมเปญ" → map to campaign_name
   - Find "ต้นทุน" → map to spend
   - Find "รายได้ขั้นต้น" → map to revenue
   - Find "ยอดการซื้อ" → map to orders
   - Score: 40+ (exact matches)

2. Preview should return:
   - success: true
   - summary with totalSpend, totalOrders, totalRevenue
   - detectedColumns showing Thai column names
   - campaignType: product

## If Error (Debug Details):
- scannedSheets: ['Data']
- headerRows: { Data: 0 }
- scores: { Data: 40+ }
- detectedColumns: { date: 'วันเริ่มต้น', spend: 'ต้นทุน', ... }
- missingColumns: [] (if all found)
