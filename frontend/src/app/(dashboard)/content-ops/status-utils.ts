export const CONTENT_OPS_STATUSES = [
  'settled',
  'pending',
  'awaiting_payment',
  'ineligible',
] as const

export type ContentOpsStatus = (typeof CONTENT_OPS_STATUSES)[number]

export const CONTENT_OPS_STATUS_LABELS: Record<ContentOpsStatus, string> = {
  settled: 'Settled',
  pending: 'Pending',
  awaiting_payment: 'Awaiting Payment',
  ineligible: 'Ineligible',
}

export function normalizeContentOpsStatus(value: string | null | undefined): ContentOpsStatus | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/\s+/g, '_')

  switch (normalized) {
    case 'settled':
    case 'completed':
      return 'settled'
    case 'pending':
      return 'pending'
    case 'awaiting_payment':
      return 'awaiting_payment'
    case 'ineligible':
    case 'cancelled':
      return 'ineligible'
    default:
      return null
  }
}

export function getContentOpsStatusLabel(value: string | null | undefined): string {
  const normalized = normalizeContentOpsStatus(value)
  if (normalized) {
    return CONTENT_OPS_STATUS_LABELS[normalized]
  }

  return value ?? 'Unknown'
}
