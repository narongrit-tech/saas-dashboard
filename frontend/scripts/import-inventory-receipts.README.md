# Inventory Receipt Layers Import Script

This TypeScript script imports inventory receipt data for the saas-dashboard application. It parses receipt data from specified dates, creates inventory receipt layer records, and handles returnable items that can be resold.

## Overview

The script performs the following operations:

1. **Loads receipt data** for specific dates:
   - 18/05/2026: Fresh Up (938 Qty @ 48/unit, PO001/2026) + Wind Down (500 Qty @ 70/unit, PO029)
   - 29/05/2026: Fresh Up (1000 Qty @ 48/unit, PO002/2026)

2. **Creates inventory_receipt_layers rows** with:
   - `ref_type='PURCHASE'`
   - `ref_id` parsed from PO number or generated as UUID
   - Product details (name, quantity, unit cost)
   - Receipt date in Bangkok timezone (UTC+7)
   - Auto-generated timestamps

3. **Checks inventory_returns table** for returnable items with:
   - `quantity > 0`
   - `can_resell = true`

4. **Creates inventory_adjustments** for each returnable item:
   - `type='ADJUST_IN'`
   - Reason: 'resellable_return'
   - Auto-creates corresponding receipt layer

5. **Outputs JSON summary** with:
   - `receipts_added`: Count of receipt layers inserted
   - `returns_processed`: Count of adjustments created
   - `total_qty`: Total quantity processed
   - `total_cost`: Total cost value
   - `dry_run`: Whether dry-run mode was used
   - `errors`: Array of any errors encountered

## Installation

The script requires the following dependencies (already present in package.json):
- `@supabase/supabase-js`: ^2.90.1
- `dotenv`: ^17.4.2
- `date-fns-tz`: ^3.2.0

No additional installation needed.

## Configuration

Create a `.env.local` file in the `frontend` directory with:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

The script uses the service role client which bypasses Row-Level Security (RLS).

## Usage

### Dry Run (Preview Mode)

Preview the changes without saving to the database:

```bash
npx tsx scripts/import-inventory-receipts.ts --dry-run
```

This will display:
- All receipt layers to be imported
- All adjustments to be created
- Summary JSON with counts and totals

### Real Import

Import data into the database:

```bash
npx tsx scripts/import-inventory-receipts.ts
```

### Help

Display usage information:

```bash
npx tsx scripts/import-inventory-receipts.ts --help
```

## Output Example

```json
{
  "receipts_added": 3,
  "returns_processed": 0,
  "total_qty": 2438,
  "total_cost": 80084,
  "dry_run": true,
  "errors": []
}
```

## Data Model

### inventory_receipt_layers

Columns created for each receipt:
| Column | Value |
|--------|-------|
| id | UUID |
| ref_type | 'PURCHASE' |
| ref_id | Parsed PO# or UUID |
| product_name | Product name |
| quantity | Quantity |
| unit_cost | Unit price |
| total_cost | quantity × unit_cost |
| receipt_date | ISO date string |
| notes | PO description or 'Imported receipt' |
| created_at | Current timestamp |

### inventory_adjustments

Columns created for returnable items:
| Column | Value |
|--------|-------|
| id | UUID |
| type | 'ADJUST_IN' |
| product_name | Product name |
| quantity | Returnable quantity |
| unit_cost | Unit cost |
| total_cost | quantity × unit_cost |
| reason | 'resellable_return' |
| notes | 'Auto-adjustment from inventory returns' |
| created_at | Current timestamp |

## Error Handling

The script includes:
- **Duplicate detection**: Prevents re-importing the same data
- **Date validation**: Uses Bangkok timezone (UTC+7) for all dates
- **Batch error handling**: Tracks and logs batch-level errors
- **Graceful failures**: Continues processing even if individual batches fail

Errors are collected in the `errors` array of the summary output.

## Batch Processing

- Records are processed in batches of 100 to optimize database performance
- Progress is shown for each batch operation
- Errors in one batch don't stop subsequent batches

## Notes

- The script uses Bangkok timezone (Asia/Bangkok, UTC+7) for date parsing
- PO numbers are extracted from the hardcoded receipt data
- All identifiers (IDs) are generated as UUID v4
- The script respects Supabase Row-Level Security when using the service role client
- Adjustment rows automatically create corresponding receipt layers via database triggers

## Troubleshooting

### "SUPABASE_SERVICE_ROLE_KEY is not set"
- Ensure `.env.local` exists in the `frontend` directory
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly
- Service role keys start with `eyJhbGc...`

### "Failed to fetch returnable items"
- Check that `inventory_returns` table exists and is accessible
- Verify the service role has SELECT permissions on the table

### Batch import failures
- Check the error message in the `errors` array
- Verify the database schema matches expected columns
- Ensure row-level security policies don't conflict

## Future Enhancement

To make this script reusable for different receipt batches:
1. Create a command-line flag to specify receipt data
2. Parse receipt data from a JSON or CSV file
3. Support dynamic date ranges
