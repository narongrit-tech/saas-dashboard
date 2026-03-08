interface Props {
  revenue: number
  productSpend: number
  liveSpend: number
  awarenessSpend: number
  cogs: number
  operating: number
  tax: number
  revenueBasis?: string
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Row({
  label,
  value,
  indent = false,
  subtotal = false,
  highlight = false,
  negative = true,
  labelNote,
}: {
  label: string
  value: number
  indent?: boolean
  subtotal?: boolean
  highlight?: boolean
  negative?: boolean
  labelNote?: string
}) {
  const isNeg = negative && value !== 0
  return (
    <div
      className={[
        'flex justify-between items-center px-3 py-2',
        subtotal ? 'border-t border-b font-semibold bg-muted/30' : '',
        highlight ? 'rounded-lg border-2 font-bold text-base py-3' : '',
      ].join(' ')}
    >
      <span className={[
        'text-sm',
        indent ? 'pl-6 text-muted-foreground' : '',
        highlight ? 'text-base font-bold' : '',
      ].join(' ')}>
        {label}
        {labelNote && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">{labelNote}</span>
        )}
      </span>
      <span className={[
        'font-mono text-sm',
        isNeg ? 'text-red-600' : 'text-foreground',
        highlight ? 'text-lg font-bold' : '',
        value < 0 && !negative ? 'text-red-600' : '',
      ].join(' ')}>
        {isNeg ? `(฿${fmt(value)})` : `฿${fmt(value)}`}
      </span>
    </div>
  )
}

export function ProfitBridge({
  revenue,
  productSpend,
  liveSpend,
  awarenessSpend,
  cogs,
  operating,
  tax,
  revenueBasis,
}: Props) {
  const totalAdSpend = productSpend + liveSpend + awarenessSpend
  const net = revenue - totalAdSpend - cogs - operating - tax
  const isProfit = net >= 0

  const revenueLabel = revenueBasis === 'cashin'
    ? 'Cash In (Settlement Date)'
    : revenueBasis === 'bank'
    ? 'Bank Inflows (Selected)'
    : 'Revenue (GMV)'

  return (
    <div className="space-y-0.5">
      {/* Revenue row */}
      <div className={[
        'flex justify-between items-center rounded-t-lg px-3 py-2.5',
        revenueBasis === 'cashin'
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : revenueBasis === 'bank'
          ? 'bg-emerald-50 dark:bg-emerald-900/20'
          : 'bg-green-50 dark:bg-green-900/20',
      ].join(' ')}>
        <span className="font-semibold text-sm">{revenueLabel}</span>
        <span className={[
          'font-mono font-bold',
          revenueBasis === 'cashin'
            ? 'text-blue-700 dark:text-blue-400'
            : revenueBasis === 'bank'
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-green-700 dark:text-green-400',
        ].join(' ')}>
          ฿{fmt(revenue)}
        </span>
      </div>

      {/* Deduction rows */}
      <div className="rounded-lg border bg-muted/20 overflow-hidden divide-y">
        <Row label="Less: Product Ads"   value={productSpend}   indent negative />
        <Row label="Less: Live Ads"      value={liveSpend}      indent negative />
        <Row label="Less: Awareness Ads" value={awarenessSpend} indent negative />
        <Row label="Total Ad Spend" value={totalAdSpend} subtotal negative />
        <Row label="Less: COGS"          value={cogs}           indent negative />
        <Row label="Less: Operating"     value={operating}      indent negative />
        <Row label="Less: Tax"           value={tax}            indent negative />
      </div>

      {/* Net Profit row */}
      <div className={[
        'flex justify-between items-center rounded-b-lg px-3 py-3 border',
        isProfit
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40'
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40',
      ].join(' ')}>
        <span className={`font-bold text-base ${isProfit ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'}`}>
          {revenueBasis === 'cashin' || revenueBasis === 'bank' ? '= Net Cash' : '= Net Profit'}
        </span>
        <span className={`text-xl font-bold font-mono ${isProfit ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
          {isProfit ? '' : '-'}฿{fmt(Math.abs(net))}
        </span>
      </div>
    </div>
  )
}
