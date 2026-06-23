#!/usr/bin/env node

/**
 * Fix status_group using individual updates (no upsert).
 */

const path = require('path');
const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAPPING = {
  'จัดส่งแล้ว': 'อยู่ระหว่างการจัดส่ง',
  'ที่จะจัดส่ง': 'อยู่ระหว่างการจัดส่ง',
  'เสร็จสมบูรณ์': 'จัดส่งแล้ว',
  'ยกเลิกแล้ว': 'ยกเลิกแล้ว',
};

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('  FIX status_group (UPDATE by ID)');
  console.log('='.repeat(80));

  try {
    console.log('\n▶ Fetching orders...');
    const { data: orders, error: err } = await supabase
      .from('sales_orders')
      .select('id, platform_status')
      .is('status_group', null)
      .eq('marketplace', 'tiktok');

    if (err) throw err;
    console.log(`  Found ${orders.length} orders\n`);

    let success = 0, failed = 0;

    // Update in small batches with delay
    for (let i = 0; i < orders.length; i += 20) {
      const batch = orders.slice(i, i + 20);
      
      const promises = batch.map(o => {
        const newStatus = MAPPING[o.platform_status];
        if (!newStatus) return Promise.resolve();
        
        return supabase
          .from('sales_orders')
          .update({ status_group: newStatus })
          .eq('id', o.id);
      });

      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r.error) failed++;
        else success++;
      });

      console.log(`  [${i+20}/${orders.length}] ${success} updated`);
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n  ✓ Success: ${success}`);
    if (failed > 0) console.log(`  ⚠ Failed: ${failed}`);

    // Verify
    const { count } = await supabase
      .from('sales_orders')
      .select('id', { count: 'exact', head: true })
      .is('status_group', null)
      .eq('marketplace', 'tiktok');

    console.log(`\n  NULL remaining: ${count}`);

    console.log('\n' + '='.repeat(80));
    console.log('  ✅ COMPLETE\n');

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
