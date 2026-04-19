'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { cn } from '@/lib/utils'

// Inline utilities — plain JS, no server/client boundary issues
function getBangkokToday(): string {
  const now = new Date()
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return bkk.toISOString().split('T')[0]
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

interface DateRangeFilterProps {
  from: string
  to: string
}

export function DateRangeFilter({ from, to }: DateRangeFilterProps) {
  const router = useRouter()
  const pathname = usePathname()

  const navigate = useCallback(
    (newFrom: string, newTo: string) => {
      router.push(`${pathname}?from=${newFrom}&to=${newTo}`)
    },
    [router, pathname]
  )

  function applyPreset(days: number) {
    const today = getBangkokToday()
    const fromDate = offsetDate(today, -(days - 1))
    navigate(fromDate, today)
  }

  function isPresetActive(days: number): boolean {
    const today = getBangkokToday()
    const expectedFrom = offsetDate(today, -(days - 1))
    return from === expectedFrom && to === today
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium shrink-0">Period:</span>

      {/* Preset buttons */}
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => applyPreset(p.days)}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              isPresetActive(p.days)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <span className="text-muted-foreground/40 text-xs">|</span>

      {/* Custom date inputs */}
      <div className="flex items-center gap-1.5 text-xs">
        <input
          type="date"
          defaultValue={from}
          max={to}
          onChange={(e) => {
            if (e.target.value) navigate(e.target.value, to)
          }}
          className="h-7 rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="text-muted-foreground">→</span>
        <input
          type="date"
          defaultValue={to}
          min={from}
          max={getBangkokToday()}
          onChange={(e) => {
            if (e.target.value) navigate(from, e.target.value)
          }}
          className="h-7 rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    </div>
  )
}
