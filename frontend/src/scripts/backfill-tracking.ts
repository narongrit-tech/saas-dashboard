import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function backfillTracking() {
  console.log('=== Backfill tracking_number from metadata ===\n')

  // 1. Check BEFORE state
  console.log('1. Checking BEFORE state...')
  const { count: totalBefore } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })

  const { count: withTrackingBefore } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })
    .not('tracking_number', 'is', null)

  console.log(`Total orders: ${totalBefore}`)
  console.log(`With tracking_number: ${withTrackingBefore}`)
  console.log(`Percent: ${totalBefore ? ((withTrackingBefore || 0) / totalBefore * 100).toFixed(1) : 0}%\n`)

  // 2. Check metadata availability
  console.log('2. Checking metadata...')
  const { data: sampleWithMetadata } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, metadata')
    .not('metadata->>tracking_id', 'is', null)
    .limit(5)

  if (!sampleWithMetadata || sampleWithMetadata.length === 0) {
    console.log('❌ No orders with metadata.tracking_id found.')
    console.log('Nothing to backfill. Exiting.\n')
    return
  }

  console.log(`Found ${sampleWithMetadata.length} sample orders with tracking_id in metadata:`)
  console.table(sampleWithMetadata.map(o => ({
    external_order_id: o.external_order_id,
    tracking_number: o.tracking_number,
    tracking_from_metadata: (o.metadata as any)?.tracking_id || null
  })))

  // 3. Perform backfill
  console.log('\n3. Performing backfill...')
  console.log('Fetching orders with metadata.tracking_id...')

  // Fetch all orders with tracking_id in metadata but NULL tracking_number
  const { data: ordersToUpdate, error: fetchError } = await supabase
    .from('sales_orders')
    .select('id, metadata')
    .not('metadata->>tracking_id', 'is', null)
    .is('tracking_number', null)

  if (fetchError) {
    console.error('Error fetching orders:', fetchError)
    return
  }

  if (!ordersToUpdate || ordersToUpdate.length === 0) {
    console.log('✓ No orders need backfilling (all already have tracking_number set)')
    return
  }

  console.log(`Found ${ordersToUpdate.length} orders to backfill`)

  // Update in batches of 500
  const BATCH_SIZE = 500
  let updated = 0
  let errors = 0

  for (let i = 0; i < ordersToUpdate.length; i += BATCH_SIZE) {
    const batch = ordersToUpdate.slice(i, i + BATCH_SIZE)
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ordersToUpdate.length / BATCH_SIZE)}...`)

    for (const order of batch) {
      const trackingId = (order.metadata as any)?.tracking_id
      if (!trackingId || trackingId.trim() === '') continue

      const { error: updateError } = await supabase
        .from('sales_orders')
        .update({ tracking_number: trackingId.trim() })
        .eq('id', order.id)

      if (updateError) {
        console.error(`Error updating order ${order.id}:`, updateError.message)
        errors++
      } else {
        updated++
      }
    }
  }

  console.log(`\n✓ Backfill complete: ${updated} orders updated, ${errors} errors\n`)

  // 4. Check AFTER state
  console.log('4. Checking AFTER state...')
  const { count: totalAfter } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })

  const { count: withTrackingAfter } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })
    .not('tracking_number', 'is', null)

  console.log(`Total orders: ${totalAfter}`)
  console.log(`With tracking_number: ${withTrackingAfter}`)
  console.log(`Percent: ${totalAfter ? ((withTrackingAfter || 0) / totalAfter * 100).toFixed(1) : 0}%\n`)

  // 5. Sample backfilled data
  console.log('5. Sample backfilled orders:')
  const { data: sampleAfter } = await supabase
    .from('sales_orders')
    .select('id, external_order_id, tracking_number, source_platform, order_date')
    .not('tracking_number', 'is', null)
    .order('order_date', { ascending: false })
    .limit(10)

  if (sampleAfter) {
    console.table(sampleAfter)
  }

  // 6. Test search
  if (sampleAfter && sampleAfter.length > 0) {
    const testTracking = sampleAfter[0].tracking_number
    console.log(`\n6. Testing search with tracking: "${testTracking}"`)

    const { data: searchResults, error: searchError } = await supabase
      .from('sales_orders')
      .select('id, external_order_id, tracking_number')
      .or(`external_order_id.ilike.%${testTracking}%,tracking_number.ilike.%${testTracking}%`)
      .limit(10)

    if (searchError) {
      console.error('Search error:', searchError)
    } else {
      console.log(`✓ Search found ${searchResults.length} results`)
      if (searchResults.length > 0) {
        console.table(searchResults)
      }
    }
  }
}

backfillTracking()
  .then(() => {
    console.log('\n=== Backfill script complete ===')
    process.exit(0)
  })
  .catch(err => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
