proposed next step แบบลงมือทำได้ทันที

👉 ให้ Claude ทำรอบใหม่แบบ UX REBUILD (not patch)

ลำดับ:

เพิ่ม global date filter
refactor Overview → business-only
redesign Products → trend + top 50 + full list
redesign Shops → top 50 + full list
demote Data Health
เพิ่ม “pre-flight permission check” (สำคัญมากตามที่คุณขอ)
🔥 MASTER TASK PROMPT (ส่งให้ Claude Code ได้เลย)

ด้านล่างคือ prompt “ยาว + ครบ + จี้รายหน้า + บังคับ self-check”

🔧 SYSTEM INSTRUCTION
You are implementing Part 2: UX/Product restructuring for Content Ops.

Before doing any implementation:

1. Read ALL instructions in this prompt fully.
2. Perform a self-check:
   - Identify what data access, APIs, or permissions you need.
   - Identify missing data (e.g. thumbnails, time-series data, shop images).
   - Identify unclear requirements.

3. STOP and output a "PERMISSION & REQUIREMENT REQUEST" section:
   - List all required permissions
   - List all required data fields
   - List assumptions you are about to make
   - Ask for confirmation BEFORE starting implementation

Only proceed after confirmation.
🎯 GLOBAL REQUIREMENTS
Main UX goal:
- CEO/operator opens → understands business instantly

Required improvements:
- Add time context (date filter)
- Add visual recognition (thumbnails)
- Add trend visibility (7-day default)
- Show Top 50 clearly
- Keep full dataset accessible (no lazy hiding)

DO NOT:
- Promote profit/cost yet
- Merge with finance/wallet
- Keep dev-centric pages as main
- Hide data behind poor UX shortcuts
📄 PAGE-BY-PAGE SPEC (DETAILED)
1) OVERVIEW (REBUILD)
❗ MUST FIX
ADD:
- Global date filter (default = last 7 days)
- Sticky at top
🧠 STRUCTURE (FINAL)
[Date Filter]

[KPI]
- Order Items
- Products
- Shops
- Content IDs

[Status Breakdown]

[Top Products] (WITH IMAGE)
[Top Shops] (WITH IMAGE)

REMOVE:
- Data Health
- Next Actions
🔥 REQUIREMENTS
KPI
Must update based on date filter
Must load fast
Status
show % + count
clickable → filter downstream
Top Products
- MUST show thumbnail
- MUST show product name
- MUST show order count
- MUST be clickable
Top Shops
- same structure as products
- include visual (logo/image if exists)
❌ REMOVE
- Data Health
- Next Actions

👉 move to separate page only

2) PRODUCTS (FULL REDESIGN)
❗ CORE REQUIREMENT
This is NOT a table page.
This is a PERFORMANCE PAGE.
🔥 MUST HAVE
1. DATE FILTER (GLOBAL SYNC)
default: last 7 days
2. TOP 50 BLOCK (NEW SECTION)
Top 50 Products
- ranked
- big + clear
- visual-first

Each row:

[Thumbnail] Product Name
Order Items
Trend (7-day sparkline)
% change
Top Shop
3. TREND SPARKLINE (CRITICAL)
- MUST show per product
- default 7 days
- small inline chart

👉 ถ้า layout เดิมใส่ไม่ได้:

REDESIGN LAYOUT
4. FULL TABLE (ALL PRODUCTS)
- MUST include ALL products
- NOT hidden
- NOT lazy collapsed

columns:

Product
Order Items
Shops
Trend
Top Shop
5. SEARCH + FILTER
- search product
- filter shop
- filter status
❌ DO NOT
- hide items behind pagination without clear access
- collapse data to look clean
3) SHOPS (REDESIGN)
SAME PRINCIPLE AS PRODUCTS
🔥 MUST HAVE
1. TOP 50 SHOPS
[Image] Shop Name
Order Items
Products Count
Top Product
2. FULL TABLE
ALL shops accessible
3. VISUAL
- show shop image/logo if exists
4) ANALYSIS / ORDERS EXPLORER
KEEP SIMPLE
- filterable table
- NOT redesign heavy
- NOT primary page
ADD
- sync with date filter
5) DATA HEALTH (DEMOTE)
ROLE
- NOT for general user
- operator/internal only
KEEP
- pipeline status
- known gaps
REMOVE FROM MAIN FLOW
- no visibility on Overview
🎯 UX PRINCIPLES (ENFORCE)
1. Business > System
2. Visual scan > text reading
3. Trend > static number
4. Ranking > raw list
5. Show more > hide less
⚙️ IMPLEMENTATION PHASES
Phase 1
Add global date filter
Remove Data Health from Overview
Add thumbnails to top sections
Phase 2
Rebuild Products page (trend + top 50 + full list)
Phase 3
Rebuild Shops page
Phase 4
Clean navigation hierarchy
🔍 SELF-CHECK BEFORE CODING (MANDATORY)

Claude must output:

=== PERMISSION REQUEST ===

Need:
- product thumbnail field?
- shop image/logo field?
- time-series data per product?
- aggregation API for trend?

Assumptions:
- default 7-day window
- fallback image behavior

Questions:
- confirm Top 50 threshold?
- confirm trend calculation method?
🧨 TL;DR (คุณใช้สั่งได้เลย)
รอบนี้ไม่ใช่แก้ UI
แต่คือ upgrade เป็น “performance interface”

สิ่งที่ต้องได้:
- มี date filter
- มี trend
- มีรูป
- มี top 50
- มี full list
- ไม่มี dev noise

ก่อนทำ → ขอ permission ให้ครบก่อน