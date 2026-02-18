/**
 * Test Script: Inventory Availability Calculation
 *
 * Purpose: Verify that reservation logic follows business rules:
 * 1. Reserved = unshipped + non-cancelled orders
 * 2. Physical deduction = shipped orders only
 * 3. Available = On Hand - Reserved
 * 4. Bundles are properly exploded
 *
 * Usage:
 * 1. Make sure you're authenticated in the app
 * 2. Run this via a server action or API route (requires Supabase client)
 * 3. Check console output for verification results
 */

import { createClient } from '@/lib/supabase/server'

interface TestResult {
  test_name: string
  status: 'PASS' | 'FAIL' | 'INFO'
  message: string
  data?: any
}

export async function testInventoryAvailability(): Promise<TestResult[]> {
  const results: TestResult[] = []
  const supabase = createClient()

  try {
    // ============================================
    // TEST 1: Count unshipped orders (should be reserved)
    // ============================================
    const { data: unshipped, error: err1 } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity, status_group')
      .is('shipped_at', null)
      .neq('status_group', 'ยกเลิกแล้ว')

    if (err1) {
      results.push({
        test_name: 'TEST 1: Unshipped Orders',
        status: 'FAIL',
        message: `Error: ${err1.message}`,
      })
    } else {
      const count = unshipped?.length || 0
      const totalQty = unshipped?.reduce((sum, o) => sum + (o.quantity || 0), 0) || 0

      results.push({
        test_name: 'TEST 1: Unshipped Orders (Reserved)',
        status: 'INFO',
        message: `Found ${count} unshipped orders with total qty ${totalQty}`,
        data: { count, totalQty, sample: unshipped?.slice(0, 3) },
      })
    }

    // ============================================
    // TEST 2: Count shipped orders (should NOT be reserved)
    // ============================================
    const { data: shipped, error: err2 } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity, shipped_at')
      .not('shipped_at', 'is', null)
      .neq('status_group', 'ยกเลิกแล้ว')

    if (err2) {
      results.push({
        test_name: 'TEST 2: Shipped Orders',
        status: 'FAIL',
        message: `Error: ${err2.message}`,
      })
    } else {
      const count = shipped?.length || 0
      const totalQty = shipped?.reduce((sum, o) => sum + (o.quantity || 0), 0) || 0

      results.push({
        test_name: 'TEST 2: Shipped Orders (NOT Reserved)',
        status: 'INFO',
        message: `Found ${count} shipped orders with total qty ${totalQty}`,
        data: { count, totalQty },
      })
    }

    // ============================================
    // TEST 3: Count cancelled orders (should NOT be reserved)
    // ============================================
    const { data: cancelled, error: err3 } = await supabase
      .from('sales_orders')
      .select('order_id, seller_sku, quantity')
      .eq('status_group', 'ยกเลิกแล้ว')

    if (err3) {
      results.push({
        test_name: 'TEST 3: Cancelled Orders',
        status: 'FAIL',
        message: `Error: ${err3.message}`,
      })
    } else {
      const count = cancelled?.length || 0

      results.push({
        test_name: 'TEST 3: Cancelled Orders (NOT Reserved)',
        status: 'INFO',
        message: `Found ${count} cancelled orders (excluded from reserved)`,
        data: { count },
      })
    }

    // ============================================
    // TEST 4: Verify no COGS for unshipped orders
    // ============================================
    const { data: badCogs, error: err4 } = await supabase
      .from('inventory_cogs_allocations')
      .select(`
        order_id,
        sku_internal,
        qty,
        sales_orders!inner(shipped_at, status_group)
      `)
      .is('sales_orders.shipped_at', null)
      .eq('is_reversal', false)

    if (err4) {
      results.push({
        test_name: 'TEST 4: COGS Allocations',
        status: 'FAIL',
        message: `Error: ${err4.message}`,
      })
    } else {
      const count = badCogs?.length || 0

      if (count > 0) {
        results.push({
          test_name: 'TEST 4: COGS for Unshipped Orders',
          status: 'FAIL',
          message: `BUG: Found ${count} COGS allocations for unshipped orders!`,
          data: { bad_allocations: badCogs },
        })
      } else {
        results.push({
          test_name: 'TEST 4: COGS for Unshipped Orders',
          status: 'PASS',
          message: 'No COGS allocations found for unshipped orders ✓',
        })
      }
    }

    // ============================================
    // TEST 5: Check for bundle orders
    // ============================================
    const { data: bundleOrders, error: err5 } = await supabase
      .from('sales_orders')
      .select(`
        order_id,
        seller_sku,
        quantity,
        inventory_items!inner(is_bundle)
      `)
      .is('shipped_at', null)
      .neq('status_group', 'ยกเลิกแล้ว')
      .eq('inventory_items.is_bundle', true)

    if (err5) {
      results.push({
        test_name: 'TEST 5: Bundle Orders',
        status: 'FAIL',
        message: `Error: ${err5.message}`,
      })
    } else {
      const count = bundleOrders?.length || 0

      results.push({
        test_name: 'TEST 5: Unshipped Bundle Orders',
        status: 'INFO',
        message: `Found ${count} unshipped bundle orders (need component explosion)`,
        data: { count, sample: bundleOrders?.slice(0, 3) },
      })
    }

    // ============================================
    // FINAL SUMMARY
    // ============================================
    const passed = results.filter((r) => r.status === 'PASS').length
    const failed = results.filter((r) => r.status === 'FAIL').length
    const info = results.filter((r) => r.status === 'INFO').length

    results.push({
      test_name: 'SUMMARY',
      status: failed > 0 ? 'FAIL' : 'PASS',
      message: `Tests: ${passed} passed, ${failed} failed, ${info} info`,
      data: { passed, failed, info },
    })

    return results
  } catch (error) {
    console.error('Test script error:', error)
    return [
      {
        test_name: 'FATAL ERROR',
        status: 'FAIL',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    ]
  }
}

/**
 * Pretty print test results
 */
export function printTestResults(results: TestResult[]) {
  console.log('\n' + '='.repeat(60))
  console.log('INVENTORY AVAILABILITY TEST RESULTS')
  console.log('='.repeat(60) + '\n')

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : 'ℹ'
    console.log(`${icon} ${result.test_name}`)
    console.log(`  Status: ${result.status}`)
    console.log(`  ${result.message}`)

    if (result.data) {
      console.log(`  Data:`, JSON.stringify(result.data, null, 2))
    }

    console.log('')
  }

  console.log('='.repeat(60) + '\n')
}
