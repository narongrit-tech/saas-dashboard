import type {
  RawTxnForSankey,
  SankeyPayload,
  SankeyNode,
  SankeyLink,
  InflowSource,
  OutflowCategory,
} from '@/types/cashflow-sankey'
import { INFLOW_SOURCE_LABELS, OUTFLOW_CATEGORY_LABELS } from '@/types/cashflow-sankey'

interface BankAccountInfo {
  id:             string
  bank_name:      string
  account_number: string
}

const SOURCE_COLORS: Record<InflowSource | 'unclassified_in', string> = {
  tiktok_settlement: '#3b82f6',  // blue
  shopee_settlement: '#f97316',  // orange
  director_loan:     '#8b5cf6',  // purple
  other_income:      '#10b981',  // emerald
  unclassified_in:   '#94a3b8',  // slate
}

const CATEGORY_COLORS: Record<OutflowCategory | 'unclassified_out', string> = {
  operating:          '#ef4444',  // red
  inventory_supplier: '#f59e0b',  // amber
  tax:                '#6366f1',  // indigo
  wallet_topup:       '#06b6d4',  // cyan
  ceo_withdrawal:     '#ec4899',  // pink
  loan_repayment:     '#84cc16',  // lime
  other_outflow:      '#78716c',  // stone
  unclassified_out:   '#94a3b8',  // slate
}

export function buildSankeyPayload(
  transactions: RawTxnForSankey[],
  accounts: BankAccountInfo[],
  from: string,
  to: string,
): SankeyPayload {
  // 1. Build account lookup
  const acctMap = new Map(accounts.map(a => [a.id, a]))

  // 2. Collect unique node IDs per layer
  const srcIds  = new Set<string>()
  const acctIds = new Set<string>()
  const catIds  = new Set<string>()

  for (const txn of transactions) {
    if (txn.bank_account_id) acctIds.add(`acct:${txn.bank_account_id}`)

    if (txn.deposit > 0) {
      const srcKey = txn.inflow_source ? `src:${txn.inflow_source}` : 'src:unclassified_in'
      srcIds.add(srcKey)
    }
    if (txn.withdrawal > 0) {
      const catKey = txn.outflow_category ? `cat:${txn.outflow_category}` : 'cat:unclassified_out'
      catIds.add(catKey)
    }
  }

  // 3. Build nodes array (order: sources, accounts, categories)
  const nodes: SankeyNode[] = []
  const nodeIndex = new Map<string, number>()

  const addNode = (nodeId: string, name: string, layer: SankeyNode['layer'], color: string) => {
    nodeIndex.set(nodeId, nodes.length)
    nodes.push({ nodeId, name, layer, amount: 0, color })
  }

  for (const nodeId of srcIds) {
    const key = nodeId.replace('src:', '') as InflowSource | 'unclassified_in'
    const name = key === 'unclassified_in' ? 'Unclassified Inflow' : INFLOW_SOURCE_LABELS[key as InflowSource]
    addNode(nodeId, name, 'source', SOURCE_COLORS[key] ?? '#94a3b8')
  }
  for (const nodeId of acctIds) {
    const acctId = nodeId.replace('acct:', '')
    const acct = acctMap.get(acctId)
    const last4 = acct?.account_number?.slice(-4) ?? '????'
    const name = acct ? `${acct.bank_name} (\u2026${last4})` : nodeId
    addNode(nodeId, name, 'account', '#1e40af')
  }
  for (const nodeId of catIds) {
    const key = nodeId.replace('cat:', '') as OutflowCategory | 'unclassified_out'
    const name = key === 'unclassified_out' ? 'Unclassified Outflow' : OUTFLOW_CATEGORY_LABELS[key as OutflowCategory]
    addNode(nodeId, name, 'category', CATEGORY_COLORS[key] ?? '#94a3b8')
  }

  // 4. Accumulate links (source_idx → target_idx → accumulated_value)
  const linkMap = new Map<string, { source: number; target: number; value: number; sourceNodeId: string; targetNodeId: string }>()
  const drilldown: Record<string, string[]> = {}

  const addToNode = (nodeId: string, amount: number) => {
    const idx = nodeIndex.get(nodeId)
    if (idx !== undefined) nodes[idx].amount += amount
  }

  const addToDrilldown = (nodeId: string, txnId: string) => {
    if (!drilldown[nodeId]) drilldown[nodeId] = []
    drilldown[nodeId].push(txnId)
  }

  const addLink = (fromId: string, toId: string, value: number) => {
    const key = `${fromId}|||${toId}`
    const fromIdx = nodeIndex.get(fromId)
    const toIdx   = nodeIndex.get(toId)
    if (fromIdx === undefined || toIdx === undefined) return
    if (!linkMap.has(key)) {
      linkMap.set(key, { source: fromIdx, target: toIdx, value: 0, sourceNodeId: fromId, targetNodeId: toId })
    }
    linkMap.get(key)!.value += value
  }

  let totalIn  = 0
  let totalOut = 0

  for (const txn of transactions) {
    const acctId = `acct:${txn.bank_account_id}`

    if (txn.deposit > 0) {
      const srcId = txn.inflow_source ? `src:${txn.inflow_source}` : 'src:unclassified_in'
      addLink(srcId, acctId, txn.deposit)
      addToNode(srcId, txn.deposit)
      addToNode(acctId, txn.deposit)
      addToDrilldown(srcId, txn.id)
      addToDrilldown(acctId, txn.id)
      totalIn += txn.deposit
    }
    if (txn.withdrawal > 0) {
      const catId = txn.outflow_category ? `cat:${txn.outflow_category}` : 'cat:unclassified_out'
      addLink(acctId, catId, txn.withdrawal)
      addToNode(catId, txn.withdrawal)
      addToDrilldown(catId, txn.id)
      totalOut += txn.withdrawal
    }
  }

  const links: SankeyLink[] = Array.from(linkMap.values())

  return {
    nodes,
    links,
    summary: { totalIn, totalOut, net: totalIn - totalOut },
    drilldown,
    dateRange: { from, to },
  }
}
