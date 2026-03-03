'use client'

/**
 * Basis Toggle — compact pill selectors for GMV and COGS date basis.
 *
 * Syncs selections to URL params (gmvBasis, cogsBasis) via router.replace
 * without a full page navigation. On first mount, writes defaults to URL
 * if params are missing (same pattern as DateRangePickerClient).
 *
 * GMV:  'created' (Order Date, default) | 'paid' (Paid Date)
 * COGS: 'shipped' (Shipped Date, default) | 'created' (Order Date — decision view)
 */

import { useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { GmvBasis, CogsBasis } from '@/app/(dashboard)/actions'

interface BasisToggleClientProps {
  /** Server-resolved GMV basis */
  gmvBasis: GmvBasis
  /** Server-resolved COGS basis */
  cogsBasis: CogsBasis
}

function PillButton({
  active,
  onClick,
  children,
  first,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  first?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2.5 py-1 text-xs transition-colors',
        first ? '' : 'border-l',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-background text-foreground hover:bg-muted',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function BasisToggleClient({ gmvBasis, cogsBasis }: BasisToggleClientProps) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const pathname     = usePathname()

  // On first mount: write defaults to URL if params are missing
  useEffect(() => {
    if (!searchParams.get('gmvBasis') || !searchParams.get('cogsBasis')) {
      const p = new URLSearchParams(searchParams.toString())
      if (!p.get('gmvBasis'))  p.set('gmvBasis',  gmvBasis)
      if (!p.get('cogsBasis')) p.set('cogsBasis', cogsBasis)
      router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams.toString())
    p.set(key, value)
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      {/* GMV Basis */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground font-medium whitespace-nowrap">GMV:</span>
        <div className="inline-flex rounded border overflow-hidden">
          <PillButton first active={gmvBasis === 'created'} onClick={() => setParam('gmvBasis', 'created')}>
            Order Date
          </PillButton>
          <PillButton active={gmvBasis === 'paid'} onClick={() => setParam('gmvBasis', 'paid')}>
            Paid Date
          </PillButton>
        </div>
      </div>

      {/* COGS Basis */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground font-medium whitespace-nowrap">COGS:</span>
        <div className="inline-flex rounded border overflow-hidden">
          <PillButton first active={cogsBasis === 'shipped'} onClick={() => setParam('cogsBasis', 'shipped')}>
            Shipped Date
          </PillButton>
          <PillButton active={cogsBasis === 'created'} onClick={() => setParam('cogsBasis', 'created')}>
            Order Date
          </PillButton>
        </div>
      </div>

      {/* Help text — shown only in COGS decision-view mode */}
      {cogsBasis === 'created' && (
        <span className="text-amber-600 hidden sm:inline">
          · COGS (Order Date) เป็นมุมมองวิเคราะห์รายวัน ไม่ใช่การรับรู้ตามบัญชี
        </span>
      )}
    </div>
  )
}
