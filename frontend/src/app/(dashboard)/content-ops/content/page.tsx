import Link from 'next/link'
import { AlertCircle, Video } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getContentList } from '../actions'

export const dynamic = 'force-dynamic'

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default async function ContentListPage() {
  const { data, total, error } = await getContentList()

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Content</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total} content ID{total !== 1 ? 's' : ''} · ranked by order volume · derived from facts
        </p>
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Video className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No content data</p>
            <p className="text-xs text-muted-foreground">
              Import TikTok affiliate orders to populate content entities.
            </p>
            <Link
              href="/content-ops/tiktok-affiliate/upload"
              className="text-xs underline hover:text-foreground"
            >
              Upload file →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[32px_1fr_80px_80px_64px_100px] items-center gap-2 px-4 py-2 bg-muted/30 border-b text-xs text-muted-foreground font-medium">
            <span>#</span>
            <span>Content ID</span>
            <span className="text-right">Orders</span>
            <span className="text-right">Settled</span>
            <span className="text-right">Products</span>
            <span className="text-right">Commission</span>
          </div>

          <div className="divide-y">
            {data.map((row, i) => (
              <Link
                key={row.contentId}
                href={`/content-ops/content/${encodeURIComponent(row.contentId)}`}
                className="grid grid-cols-[32px_1fr_80px_80px_64px_100px] items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
              >
                {/* Rank */}
                <span className="text-xs text-muted-foreground tabular-nums text-right font-mono">
                  {i + 1}
                </span>

                {/* Content ID */}
                <div className="min-w-0">
                  <p className="text-xs font-mono font-medium truncate group-hover:underline text-primary">
                    {row.contentId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.firstOrderDate ?? '—'}
                    {row.lastOrderDate && row.lastOrderDate !== row.firstOrderDate
                      ? ` → ${row.lastOrderDate}`
                      : ''}
                  </p>
                </div>

                {/* Total orders */}
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{row.totalOrders.toLocaleString()}</p>
                </div>

                {/* Settled */}
                <div className="text-right">
                  <p className="text-sm tabular-nums text-emerald-600">
                    {row.settledOrders.toLocaleString()}
                  </p>
                </div>

                {/* Products */}
                <div className="text-right">
                  <p className="text-sm tabular-nums text-muted-foreground">{row.productCount}</p>
                </div>

                {/* Commission */}
                <div className="text-right">
                  {row.totalCommission !== null ? (
                    <p className="text-sm tabular-nums">{fmt(row.totalCommission)}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </div>
              </Link>
            ))}
          </div>

          <div className="border-t px-4 py-2 bg-muted/20 text-xs text-muted-foreground">
            {data.length} content IDs · sorted by order volume · commission from facts (settled + other)
          </div>
        </div>
      )}
    </div>
  )
}
