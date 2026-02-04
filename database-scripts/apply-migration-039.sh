#!/bin/bash

# Apply Migration 039: Fix rebuild_profit_summaries duplicates
# Usage: ./apply-migration-039.sh

set -e

echo "🔄 Applying Migration 039: Fix rebuild_profit_summaries() duplicate key error..."
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  echo "Please set it first:"
  echo "  export DATABASE_URL='postgresql://user:pass@host:port/dbname'"
  exit 1
fi

# Apply the migration
psql "$DATABASE_URL" -f migration-039-fix-rebuild-profit-summaries-duplicates.sql

echo ""
echo "✅ Migration 039 applied successfully!"
echo ""
echo "📋 Next steps:"
echo "  1. Go to Profit Reports page in the dashboard"
echo "  2. Select a date range"
echo "  3. Click 'Rebuild Summaries' button"
echo "  4. Verify that it completes without error 23505"
echo "  5. Check that D1-D table shows data"
echo "  6. Run it again to test idempotency"
