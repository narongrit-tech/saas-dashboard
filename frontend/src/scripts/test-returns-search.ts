import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function testReturnsSearch() {
  console.log('=== Testing Returns Search ===\n')

  // Get sample tracking numbers
  console.log('1. Getting sample tracking numbers...')
  const { data: samples } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform')
    .not('tracking_number', 'is', null)
    .limit(3)

  if (!samples || samples.length === 0) {
    console.log('❌ No orders with tracking_number found')
    return
  }

  console.log('Sample orders:')
  console.table(samples)

  // Test 1: Search by tracking number (exact)
  console.log('\n2. Test 1: Search by tracking number (exact match)')
  const testTracking1 = samples[0].tracking_number
  console.log(`Searching for: "${testTracking1}"`)

  const { data: result1, error: error1 } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform')
    .eq('tracking_number', testTracking1)

  if (error1) {
    console.error('❌ Error:', error1)
  } else {
    console.log(`✓ Found ${result1.length} results (exact match)`)
    if (result1.length > 0) console.table(result1)
  }

  // Test 2: Search by tracking number (ILIKE)
  console.log('\n3. Test 2: Search by tracking number (ILIKE - case insensitive)')
  const testTracking2 = samples[0].tracking_number.toLowerCase()
  console.log(`Searching for: "${testTracking2}" (lowercase)`)

  const { data: result2, error: error2 } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform')
    .ilike('tracking_number', `%${testTracking2}%`)

  if (error2) {
    console.error('❌ Error:', error2)
  } else {
    console.log(`✓ Found ${result2.length} results (ILIKE match)`)
    if (result2.length > 0) console.table(result2.slice(0, 3))
  }

  // Test 3: Search by external_order_id (regression test)
  console.log('\n4. Test 3: Search by external_order_id (regression test)')
  const testOrderId = samples[1].external_order_id
  console.log(`Searching for: "${testOrderId}"`)

  const { data: result3, error: error3 } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform')
    .eq('external_order_id', testOrderId)

  if (error3) {
    console.error('❌ Error:', error3)
  } else {
    console.log(`✓ Found ${result3.length} results (external_order_id match)`)
    if (result3.length > 0) console.table(result3)
  }

  // Test 4: Combined search (external_order_id OR tracking_number)
  console.log('\n5. Test 4: Combined search (OR query)')
  const testQuery = samples[2].tracking_number
  console.log(`Searching for: "${testQuery}" (in both external_order_id and tracking_number)`)

  const { data: result4, error: error4 } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform')
    .or(`external_order_id.ilike.%${testQuery}%,tracking_number.ilike.%${testQuery}%`)
    .limit(10)

  if (error4) {
    console.error('❌ Error:', error4)
  } else {
    console.log(`✓ Found ${result4.length} results (OR query)`)
    if (result4.length > 0) console.table(result4)
  }

  // Test 5: Partial match
  console.log('\n6. Test 5: Partial match (first 6 digits of tracking)')
  const partialTracking = samples[0].tracking_number.substring(0, 6)
  console.log(`Searching for: "${partialTracking}" (partial)`)

  const { data: result5, error: error5 } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform')
    .ilike('tracking_number', `%${partialTracking}%`)
    .limit(5)

  if (error5) {
    console.error('❌ Error:', error5)
  } else {
    console.log(`✓ Found ${result5.length} results (partial match)`)
    if (result5.length > 0) console.table(result5)
  }

  // Test 6: Performance test
  console.log('\n7. Test 6: Performance test (explain query)')
  console.log('Note: This would require direct psql access for EXPLAIN ANALYZE')
  console.log('Manual verification needed:')
  console.log(`
  psql $DATABASE_URL -c "
  EXPLAIN ANALYZE
  SELECT id, external_order_id, tracking_number
  FROM sales_orders
  WHERE tracking_number ILIKE '%${samples[0].tracking_number}%'
  LIMIT 10;
  "
  `)
}

testReturnsSearch()
  .then(() => {
    console.log('\n=== All tests complete ===')
    process.exit(0)
  })
  .catch(err => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
