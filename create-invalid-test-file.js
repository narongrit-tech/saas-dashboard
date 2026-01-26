/**
 * Create invalid test file with wrong headers (for debug display test)
 * Run: node create-invalid-test-file.js
 */

const XLSX = require('./frontend/node_modules/xlsx')

// Invalid data with wrong headers
const data = [
  {
    'Wrong Header 1': '2026-01-20',
    'Wrong Header 2': 'Some Campaign',
    'Wrong Header 3': 5000,
    'Wrong Header 4': 12000,
    'Wrong Header 5': 45,
  },
  {
    'Wrong Header 1': '2026-01-21',
    'Wrong Header 2': 'Another Campaign',
    'Wrong Header 3': 4500,
    'Wrong Header 4': 11000,
    'Wrong Header 5': 42,
  },
]

// Create workbook and worksheet
const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(data)

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

// Write to file
const fileName = 'test-invalid-headers.xlsx'
XLSX.writeFile(wb, fileName)

console.log(`✅ Created invalid test file: ${fileName}`)
console.log(`Headers (WRONG): Wrong Header 1, Wrong Header 2, Wrong Header 3, Wrong Header 4, Wrong Header 5`)
console.log(`Expected: Parser should FAIL and show debug details`)
console.log(`\nThis file is for testing debug display on parse error.`)
