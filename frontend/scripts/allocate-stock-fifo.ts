import path from 'node:path'
import crypto from 'node:crypto'
import { config } from 'dotenv'
import { createServiceClient } from '../src/lib/supabase/service.ts'

config({ path: path.resolve(__dirname, '../.env.local') })

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderLineItem {
  id: string
  order_id: string
  sku_internal: string
  qty_ordered: number
  price: number
}

interface OrderWithItems {
  id: string
  order_id: string
  status_group: string
  shipped_at: string | null
  created_at: string
  line_items: OrderLineItem[]
}

interface ReceiptLayer {
  id: string
  sku_internal: string
  qty_received: number
  qty_remaining: number
  unit_cost: number
  created_at: string
}

interface BundleComponent {
  bundle_sku_internal: string
  component_sku_internal: string
  qty_per_bundle: number
}

interface AllocationRecord {
  id: string
  order_id: string
  line_item_id: string
  sku_internal: string
  qty_allocated: number
  receipt_layer_id: string
  unit_cost: number
  allocated_at: string
  created_at: string
}

interface AllocationSummary {
  totalOrders: number
  totalLineItems: number
  totalQtyAllocated: number
  totalAllocations: number
  remainingStockBySku: Map<string, number>
  allocatedBySku: Map<string, number>
  issues: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deterministicUuid(seed: string): string {
  const h = crypto.createHash('sha256').update(seed).digest('hex')
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`
}

// ─── Main Script ──────────────────────────────────────────────────────────────

async function allocateStockFifo() {
  console.log('═══════════════════════════════════════════════════════════════════════════')
  console.log('  STOCK ALLOCATION (FIFO) SCRIPT')
  console.log('═══════════════════════════════════════════════════════════════════════════')
  console.log()

  const supabase = createServiceClient()

  try {
    // ────────────────────────────────────────────────────────────────────────────
    // 1. Fetch unshipped orders
    // ────────────────────────────────────────────────────────────────────────────
    console.log('▶ Step 1: Fetching unshipped orders (shipped_at IS NULL)...')
    
    const { data: ordersData, error: ordersError } = await supabase
      .from('sales_orders')
      .select(
        `
        id,
        order_id,
        status_group,
        shipped_at,
        created_at,
        sales_order_line_items!inner (
          id,
          sku_internal,
          qty_ordered,
          price
        )
        `
      )
      .is('shipped_at', null)
      .neq('status_group', 'ยกเลิกแล้ว')
      .order('created_at', { ascending: true })

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`)

    const orders = (ordersData || []) as unknown as OrderWithItems[]
    console.log(`✓ Found ${orders.length} unshipped orders`)
    
    if (orders.length === 0) {
      console.log('  No unshipped orders found. Exiting.')
      return
    }

    // Count line items
    const totalLineItems = orders.reduce((sum, o) => sum + (o.line_items?.length || 0), 0)
    console.log(`  Total line items: ${totalLineItems}`)
    console.log()

    // ────────────────────────────────────────────────────────────────────────────
    // 2. Fetch bundle components
    // ────────────────────────────────────────────────────────────────────────────
    console.log('▶ Step 2: Fetching bundle components...')

    const { data: bundlesData, error: bundlesError } = await supabase
      .from('inventory_bundle_components')
      .select('bundle_sku_internal, component_sku_internal, qty_per_bundle')

    if (bundlesError) throw new Error(`Failed to fetch bundles: ${bundlesError.message}`)

    const bundles = (bundlesData || []) as BundleComponent[]
    const bundleMap = new Map<string, BundleComponent[]>()
    
    bundles.forEach(bundle => {
      if (!bundleMap.has(bundle.bundle_sku_internal)) {
        bundleMap.set(bundle.bundle_sku_internal, [])
      }
      bundleMap.get(bundle.bundle_sku_internal)!.push(bundle)
    })
    
    console.log(`✓ Found ${bundles.length} bundle components (${bundleMap.size} bundles)`)
    console.log()

    // ────────────────────────────────────────────────────────────────────────────
    // 3. Fetch all receipt layers and sort by FIFO (created_at ASC)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('▶ Step 3: Fetching receipt layers (FIFO sorted by created_at)...')

    const { data: layersData, error: layersError } = await supabase
      .from('inventory_receipt_layers')
      .select('id, sku_internal, qty_received, qty_remaining, unit_cost, created_at')
      .gt('qty_remaining', 0)
      .order('created_at', { ascending: true })

    if (layersError) throw new Error(`Failed to fetch receipt layers: ${layersError.message}`)

    const layers = (layersData || []) as ReceiptLayer[]
    console.log(`✓ Found ${layers.length} receipt layers with remaining stock`)
    console.log()

    // Build SKU-indexed layer map
    const layersBySku = new Map<string, ReceiptLayer[]>()
    layers.forEach(layer => {
      if (!layersBySku.has(layer.sku_internal)) {
        layersBySku.set(layer.sku_internal, [])
      }
      layersBySku.get(layer.sku_internal)!.push(layer)
    })

    // ────────────────────────────────────────────────────────────────────────────
    // 4. Explode bundles and allocate stock
    // ────────────────────────────────────────────────────────────────────────────
    console.log('▶ Step 4: Exploding bundles and allocating stock (FIFO)...')
    console.log()

    const allocations: AllocationRecord[] = []
    const allocatedBySku = new Map<string, number>()
    const issues: string[] = []

    // Process each order and line item
    for (const order of orders) {
      for (const lineItem of order.line_items || []) {
        const { sku_internal, qty_ordered } = lineItem

        // Check if it's a bundle
        const bundleComponents = bundleMap.get(sku_internal)

        if (bundleComponents && bundleComponents.length > 0) {
          // It's a bundle: explode and allocate components
          console.log(`  Bundle: ${sku_internal} (qty ${qty_ordered})`)
          
          for (const component of bundleComponents) {
            const compSku = component.component_sku_internal
            const qtyNeeded = qty_ordered * component.qty_per_bundle

            console.log(`    → Component: ${compSku} (need ${qtyNeeded})`)

            // Allocate from FIFO layers
            let qtyRemaining = qtyNeeded
            const compLayers = layersBySku.get(compSku) || []

            if (compLayers.length === 0) {
              const msg = `No receipt layers found for component ${compSku}`
              console.log(`      ✗ ${msg}`)
              issues.push(msg)
              continue
            }

            for (const layer of compLayers) {
              if (qtyRemaining <= 0) break

              const qtyToAllocate = Math.min(qtyRemaining, layer.qty_remaining)
              if (qtyToAllocate <= 0) continue

              // Create allocation record
              const allocationId = deterministicUuid(
                `${order.order_id}:${lineItem.id}:${layer.id}:${compSku}`
              )

              allocations.push({
                id: allocationId,
                order_id: order.order_id,
                line_item_id: lineItem.id,
                sku_internal: compSku,
                qty_allocated: qtyToAllocate,
                receipt_layer_id: layer.id,
                unit_cost: layer.unit_cost,
                allocated_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              })

              // Update tracking
              const currentAllocated = allocatedBySku.get(compSku) || 0
              allocatedBySku.set(compSku, currentAllocated + qtyToAllocate)

              // Update layer's remaining qty (in memory only, not persisted yet)
              layer.qty_remaining -= qtyToAllocate
              qtyRemaining -= qtyToAllocate

              console.log(`      ✓ Allocated ${qtyToAllocate} from layer ${layer.id.slice(0, 8)}...`)
            }

            if (qtyRemaining > 0) {
              const msg = `Insufficient stock for ${compSku}: need ${qtyNeeded}, allocated ${qtyNeeded - qtyRemaining}`
              console.log(`      ✗ ${msg}`)
              issues.push(msg)
            }
          }
        } else {
          // Regular SKU: allocate directly
          console.log(`  SKU: ${sku_internal} (qty ${qty_ordered})`)

          let qtyRemaining = qty_ordered
          const skuLayers = layersBySku.get(sku_internal) || []

          if (skuLayers.length === 0) {
            const msg = `No receipt layers found for ${sku_internal}`
            console.log(`    ✗ ${msg}`)
            issues.push(msg)
            continue
          }

          for (const layer of skuLayers) {
            if (qtyRemaining <= 0) break

            const qtyToAllocate = Math.min(qtyRemaining, layer.qty_remaining)
            if (qtyToAllocate <= 0) continue

            // Create allocation record
            const allocationId = deterministicUuid(
              `${order.order_id}:${lineItem.id}:${layer.id}:${sku_internal}`
            )

            allocations.push({
              id: allocationId,
              order_id: order.order_id,
              line_item_id: lineItem.id,
              sku_internal: sku_internal,
              qty_allocated: qtyToAllocate,
              receipt_layer_id: layer.id,
              unit_cost: layer.unit_cost,
              allocated_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            })

            // Update tracking
            const currentAllocated = allocatedBySku.get(sku_internal) || 0
            allocatedBySku.set(sku_internal, currentAllocated + qtyToAllocate)

            // Update layer's remaining qty
            layer.qty_remaining -= qtyToAllocate
            qtyRemaining -= qtyToAllocate

            console.log(`  ✓ Allocated ${qtyToAllocate} from layer ${layer.id.slice(0, 8)}...`)
          }

          if (qtyRemaining > 0) {
            const msg = `Insufficient stock for ${sku_internal}: need ${qty_ordered}, allocated ${qty_ordered - qtyRemaining}`
            console.log(`  ✗ ${msg}`)
            issues.push(msg)
          }
        }
      }
    }

    console.log()
    console.log(`✓ Created ${allocations.length} allocation records`)
    console.log()

    // ────────────────────────────────────────────────────────────────────────────
    // 5. Insert allocations into database (with upsert to avoid duplicates)
    // ────────────────────────────────────────────────────────────────────────────
    console.log('▶ Step 5: Inserting allocation records into database...')

    if (allocations.length > 0) {
      const { error: insertError } = await supabase
        .from('inventory_cogs_allocations')
        .upsert(allocations, { onConflict: 'id' })

      if (insertError) {
        throw new Error(`Failed to insert allocations: ${insertError.message}`)
      }

      console.log(`✓ Successfully inserted/updated ${allocations.length} allocation records`)
    } else {
      console.log('  No allocations to insert')
    }

    console.log()

    // ────────────────────────────────────────────────────────────────────────────
    // 6. Calculate and display remaining stock
    // ────────────────────────────────────────────────────────────────────────────
    console.log('▶ Step 6: Calculating remaining stock...')
    console.log()

    const remainingBySku = new Map<string, number>()
    layers.forEach(layer => {
      const current = remainingBySku.get(layer.sku_internal) || 0
      remainingBySku.set(layer.sku_internal, current + layer.qty_remaining)
    })

    // ────────────────────────────────────────────────────────────────────────────
    // 7. Display Summary Report
    // ────────────────────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════════════════')
    console.log('  ALLOCATION SUMMARY REPORT')
    console.log('═══════════════════════════════════════════════════════════════════════════')
    console.log()

    console.log('📊 ORDERS & ALLOCATION:')
    console.log(`  • Total unshipped orders: ${orders.length}`)
    console.log(`  • Total line items: ${totalLineItems}`)
    console.log(`  • Total allocations created: ${allocations.length}`)
    console.log(`  • Total qty allocated: ${Array.from(allocatedBySku.values()).reduce((a, b) => a + b, 0)}`)
    console.log()

    console.log('📦 REMAINING STOCK BY SKU:')
    const uniqueSkus = Array.from(remainingBySku.keys()).sort()
    let freshUpRemaining = 0
    let windDownRemaining = 0

    for (const sku of uniqueSkus) {
      const remaining = remainingBySku.get(sku) || 0
      const allocated = allocatedBySku.get(sku) || 0
      const totalQty = remaining + allocated

      console.log(`  ${sku}:`)
      console.log(`    • Total received: ${totalQty}`)
      console.log(`    • Allocated: ${allocated}`)
      console.log(`    • Remaining: ${remaining}`)

      // Track for comparison
      if (sku === 'NEWONN001') {
        freshUpRemaining = remaining
      } else if (sku === 'NEWONN002') {
        windDownRemaining = remaining
      }
    }
    console.log()

    console.log('🔍 COMPARISON WITH EXPECTED VALUES:')
    console.log(`  Fresh Up (NEWONN001):`)
    console.log(`    • Expected remaining: 789`)
    console.log(`    • Actual remaining: ${freshUpRemaining}`)
    console.log(`    • Match: ${freshUpRemaining === 789 ? '✓ YES' : '✗ NO'}`)
    console.log()
    console.log(`  Wind Down (NEWONN002):`)
    console.log(`    • Expected remaining: 441`)
    console.log(`    • Actual remaining: ${windDownRemaining}`)
    console.log(`    • Match: ${windDownRemaining === 441 ? '✓ YES' : '✗ NO'}`)
    console.log()

    if (issues.length > 0) {
      console.log('⚠️  ISSUES ENCOUNTERED:')
      issues.forEach((issue, idx) => {
        console.log(`  ${idx + 1}. ${issue}`)
      })
      console.log()
    }

    console.log('═══════════════════════════════════════════════════════════════════════════')
    console.log('  ✓ ALLOCATION COMPLETE')
    console.log('═══════════════════════════════════════════════════════════════════════════')
  } catch (error) {
    console.error('✗ ERROR:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

allocateStockFifo().then(() => {
  process.exit(0)
}).catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
