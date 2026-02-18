#!/usr/bin/env node

/**
 * Migration Number Collision Checker
 *
 * Scans database-scripts/ for migration files and detects:
 * - Duplicate migration numbers
 * - Maximum migration number
 * - Next available migration number
 *
 * Exit codes:
 * - 0: No duplicates found (safe to proceed)
 * - 1: Duplicates detected (action required)
 *
 * Usage:
 *   node scripts/migration-check.js
 *   npm run migration:check
 */

const fs = require('fs');
const path = require('path');

// Configuration
const MIGRATION_DIR = path.join(__dirname, '..', 'database-scripts');
const MIGRATION_PATTERN = /^migration-(\d+)-.*\.sql$/;

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function colorize(text, color) {
  // Check if running in a terminal that supports colors
  if (process.stdout.isTTY) {
    return `${colors[color] || ''}${text}${colors.reset}`;
  }
  return text;
}

function log(symbol, message, color = 'reset') {
  console.log(colorize(`${symbol} ${message}`, color));
}

function main() {
  log('🔍', 'Scanning database-scripts/ for migrations...', 'blue');

  // Check if migration directory exists
  if (!fs.existsSync(MIGRATION_DIR)) {
    log('✗', `Migration directory not found: ${MIGRATION_DIR}`, 'red');
    process.exit(1);
  }

  // Read all files in the directory
  const files = fs.readdirSync(MIGRATION_DIR);

  // Parse migration files
  const migrations = [];
  const migrationMap = new Map(); // number -> [filenames]

  for (const file of files) {
    const match = file.match(MIGRATION_PATTERN);
    if (match) {
      const number = parseInt(match[1], 10);
      migrations.push({ file, number });

      if (!migrationMap.has(number)) {
        migrationMap.set(number, []);
      }
      migrationMap.get(number).push(file);
    }
  }

  if (migrations.length === 0) {
    log('✗', 'No migration files found matching pattern: migration-NNN-*.sql', 'red');
    process.exit(1);
  }

  log('✓', `Found ${migrations.length} migration files`, 'green');
  console.log(''); // blank line

  // Check for duplicates
  const duplicates = [];
  for (const [number, files] of migrationMap.entries()) {
    if (files.length > 1) {
      duplicates.push({ number, files });
    }
  }

  // Find max number
  const maxNumber = Math.max(...migrations.map(m => m.number));
  const nextNumber = maxNumber + 1;
  const nextNumberPadded = String(nextNumber).padStart(3, '0');

  // Report results
  if (duplicates.length > 0) {
    log('⚠', 'Duplicate migration numbers detected:', 'yellow');
    console.log('');

    for (const dup of duplicates) {
      const paddedNum = String(dup.number).padStart(3, '0');
      console.log(colorize(`  ${paddedNum}:`, 'yellow'));
      for (const file of dup.files) {
        console.log(colorize(`    - ${file}`, 'gray'));
      }
      console.log('');
    }

    log('✗', 'Duplicates found! Do NOT create new migrations until this is resolved.', 'red');
    console.log('');
    console.log(colorize('Historical duplicates (already executed) should NOT be renamed.', 'gray'));
    console.log(colorize('See docs/MIGRATIONS.md for guidance.', 'gray'));
    console.log('');
    log('ℹ', `Latest migration number: ${maxNumber}`, 'blue');
    log('ℹ', `Next available number: ${nextNumberPadded}`, 'blue');
    console.log('');
    console.log(colorize(`Recommendation: Use migration-${nextNumberPadded}-{your-description}.sql`, 'green'));

    process.exit(1);
  } else {
    log('✓', 'No duplicate migration numbers found', 'green');
    console.log('');
    log('ℹ', `Latest migration number: ${maxNumber}`, 'blue');
    log('ℹ', `Next available number: ${nextNumberPadded}`, 'blue');
    console.log('');
    console.log(colorize(`Recommendation: Use migration-${nextNumberPadded}-{your-description}.sql`, 'green'));

    process.exit(0);
  }
}

// Run main function
try {
  main();
} catch (error) {
  console.error(colorize('✗ Unexpected error:', 'red'), error.message);
  process.exit(1);
}
