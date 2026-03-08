'use client'

/**
 * Basis Toggle — compact pill selectors for Revenue and COGS date basis.
 *
 * Revenue: 'gmv' (default) | 'cashin' (เงินเข้าจริง from marketplace settlements) | 'bank'
 * COGS:    'shipped' (Shipped Date, default) | 'created' (Order Date — decision view)
 *
 * GMV is always bucketed by created_time — no paid date toggle.
 * Syncs selections to URL params via router.replace without full page navigation.
 */

import { useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { CogsBasis, RevenueBasis } from '@/app/(dashboard)/actions'

interface BasisToggleClientProps {
  cogsBasis:    CogsBasis
  revenueBasis: RevenueBasis
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
        'px-3 py-1 text-xs transition-colors',
        first ? '' : 'border-l',
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function BasisToggleClient({ cogsBasis, revenueBasis }: BasisToggleClientProps) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const pathname     = usePathname()

  // On first mount: write defaults to URL if params are missing
  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString())
    let changed = false
    if (!p.get('revBasis'))  { p.set('revBasis',  revenueBasis); changed = true }
    if (!p.get('cogsBasis')) { p.set('cogsBasis', cogsBasis);    changed = true }
    if (changed) router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams.toString())
    p.set(key, value)
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">

      {/* Revenue Basis */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground font-medium whitespace-nowrap">Revenue:</span>
        <div className="inline-flex rounded border overflow-hidden">
          <PillButton first active={revenueBasis === 'gmv'} onClick={() => setParam('revBasis', 'gmv')}>
            GMV
          </PillButton>
          <PillButton active={revenueBasis === 'cashin'} onClick={() => setParam('revBasis', 'cashin')}>
            Cash In
          </PillButton>
          <PillButton active={revenueBasis === 'bank'} onClick={() => setParam('revBasis', 'bank')}>
            Bank
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

      {/* Help texts */}
      {revenueBasis === 'cashin' && (
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
          เงินรับจริงจาก Settlement หลังหักค่าธรรมเนียม
        </span>
      )}
      {revenueBasis === 'bank' && (
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
          คลิกที่การ์ด Bank Inflows เพื่อเลือกรายการ
        </span>
      )}
      {cogsBasis === 'created' && (
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
          COGS (Order Date) = มุมมองวิเคราะห์เท่านั้น
        </span>
      )}
    </div>
  )
}
