'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FilterBarV2Props {
  q: string
  from: string
  to: string
  studioOnly: boolean
  thumbOnly: boolean
  showExcluded: boolean
}

export function FilterBarV2({ q: initQ, from: initFrom, to: initTo, studioOnly: initStudio, thumbOnly: initThumb, showExcluded: initExcluded }: FilterBarV2Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const [q, setQ] = useState(initQ)
  const [from, setFrom] = useState(initFrom)
  const [to, setTo] = useState(initTo)
  const [studioOnly, setStudioOnly] = useState(initStudio)
  const [thumbOnly, setThumbOnly] = useState(initThumb)
  const [showExcluded, setShowExcluded] = useState(initExcluded)

  function buildUrl(overrides: Partial<{ q: string; from: string; to: string; studioOnly: boolean; thumbOnly: boolean; showExcluded: boolean }> = {}) {
    const params = new URLSearchParams()
    const vals = { q, from, to, studioOnly, thumbOnly, showExcluded, ...overrides }
    if (vals.q) params.set('q', vals.q)
    if (vals.from) params.set('from', vals.from)
    if (vals.to) params.set('to', vals.to)
    if (vals.studioOnly) params.set('studioOnly', '1')
    if (vals.thumbOnly) params.set('thumbOnly', '1')
    if (vals.showExcluded) params.set('showExcluded', '1')
    params.set('page', '1')
    return `${pathname}?${params.toString()}`
  }

  function applyFilters(overrides: Parameters<typeof buildUrl>[0] = {}) {
    startTransition(() => router.push(buildUrl(overrides)))
  }

  function clearAll() {
    setQ(''); setFrom(''); setTo(''); setStudioOnly(false); setThumbOnly(false); setShowExcluded(false)
    startTransition(() => router.push(`${pathname}?page=1`))
  }

  const hasFilters = q || from || to || studioOnly || thumbOnly || showExcluded

  const toggles = [
    { label: 'Studio', value: studioOnly, setter: setStudioOnly, key: 'studioOnly' as const },
    { label: 'มี Thumb', value: thumbOnly, setter: setThumbOnly, key: 'thumbOnly' as const },
    { label: 'Show Excluded', value: showExcluded, setter: setShowExcluded, key: 'showExcluded' as const },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8 h-8 w-56 text-sm"
          placeholder="ค้นหาชื่อวิดีโอ..."
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFilters({ q }) }}
        />
      </div>

      <Input
        type="date"
        className="h-8 w-36 text-sm"
        value={from}
        onChange={e => { setFrom(e.target.value); applyFilters({ from: e.target.value }) }}
      />
      <span className="text-xs text-muted-foreground">–</span>
      <Input
        type="date"
        className="h-8 w-36 text-sm"
        value={to}
        onChange={e => { setTo(e.target.value); applyFilters({ to: e.target.value }) }}
      />

      {toggles.map(({ label, value, setter, key }) => (
        <button
          key={key}
          onClick={() => { setter(!value); applyFilters({ [key]: !value }) }}
          className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
            value
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-input hover:bg-accent'
          }`}
        >
          {label}
        </button>
      ))}

      {hasFilters && (
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={clearAll}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}

      {isPending && <span className="text-xs text-muted-foreground">Loading...</span>}
    </div>
  )
}
