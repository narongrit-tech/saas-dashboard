# Commit Message for Migration 040

```
feat: fix inventory stock in flow + SKU canonicalization

FIXES:
- Stock In modal failing with "item_id NOT NULL constraint violation"
- SKU lookup using wrong column (sku vs sku_internal)
- Missing SKU normalization (trim + uppercase)
- Receipt layers not created during Stock In
- SKU typo: NEWOWNN -> NEWONN (001/002)

CHANGES:
Database (migration-040-fix-stock-in-item-id.sql):
- Add item_id column to inventory_stock_in_documents
- Backfill existing rows via receipt_layers join
- Add index on item_id for performance

Code (frontend/src/app/(dashboard)/inventory/actions.ts):
- Normalize SKU: sku.trim().toUpperCase()
- Resolve item_id from inventory_items table
- Insert item_id into stock_in_documents
- Create receipt_layer with correct sku_internal
- Better error messages: "Inventory item not found: {sku}"

Documentation:
- README-migration-040.md: Complete guide + testing checklist
- fix-sku-canonicalization-NEWONN.sql: Helper script for SKU fixes
- PROJECT_STATUS.md: Document Stock In fix + SKU canonicalization

TESTING:
- Stock In creates both document + receipt layer
- SKU normalization works (lowercase/spaces -> uppercase/trimmed)
- COGS allocation works after Stock In
- No "item_id constraint" errors

PRODUCTS:
- NEWONN001 = Cool Smile Fresh Up
- NEWONN002 = Cool Smile Wind Down

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```
