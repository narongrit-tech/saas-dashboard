import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read test file
const filePath = path.join(__dirname, '../test-thai-headers.xlsx');
const buffer = fs.readFileSync(filePath);

console.log('🧪 Testing Thai Header Detection\n');
console.log('File:', path.basename(filePath));
console.log('Size:', buffer.length, 'bytes\n');

// Parse workbook
const workbook = XLSX.read(buffer, { type: 'buffer' });
console.log('✅ Sheets found:', workbook.SheetNames.join(', '));

const sheet = workbook.Sheets['Data'];
const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

console.log(`\n📊 Sheet Range: ${sheet['!ref']}`);
console.log(`   Rows: ${range.s.r} to ${range.e.r}`);
console.log(`   Cols: ${range.s.c} to ${range.e.c}\n`);

// Manually scan rows
console.log('🔍 Manual Row Scan:\n');
for (let r = 0; r <= Math.min(5, range.e.r); r++) {
  const cells = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddress = XLSX.utils.encode_cell({ r, c });
    const cell = sheet[cellAddress];
    cells.push(cell ? String(cell.v) : '');
  }

  const rowNum = r + 1;
  const preview = cells.slice(0, 5).map(c => c.length > 20 ? c.slice(0, 20) + '...' : c);

  console.log(`  Row ${rowNum}: [${preview.join(', ')}]`);

  // Check if this looks like a header
  const hasThaiHeader = cells.some(c =>
    c.includes('วันเริ่มต้น') ||
    c.includes('ชื่อแคมเปญ') ||
    c.includes('ต้นทุน')
  );

  if (hasThaiHeader) {
    console.log(`         ⭐ Potential header row detected!`);
  }
}

console.log('\n✅ Test completed');
console.log('\n📝 Expected Behavior:');
console.log('   - Row 3 should be detected as header');
console.log('   - Columns: วันเริ่มต้น → date, ชื่อแคมเปญ → campaign, ต้นทุน → spend');
console.log('   - Data rows 4-6 should be parsed correctly');
console.log('\n🌐 Manual UI Test: http://localhost:3000/wallets');
console.log('   Upload test-thai-headers.xlsx and verify preview shows correct data');
