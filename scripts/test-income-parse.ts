/**
 * DEV ONLY - Test TikTok Income Parser
 * Run: npx tsx scripts/test-income-parse.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseIncomeExcel } from '../frontend/src/lib/importers/tiktok-income';

const SAMPLE_FILE = '/mnt/data/income_20260119121416(UTC+7).xlsx';

async function testIncomeParser() {
  console.log('='.repeat(60));
  console.log('Testing TikTok Income Parser');
  console.log('='.repeat(60));
  console.log();

  try {
    // Check if file exists
    if (!fs.existsSync(SAMPLE_FILE)) {
      console.error(`❌ Sample file not found: ${SAMPLE_FILE}`);
      console.log('Please ensure the sample file exists at the specified path.');
      return;
    }

    console.log(`📁 Reading file: ${SAMPLE_FILE}`);
    const fileBuffer = fs.readFileSync(SAMPLE_FILE);
    console.log(`✅ File read successfully (${fileBuffer.length} bytes)`);
    console.log();

    console.log('🔄 Parsing Excel...');
    const { rows, warnings } = parseIncomeExcel(fileBuffer);
    console.log(`✅ Parsing completed`);
    console.log();

    // Summary
    console.log('📊 SUMMARY:');
    console.log(`   Total rows parsed: ${rows.length}`);
    console.log(`   Warnings: ${warnings.length}`);
    console.log();

    // Warnings
    if (warnings.length > 0) {
      console.log('⚠️  WARNINGS:');
      warnings.slice(0, 5).forEach((warning, i) => {
        console.log(`   ${i + 1}. ${warning}`);
      });
      if (warnings.length > 5) {
        console.log(`   ... and ${warnings.length - 5} more warnings`);
      }
      console.log();
    }

    // Sample rows
    if (rows.length > 0) {
      console.log('📝 SAMPLE ROWS (first 3):');
      console.log();
      rows.slice(0, 3).forEach((row, i) => {
        console.log(`   Row ${i + 1}:`);
        console.log(`     Transaction ID: ${row.txn_id}`);
        console.log(`     Order ID: ${row.order_id || 'N/A'}`);
        console.log(`     Type: ${row.type || 'N/A'}`);
        console.log(`     Settled Time: ${row.settled_time ? row.settled_time.toISOString() : 'N/A'}`);
        console.log(`     Settlement Amount: ${row.settlement_amount} ${row.currency}`);
        console.log(`     Gross Revenue: ${row.gross_revenue !== null ? row.gross_revenue : 'N/A'}`);
        console.log(`     Fees Total: ${row.fees_total !== null ? row.fees_total : 'N/A'}`);
        console.log();
      });
    }

    console.log('✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Error during parsing:');
    console.error(error);
  }
}

testIncomeParser();
