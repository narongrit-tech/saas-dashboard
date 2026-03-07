'use client'

/**
 * Basis Toggle — compact pill selectors for Revenue, GMV date, and COGS date basis.
 *
 * Revenue: 'gmv' (default) | 'cashin' (เงินเข้าจริง from marketplace settlements)
 * GMV:     'created' (Order Date, default) | 'paid' (Paid Date) — hidden when Revenue=Cash In
 * COGS:    'shipped' (Shipped Date, default) | 'created' (Order Date — decision view)
 *
 * Syncs selections to URL params via router.replace without full page navigation.
 */

import { useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { GmvBasis, CogsBasis, RevenueBasis } from '@/app/(dashboard)/actions'

interface BasisToggleClientProps {
  gmvBasis:     GmvBasis
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

export function BasisToggleClient({ gmvBasis, cogsBasis, revenueBasis }: BasisToggleClientProps) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const pathname     = usePathname()

  // On first mount: write defaults to URL if params are missing
  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString())
    let changed = false
    if (!p.get('revBasis'))  { p.set('revBasis',  revenueBasis); changed = true }
    if (!p.get('gmvBasis'))  { p.set('gmvBasis',  gmvBasis);     changed = true }
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

      {/* GMV Date Basis — hidden when Revenue != GMV */}
      {revenueBasis === 'gmv' && (
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
      )}

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
        <span className="text-blue-600 hidden sm:inline">
          · Cash In = เงินรับจริงจาก Settlement หลังหักค่าธรรมเนียม (TikTok + Shopee)
        </span>
      )}
      {revenueBasis === 'bank' && (
        <span className="text-emerald-600 hidden sm:inline">
          · Bank = เงินเข้าธนาคารที่เลือกไว้ (คลิกที่การ์ดเพื่อเลือก)
        </span>
      )}
      {revenueBasis === 'gmv' && cogsBasis === 'created' && (
        <span className="text-amber-600 hidden sm:inline">
          · COGS (Order Date) เป็นมุมมองวิเคราะห์รายวัน ไม่ใช่การรับรู้ตามบัญชี
        </span>
      )}
    </div>
  )
}
