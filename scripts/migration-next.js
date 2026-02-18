#!/usr/bin/env node

/**
 * Get Next Migration Number
 *
 * Prints only the next available migration number (zero-padded).
 * Useful for scripting and automation.
 *
 * Usage:
 *   node scripts/migration-next.js
 *   npm run migration:next
 *
 * Output:
 *   060
 */

const fs = require('fs');
const path = require('path');

const MIGRATION_DIR = path.join(__dirname, '..', 'database-scripts');
const MIGRATION_PATTERN = /^migration-(\d+)-.*\.sql$/;

try {
  if (!fs.existsSync(MIGRATION_DIR)) {
    console.error('Migration directory not found');
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATION_DIR);
  const numbers = files
    .map(file => {
      const match = file.match(MIGRATION_PATTERN);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter(n => n !== null);

  if (numbers.length === 0) {
    console.error('No migration files found');
    process.exit(1);
  }

  const maxNumber = Math.max(...numbers);
  const nextNumber = maxNumber + 1;
  const nextNumberPadded = String(nextNumber).padStart(3, '0');

  console.log(nextNumberPadded);
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
