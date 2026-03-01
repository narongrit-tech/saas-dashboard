/**
 * Analytics Builder — View Templates
 * Pre-defined configurations to quickly set up common analysis views.
 *
 * Templates define metrics + expression + label + dimension.
 * dateRange is NOT included (kept from current UI state).
 *
 * Unavailable metrics (funnel/fees/vat) are intentionally included in some
 * templates to show the intended full scope. The FE renders them as disabled
 * chips and disables Run until they are removed.
 */

import type { AnalyticsDefinition, MetricRef } from '@/types/analytics-builder'

export interface ViewTemplate {
  id: string
  label: string
  description: string
  /** Partial AnalyticsDefinition without dateRange — supplied by current UI state */
  definition: Omit<AnalyticsDefinition, 'dateRange'>
}

export const VIEW_TEMPLATES: ViewTemplate[] = [
  // ─── 1. Sales Funnel ──────────────────────────────────────────────────────
  {
    id: 'sales_funnel',
    label: 'Sales Funnel (Qty/Amount)',
    description: 'Shipped vs cancelled/refunded orders and revenue by day',
    definition: {
      dimension: 'date',
      expression: '',
      expressionLabel: undefined,
      metrics: [
        { kind: 'metric', key: 'orders' },          // Shipped Orders ✅
        { kind: 'metric', key: 'units' },            // Shipped Units ✅
        { kind: 'metric', key: 'revenue' },          // Shipped Revenue ✅
        { kind: 'funnel', metric: 'orders', status: 'all' },     // All Orders ❌
        { kind: 'funnel', metric: 'orders', status: 'cancel' },  // Cancelled ❌
        { kind: 'funnel', metric: 'orders', status: 'refund' },  // Refunded ❌
        { kind: 'funnel', metric: 'revenue', status: 'all' },    // All Revenue ❌
        { kind: 'funnel', metric: 'revenue', status: 'cancel' }, // Cancel Rev ❌
        { kind: 'funnel', metric: 'revenue', status: 'refund' }, // Refund Rev ❌
      ] satisfies MetricRef[],
    },
  },

  // ─── 2. P&L (Like Sheet) ─────────────────────────────────────────────────
  {
    id: 'pnl',
    label: 'P&L (Like Sheet)',
    description: 'Revenue – COGS – Ads (split) – Expenses – Fees – VAT',
    definition: {
      dimension: 'date',
      // Expression uses slot names from getMetricSlot():
      //   revenue, cogs, ads_product, ads_live, ads_aware,
      //   x_op_packing (expense_subcategory Operating/Packing — EXAMPLE),
      //   fees_total (unavailable), vat_total (unavailable)
      expression: 'revenue - cogs - ads_product - ads_live - ads_aware - x_op_packing - fees_total - vat_total',
      expressionLabel: 'Net Profit',
      metrics: [
        { kind: 'metric', key: 'revenue' },                                                         // ✅
        { kind: 'metric', key: 'cogs' },                                                            // ✅
        { kind: 'ads_spend', campaignType: 'product' },                                             // ✅
        { kind: 'ads_spend', campaignType: 'live' },                                                // ✅
        { kind: 'ads_spend', campaignType: 'aware' },                                               // ✅
        { kind: 'expense_subcategory', category: 'Operating', subcategory: 'Packing' },             // ✅ EXAMPLE
        { kind: 'fees', key: 'total' },                                                             // ❌
        { kind: 'vat', key: 'total' },                                                              // ❌
      ] satisfies MetricRef[],
    },
  },

  // ─── 3. Product Profit (by SKU) ───────────────────────────────────────────
  {
    id: 'product_profit',
    label: 'Product Profit (by SKU)',
    description: 'Gross profit per product — dimension=product (not yet available)',
    definition: {
      dimension: 'product',   // ← entire template unavailable until BE supports product dimension
      expression: 'revenue - cogs',
      expressionLabel: 'Gross Profit',
      metrics: [
        { kind: 'metric', key: 'revenue' },  // ✅ (but dimension blocks Run)
        { kind: 'metric', key: 'units' },    // ✅
        { kind: 'metric', key: 'cogs' },     // ✅
      ] satisfies MetricRef[],
    },
  },

  // ─── 4. Expense Drilldown ─────────────────────────────────────────────────
  {
    id: 'expense_drilldown',
    label: 'Expense Drilldown',
    description: 'Breakdown by expense subcategory — add subcategories via the picker',
    definition: {
      dimension: 'date',
      expression: '',
      expressionLabel: undefined,
      metrics: [],  // user adds expense_subcategory refs via the picker
    },
  },
]
