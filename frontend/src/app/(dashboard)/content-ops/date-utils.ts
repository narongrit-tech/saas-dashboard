// Plain module — no 'use server' or 'use client'
// Safe to import from both server and client contexts

/** Today's date in Bangkok timezone (UTC+7), formatted as YYYY-MM-DD */
export function getBangkokToday(): string {
  const now = new Date()
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return bkk.toISOString().split('T')[0]
}

/** Offset a YYYY-MM-DD string by N days */
export function offsetDate(base: string, days: number): string {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

/** Default date range: last 7 days in Bangkok TZ (today−6 → today) */
export function getDefaultDateRange(): { from: string; to: string } {
  const to = getBangkokToday()
  const from = offsetDate(to, -6)
  return { from, to }
}

/** Build array of YYYY-MM-DD strings between two dates inclusive */
export function buildDayArray(from: string, to: string): string[] {
  const days: string[] = []
  const d = new Date(from)
  const end = new Date(to)
  while (d <= end) {
    days.push(d.toISOString().split('T')[0])
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}
