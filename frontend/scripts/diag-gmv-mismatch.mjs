import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const eq = l.indexOf('=')
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const start = '2026-05-01'
const end = '2026-05-01'
const startTS = `${start}T00:00:00+07:00`
const endTS = `${end}T23:59:59.999+07:00`

console.log('==========================================')
console.log('GMV mismatch diagnosis — 2026-05-01')
console.log('==========================================\n')

function bkkDateStr(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000)
  return bkk.toISOString().slice(0, 10)
}

async function fetchAll(filter) {
  let all = []
  let offset = 0
  while (true) {
    const q = filter(supabase
      .from('sales_orders')
      .select('external_order_id, order_id, order_amount, total_amount, created_time, order_date, paid_time, shipped_at, status_group, platform_status, source_platform')
      .range(offset, offset + 999))
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

// ---- A) Sales Orders page logic — POST-PATCH ----
//   server: order_date in [`${start}T00:00:00+07:00`, `${end}T23:59:59.999+07:00`]
//   client: bkk-day of (created_time || order_date) in [start, end]
const salesRaw = await fetchAll((q) => q.gte('order_date', startTS).lte('order_date', endTS))
const salesCohort = salesRaw.filter((l) => {
  const eff = l.created_time || l.order_date
  if (!eff) return false
  const d = bkkDateStr(eff)
  return d >= start && d <= end
})

// ---- B) Performance Dashboard logic ----
//   strict: created_time NOT NULL, in [startTS, endTS]
const perfRaw = await fetchAll((q) => q.not('created_time', 'is', null).gte('created_time', startTS).lte('created_time', endTS))

function aggregate(rows) {
  const orderMap = new Map()
  for (const line of rows) {
    const key = line.external_order_id || line.order_id
    if (!key) continue
    const lineTotal = Math.max(0, Number(line.total_amount ?? 0))
    const lineOrderAmt = (line.order_amount != null && Number(line.order_amount) > 0) ? Number(line.order_amount) : null
    const ex = orderMap.get(key)
    if (!ex) {
      orderMap.set(key, {
        order_amounts: lineOrderAmt != null ? [lineOrderAmt] : [],
        line_total_sum: lineTotal,
        first: line,
      })
    } else {
      ex.line_total_sum += lineTotal
      if (lineOrderAmt != null) ex.order_amounts.push(lineOrderAmt)
    }
  }
  let gmv = 0
  const orders = []
  for (const [key, b] of orderMap.entries()) {
    let g
    if (b.order_amounts.length > 0) {
      const f = b.order_amounts[0]
      const allSame = b.order_amounts.every((a) => a === f)
      g = allSame ? f : b.line_total_sum
    } else {
      g = b.line_total_sum
    }
    gmv += Math.max(0, g)
    orders.push({ key, gmv: g, ...b.first })
  }
  return { gmv: Math.round(gmv * 100) / 100, count: orders.length, orders }
}

const A = aggregate(salesCohort)
const B = aggregate(perfRaw)

console.log(`A) Sales Orders page  (COALESCE created_time, order_date):  GMV=${A.gmv}  orders=${A.count}`)
console.log(`B) Performance Dash   (strict created_time):                GMV=${B.gmv}  orders=${B.count}`)
console.log(`   diff (B-A): ${(B.gmv - A.gmv).toFixed(2)}\n`)

// Set-difference
const setA = new Set(A.orders.map((o) => o.key))
const setB = new Set(B.orders.map((o) => o.key))
const onlyInB = B.orders.filter((o) => !setA.has(o.key))
const onlyInA = A.orders.filter((o) => !setB.has(o.key))

console.log(`Orders ONLY in Performance Dashboard (not in Sales page): ${onlyInB.length}`)
let onlyInBSum = 0
for (const o of onlyInB) {
  onlyInBSum += o.gmv
  console.log(`  key=${o.key}  gmv=${o.gmv}  created_time=${o.created_time}  order_date=${o.order_date}  paid_time=${o.paid_time}  status=${o.status_group}  platform=${o.source_platform}`)
}
console.log(`  sum gmv = ${onlyInBSum.toFixed(2)}\n`)

console.log(`Orders ONLY in Sales page (not in Performance Dashboard): ${onlyInA.length}`)
let onlyInASum = 0
for (const o of onlyInA) {
  onlyInASum += o.gmv
  console.log(`  key=${o.key}  gmv=${o.gmv}  created_time=${o.created_time}  order_date=${o.order_date}  paid_time=${o.paid_time}  status=${o.status_group}  platform=${o.source_platform}`)
}
console.log(`  sum gmv = ${onlyInASum.toFixed(2)}\n`)

// Verify reconciliation
console.log(`Reconcile: B - A should equal (onlyInB sum) - (onlyInA sum)`)
console.log(`           ${(B.gmv - A.gmv).toFixed(2)} ?= ${(onlyInBSum - onlyInASum).toFixed(2)}`)
