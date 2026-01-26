/**
 * Create test TikTok Ads file with Thai headers
 * Run: node create-test-ads-file.js
 */

const XLSX = require('./frontend/node_modules/xlsx')
const fs = require('fs')

// Test data with TikTok Thai headers
const data = [
  {
    'วันเริ่มต้น': '2026-01-20',
    'ชื่อแคมเปญ': 'Product Campaign A',
    'ต้นทุน': 5000.0,
    'รายได้ขั้นต้น': 12000.0,
    'ยอดการซื้อ': 45,
  },
  {
    'วันเริ่มต้น': '2026-01-21',
    'ชื่อแคมเปญ': 'Product Campaign A',
    'ต้นทุน': 4500.0,
    'รายได้ขั้นต้น': 11000.0,
    'ยอดการซื้อ': 42,
  },
  {
    'วันเริ่มต้น': '2026-01-22',
    'ชื่อแคมเปญ': 'Product Campaign B',
    'ต้นทุน': 3200.0,
    'รายได้ขั้นต้น': 8500.0,
    'ยอดการซื้อ': 30,
  },
  {
    'วันเริ่มต้น': '2026-01-23',
    'ชื่อแคมเปญ': 'Live Campaign Jan',
    'ต้นทุน': 6000.0,
    'รายได้ขั้นต้น': 15000.0,
    'ยอดการซื้อ': 50,
  },
  {
    'วันเริ่มต้น': '2026-01-24',
    'ชื่อแคมเปญ': 'Product Campaign A',
    'ต้นทุน': 5500.0,
    'รายได้ขั้นต้น': 13500.0,
    'ยอดการซื้อ': 48,
  },
]

// Create workbook and worksheet
const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(data)

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, 'Data')

// Write to file
const fileName = 'test-tiktok-ads-thai-headers.xlsx'
XLSX.writeFile(wb, fileName)

console.log(`✅ Created test file: ${fileName}`)
console.log(`Headers: วันเริ่มต้น, ชื่อแคมเปญ, ต้นทุน, รายได้ขั้นต้น, ยอดการซื้อ`)
console.log(`Rows: ${data.length}`)
console.log(`Total Spend: ${data.reduce((sum, row) => sum + row['ต้นทุน'], 0).toLocaleString('th-TH')} THB`)
console.log(`Total GMV: ${data.reduce((sum, row) => sum + row['รายได้ขั้นต้น'], 0).toLocaleString('th-TH')} THB`)
console.log(`Total Orders: ${data.reduce((sum, row) => sum + row['ยอดการซื้อ'], 0)}`)
console.log(`\nYou can now upload this file to test the import flow.`)
