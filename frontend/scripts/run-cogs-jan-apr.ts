import path from 'node:path'
import { config } from 'dotenv'
import { createServiceClient } from '../src/lib/supabase/service'

// Load .env.local from frontend directory
config({ path: path.resolve(__dirname, '../.env.local') })

const USER_ID = '2c4e254d-c779-4f8a-af93-603dc26e6af0'
const DATE_START = '2026-01-01'
const DATE_END   = '2026-04-30'
const PAGE_SIZE  = 500

// Bundle SKU → component SKU expansions
const BUNDLE_MAP: Record<string, Array<{ sku: string; qty: number }>> = {
  '#0007':     [{ sku: 'NEWONN001', qty: 1 }, { sku: 'NEWONN002', qty: 1 }],
  'NEWONN003': [{ sku: 'NEWONN001', qty: 1 }, { sku: 'NEWONN002', qty: 1 }],
  '#0008':     [{ sku: 'NEWONN001', qty: 2 }],
  '#0080':     [{ sku: 'NEWONN001', qty: 2 }],
  'NEWONN011': [{ sku: 'NEWONN001', qty: 2 }],
  'NEWONN111': [{ sku: 'NEWONN001', qty: 1 }],
}

const BUNDLE_SKUS = new Set(Object.keys(BUNDLE_MAP))

interface OrderRow {
  id: string
  seller_sku: string
  quantity: number
  shipped_at: string
}

interface AllocResult {
  success: number
  alreadyAllocated: number
  noStock: number
  failed: number
}

async function fetchOrders(
  supabase: ReturnType<typeof createServiceClient>,
  isBundlePass: boolean,
  page: number
): Promise<OrderRow[]> {
  const from = page * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  const skuList = Array.from(BUNDLE_SKUS)

  let query = supabase
    .from('sales_orders')
    .select('id, seller_sku, quantity, shipped_at')
    .not('shipped_at', 'is', null)
    .neq('status_group', 'ยกเลิกแล้ว')
    .gte('order_date', DATE_START)
    .lte('order_date', DATE_END)
    .eq('created_by', USER_ID)
    .order('shipped_at', { ascending: true })
    .range(from, to)

  if (isBundlePass) {
    query = query.in('seller_sku', skuList)
  } else {
    query = query.not('seller_sku', 'in', `(${skuList.map(s => `"${s}"`).join(',')})`)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchOrders error: ${error.message}`)
  return (data ?? []) as OrderRow[]
}

async function allocateOrder(
  supabase: ReturnType<typeof createServiceClient>,
  order: OrderRow,
  sku: string,
  qty: number,
  result: AllocResult
): Promise<void> {
  const { data, error } = await supabase.rpc('allocate_cogs_fifo_admin', {
    p_order_id:   order.id,
    p_sku:        sku,
    p_qty:        qty,
    p_shipped_at: order.shipped_at,
    p_user_id:    USER_ID,
  })

  if (error) {
    if (error.message.includes('insufficient_stock')) {
      result.noStock++
      process.stderr.write(`  [NO_STOCK] order=${order.id} sku=${sku} qty=${qty}\n`)
    } else {
      result.failed++
      process.stderr.write(`  [ERR] order=${order.id} sku=${sku}: ${error.message}\n`)
    }
    return
  }

  const status = (data as { status: string })?.status
  if (status === 'already_allocated') {
    result.alreadyAllocated++
  } else {
    result.success++
  }
}

async function runPass(
  supabase: ReturnType<typeof createServiceClient>,
  isBundlePass: boolean,
  result: AllocResult
): Promise<void> {
  const passName = isBundlePass ? 'Pass 1 (bundles)' : 'Pass 2 (direct SKUs)'
  let page = 0
  let totalOrders = 0

  while (true) {
    const orders = await fetchOrders(supabase, isBundlePass, page)
    if (orders.length === 0) break

    for (const order of orders) {
      if (isBundlePass) {
        const components = BUNDLE_MAP[order.seller_sku]
        if (!components) continue
        for (const comp of components) {
          await allocateOrder(supabase, order, comp.sku, comp.qty * order.quantity, result)
        }
      } else {
        await allocateOrder(supabase, order, order.seller_sku, order.quantity, result)
      }
    }

    totalOrders += orders.length
    process.stdout.write(
      `\r  ${passName}: processed ${totalOrders} orders (success=${result.success} skip=${result.alreadyAllocated} no_stock=${result.noStock} err=${result.failed})`
    )

    if (orders.length < PAGE_SIZE) break
    page++
  }

  process.stdout.write('\n')
}

async function main(): Promise<void> {
  const supabase = createServiceClient()

  console.log(`COGS Allocation: ${DATE_START} → ${DATE_END}`)
  console.log(`User: ${USER_ID}`)
  console.log('─'.repeat(60))

  const result: AllocResult = { success: 0, alreadyAllocated: 0, noStock: 0, failed: 0 }

  console.log('Pass 1: bundle SKUs (expand to components)...')
  await runPass(supabase, true, result)

  console.log('Pass 2: direct SKUs...')
  await runPass(supabase, false, result)

  console.log('─'.repeat(60))
  console.log(JSON.stringify({
    success:          result.success,
    already_allocated: result.alreadyAllocated,
    no_stock:          result.noStock,
    failed:            result.failed,
    total_allocations: result.success + result.alreadyAllocated,
  }, null, 2))

  if (result.failed > 0) {
    console.error(`\nWARNING: ${result.failed} allocations failed`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
