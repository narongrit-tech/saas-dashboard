/**
 * Test script to verify TikTok Ads Parser synonyms
 * Run: node test-parser-synonyms.js
 */

// Simulate parser logic
const COLUMN_TOKENS = {
  date: {
    tokens: [
      'date',
      'วันที่',
      'วันเริ่มต้น',
      'วันเริ่ม',
      'เวลาเริ่มต้น',
      'เวลาเริ่ม',
      'start date',
      'start time',
    ],
  },
  campaign: {
    tokens: [
      'campaign',
      'แคมเปญ',
      'ชื่อแคมเปญ',
      'ชื่อแคมเปญโฆษณา',
      'ชื่อ live',
      'ชื่อไลฟ์',
      'campaign name',
      'ad name',
    ],
  },
  cost: {
    tokens: [
      'cost',
      'spend',
      'ค่าใช้จ่าย',
      'ต้นทุน',
      'total cost',
      'ad spend',
    ],
  },
  gmv: {
    tokens: [
      'gmv',
      'revenue',
      'รายได้',
      'รายได้ขั้นต้น',
      'มูลค่ายอดขาย',
      'ยอดขาย',
      'รายได้รวม',
      'conversion value',
      'total revenue',
      'gross revenue',
    ],
  },
  orders: {
    tokens: [
      'order',
      'orders',
      'คำสั่งซื้อ',
      'ยอดการซื้อ',
      'จำนวนคำสั่งซื้อ',
      'ออเดอร์',
      'ยอดออเดอร์',
      'conversion',
      'conversions',
      'purchase',
      'purchases',
    ],
  },
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[()[\]:]/g, '')
}

function scoreColumnMatch(header, tokens) {
  const normalized = normalizeText(header)

  for (const token of tokens) {
    const normalizedToken = normalizeText(token)

    // Exact match
    if (normalized === normalizedToken) return 100

    // Contains token
    if (normalized.includes(normalizedToken)) return 50

    // Token contains header
    if (normalizedToken.includes(normalized) && normalized.length > 3) return 30
  }

  return 0
}

function buildColumnMapping(headers) {
  const mapping = {
    date: null,
    campaign: null,
    cost: null,
    gmv: null,
    orders: null,
  }

  for (const [field, config] of Object.entries(COLUMN_TOKENS)) {
    let bestScore = 0
    let bestHeader = null

    for (const header of headers) {
      const score = scoreColumnMatch(header, config.tokens)
      if (score > bestScore) {
        bestScore = score
        bestHeader = header
      }
    }

    if (bestScore > 25 && bestHeader) {
      mapping[field] = bestHeader
    }
  }

  return mapping
}

// ========================================
// Test Cases
// ========================================

console.log('🔍 Testing TikTok Ads Parser Synonyms\n')

// Test Case 1: TikTok Thai Headers (Real User Case)
console.log('Test 1: TikTok Thai Headers (จากไฟล์จริงของ User)')
const headers1 = [
  'วันเริ่มต้น',
  'ชื่อแคมเปญ',
  'ต้นทุน',
  'รายได้ขั้นต้น',
  'ยอดการซื้อ',
]
const mapping1 = buildColumnMapping(headers1)
console.log('Headers:', headers1)
console.log('Mapping:', mapping1)
console.log('✅ Pass:', Object.values(mapping1).every((v) => v !== null) ? 'YES' : 'NO')
console.log()

// Test Case 2: English Headers
console.log('Test 2: English Headers')
const headers2 = ['Date', 'Campaign Name', 'Cost', 'Revenue', 'Conversions']
const mapping2 = buildColumnMapping(headers2)
console.log('Headers:', headers2)
console.log('Mapping:', mapping2)
console.log('✅ Pass:', Object.values(mapping2).every((v) => v !== null) ? 'YES' : 'NO')
console.log()

// Test Case 3: Mixed Thai/English
console.log('Test 3: Mixed Thai/English')
const headers3 = ['Date', 'ชื่อแคมเปญ', 'Spend', 'GMV', 'Orders']
const mapping3 = buildColumnMapping(headers3)
console.log('Headers:', headers3)
console.log('Mapping:', mapping3)
console.log('✅ Pass:', Object.values(mapping3).every((v) => v !== null) ? 'YES' : 'NO')
console.log()

// Test Case 4: Alternative Thai Terms
console.log('Test 4: Alternative Thai Terms')
const headers4 = ['วันที่', 'ชื่อแคมเปญโฆษณา', 'ค่าใช้จ่าย', 'มูลค่ายอดขาย', 'จำนวนคำสั่งซื้อ']
const mapping4 = buildColumnMapping(headers4)
console.log('Headers:', headers4)
console.log('Mapping:', mapping4)
console.log('✅ Pass:', Object.values(mapping4).every((v) => v !== null) ? 'YES' : 'NO')
console.log()

// Test Case 5: Missing columns
console.log('Test 5: Missing Critical Column (Cost)')
const headers5 = ['Date', 'Campaign', 'Revenue', 'Orders']
const mapping5 = buildColumnMapping(headers5)
console.log('Headers:', headers5)
console.log('Mapping:', mapping5)
console.log('❌ Should fail (Cost missing):', mapping5.cost === null ? 'YES' : 'NO')
console.log()

console.log('========================================')
console.log('Summary:')
console.log('- Test 1 (TikTok Thai): MUST PASS')
console.log('- Test 2-4: Should all pass')
console.log('- Test 5: Should correctly identify missing field')
