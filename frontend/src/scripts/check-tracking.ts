import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkTracking() {
  console.log('=== Checking tracking_number column ===\n')

  // Check if column exists by trying to select it
  console.log('1. Checking column existence...')
  const { data: testData, error: testError } = await supabase
    .from('sales_orders')
    .select('id, tracking_number')
    .limit(1)

  if (testError) {
    console.error('Error: tracking_number column may not exist')
    console.error(testError.message)
    return
  }

  console.log('✓ tracking_number column exists\n')

  // Get total count
  console.log('2. Counting orders...')
  const { count: totalCount } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })

  console.log(`Total orders: ${totalCount}\n`)

  // Count orders with tracking
  console.log('3. Counting orders with tracking_number...')
  const { count: withTrackingCount } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })
    .not('tracking_number', 'is', null)

  const percent = totalCount ? ((withTrackingCount || 0) / totalCount * 100).toFixed(1) : 0
  console.log(`Orders with tracking: ${withTrackingCount} (${percent}%)\n`)

  // Sample orders with tracking
  console.log('4. Sample orders with tracking_number:')
  const { data: sampleData } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, order_date')
    .not('tracking_number', 'is', null)
    .order('order_date', { ascending: false })
    .limit(5)

  if (sampleData && sampleData.length > 0) {
    console.table(sampleData)
  } else {
    console.log('❌ No orders with tracking_number found.')
    console.log('\nROOT CAUSE: tracking_number column exists but has no data!')
    console.log('\nNEXT STEPS:')
    console.log('1. Check import files to see if they contain tracking numbers')
    console.log('2. Update import logic to populate tracking_number column')
    console.log('3. Backfill existing orders if tracking data is available')
  }

  // Test search query if we have data
  if (sampleData && sampleData.length > 0) {
    const testTracking = sampleData[0].tracking_number
    console.log(`\n5. Testing search with tracking: "${testTracking}"`)

    const { data: searchData, error: searchError } = await supabase
      .from('sales_orders')
      .select('id, external_order_id, tracking_number')
      .or(`external_order_id.ilike.%${testTracking}%,tracking_number.ilike.%${testTracking}%`)
      .limit(10)

    if (searchError) {
      console.error('Search error:', searchError.message)
    } else {
      console.log(`✓ Found ${searchData.length} results`)
      console.table(searchData)
    }
  }

  // Check sample external_order_id for comparison
  console.log('\n6. Sample orders (to check external_order_id format):')
  const { data: allSample } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform, order_date')
    .order('order_date', { ascending: false })
    .limit(10)

  if (allSample) {
    console.table(allSample)
  }
}

checkTracking()
  .then(() => {
    console.log('\n=== Check complete ===')
    process.exit(0)
  })
  .catch(err => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
