'use client'

/**
 * Date Range Picker wrapper for Performance Dashboard.
 *
 * Wraps the shared DateRangePicker (draft+confirm, 9 presets, recently-used)
 * and syncs the selected range to URL params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Design:
 * - Receives server-resolved `from`/`to` as props (computed by page.tsx)
 * - On first mount: if URL lacks params, pushes defaults silently (replaceState)
 * - On confirm: converts DateRangeResult → Bangkok YYYY-MM-DD → router.replace
 */

import { useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import type { DateRangeResult } from '@/components/shared/DateRangePicker'
import { toBangkokDateString, parseBangkokDateStringToLocalDate } from '@/lib/bangkok-date-range'

interface DateRangePickerClientProps {
  /** Server-resolved start date YYYY-MM-DD (Bangkok) */
  from: string
  /** Server-resolved end date YYYY-MM-DD (Bangkok) */
  to: string
}

export function DateRangePickerClient({ from, to }: DateRangePickerClientProps) {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const pathname    = usePathname()

  // On first mount: if URL has no params, push the server-resolved defaults
  // so the URL always reflects the active range (bookmarkable, shareable)
  useEffect(() => {
    if (!searchParams.get('from') || !searchParams.get('to')) {
      const p = new URLSearchParams(searchParams.toString())
      p.set('from', from)
      p.set('to', to)
      router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (range: DateRangeResult) => {
    const newFrom = toBangkokDateString(range.startDate)
    const newTo   = toBangkokDateString(range.endDate)
    const p = new URLSearchParams(searchParams.toString())
    p.set('from', newFrom)
    p.set('to', newTo)
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  return (
    <DateRangePicker
      value={{
        startDate: parseBangkokDateStringToLocalDate(from),
        endDate:   parseBangkokDateStringToLocalDate(to),
      }}
      onChange={handleChange}
    />
  )
}
