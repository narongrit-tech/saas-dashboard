import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const root = process.argv[2] || 'D:\\AI_OS\\data\\raw\\tiktok-affiliate-orders'

type Row = Record<string, string | null> & { __file: string }

const files = fs.readdirSync(root).filter((name) => name.endsWith('.xlsx')).sort()
const rows: Row[] = []

for (const file of files) {
  const workbook = XLSX.readFile(path.join(root, file), { raw: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<Row>(firstSheet, { defval: null, raw: false })
  for (const row of data) rows.push({ ...row, __file: file })
}

const numberValue = (value: string | null | undefined) => {
  if (!value || value === '/') return 0
  const normalized = String(value).replace(/,/g, '').replace(/%/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const countValues = (field: string) => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = row[field] || '<blank>'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const uniqueCount = (field: string) => {
  return new Set(rows.map((row) => row[field]).filter(Boolean)).size
}

const orderLineCounts = new Map<string, number>()
for (const row of rows) {
  const orderId = row['Order ID'] || '<blank>'
  orderLineCounts.set(orderId, (orderLineCounts.get(orderId) || 0) + 1)
}

const orderLineDistribution: Record<string, number> = {}
for (const lineCount of orderLineCounts.values()) {
  orderLineDistribution[String(lineCount)] = (orderLineDistribution[String(lineCount)] || 0) + 1
}

const output = {
  source_folder: root,
  file_count: files.length,
  total_rows: rows.length,
  headers: rows.length > 0 ? Object.keys(rows[0]).filter((key) => key !== '__file') : [],
  distinct_keys: {
    order_id: uniqueCount('Order ID'),
    content_id: uniqueCount('Content ID'),
    product_id: uniqueCount('Product ID'),
    sku_id: uniqueCount('SKU ID'),
  },
  distributions: {
    order_type: countValues('Order type'),
    order_settlement_status: countValues('Order settlement status'),
    indirect: countValues('Indirect'),
    content_type: countValues('Content Type'),
  },
  order_line_distribution: orderLineDistribution,
  totals: {
    gmv: rows.reduce((sum, row) => sum + numberValue(row['GMV']), 0),
    total_final_earned_amount: rows.reduce((sum, row) => sum + numberValue(row['Total final earned amount']), 0),
    refunded_units: rows.reduce((sum, row) => sum + numberValue(row['Items refunded']), 0),
  },
}

console.log(JSON.stringify(output, null, 2))
