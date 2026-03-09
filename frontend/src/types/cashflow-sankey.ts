// Inflow source node labels
export type InflowSource =
  | 'tiktok_settlement'
  | 'shopee_settlement'
  | 'director_loan'
  | 'other_income'

// Outflow category node labels
export type OutflowCategory =
  | 'operating'
  | 'inventory_supplier'
  | 'tax'
  | 'wallet_topup'
  | 'ceo_withdrawal'
  | 'loan_repayment'
  | 'other_outflow'

export const INFLOW_SOURCE_LABELS: Record<InflowSource, string> = {
  tiktok_settlement: 'TikTok Settlement',
  shopee_settlement: 'Shopee Settlement',
  director_loan:     'Director Loan',
  other_income:      'Other Income',
}

export const OUTFLOW_CATEGORY_LABELS: Record<OutflowCategory, string> = {
  operating:          'Operating',
  inventory_supplier: 'Inventory / Supplier',
  tax:                'Tax',
  wallet_topup:       'Wallet Top-up',
  ceo_withdrawal:     'CEO Withdrawal',
  loan_repayment:     'Loan Repayment',
  other_outflow:      'Other Outflow',
}

export interface CashflowNodeClassification {
  id: string
  bank_transaction_id: string
  inflow_source:    InflowSource | null
  outflow_category: OutflowCategory | null
  outflow_sub:      string | null
  note:             string | null
}

export interface RawTxnForSankey {
  id:              string
  bank_account_id: string
  deposit:         number
  withdrawal:      number
  txn_date:        string
  description:     string | null
  inflow_source:    InflowSource | null
  outflow_category: OutflowCategory | null
  outflow_sub:      string | null
}

export interface SankeyNode {
  name:        string
  nodeId:      string  // internal stable ID e.g. 'src:tiktok_settlement', 'acct:uuid', 'cat:operating'
  layer:       'source' | 'account' | 'category'
  amount:      number
  color:       string
}

export interface SankeyLink {
  source:      number   // index into nodes array
  target:      number
  value:       number
  sourceNodeId: string  // for tooltip / coloring
  targetNodeId: string
}

export interface SankeyPayload {
  nodes:      SankeyNode[]
  links:      SankeyLink[]
  summary:    { totalIn: number; totalOut: number; net: number }
  drilldown:  Record<string, string[]>   // nodeId → txn IDs that belong to this node
  dateRange:  { from: string; to: string }
}

export interface SankeyTxnRow {
  id:              string
  txn_date:        string
  description:     string | null
  deposit:         number
  withdrawal:      number
  bank_account_id: string
  bank_name:       string
  inflow_source:    InflowSource | null
  outflow_category: OutflowCategory | null
  outflow_sub:      string | null
  note:             string | null
}
