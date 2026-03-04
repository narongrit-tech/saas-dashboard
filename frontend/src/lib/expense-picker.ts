/**
 * Shared types and URL-param helpers for the expense picker modals
 * (Operating picker + Tax picker on Performance Dashboard).
 *
 * URL param convention (prefix = 'op' or 'tax'):
 *   {prefix}_mode     = 'all' | 'some'           (default 'all')
 *   {prefix}_exclude  = comma-separated excl IDs  (mode='all')
 *   {prefix}_sel      = comma-separated sel IDs   (mode='some')
 *   {prefix}_cat      = category filter            (default differs per picker)
 *   {prefix}_status   = 'All' | 'DRAFT' | 'PAID'  (default 'All')
 *   {prefix}_subcat   = subcategory filter          (default 'ALL')
 *   {prefix}_q        = free-text search
 *   {prefix}_page     = page number 1-based
 *   {prefix}_pageSize = 10 | 25 | 50 | 100
 */

export type PickerMode = 'all' | 'some'
export type PickerStatus = 'All' | 'DRAFT' | 'PAID'
export type PickerPageSize = 10 | 25 | 50 | 100
export const PICKER_PAGE_SIZES: PickerPageSize[] = [10, 25, 50, 100]

export interface ExpensePickerState {
  mode: PickerMode
  excludedIds: string[]   // used when mode='all'
  selectedIds: string[]   // used when mode='some'
  category: string        // 'ALL' or a specific expense category
  status: PickerStatus
  subcategory: string     // 'ALL' or a specific subcategory
  q: string
  page: number
  pageSize: PickerPageSize
}

export function defaultPickerState(category = 'ALL'): ExpensePickerState {
  return {
    mode: 'all',
    excludedIds: [],
    selectedIds: [],
    category,
    status: 'All',
    subcategory: 'ALL',
    q: '',
    page: 1,
    pageSize: 25,
  }
}

/** Parse a picker's state from URL search params (e.g. Next.js page searchParams) */
export function parsePickerState(
  searchParams: Record<string, string | string[] | undefined>,
  prefix: string,
  defaultCategory = 'ALL',
): ExpensePickerState {
  const get = (key: string): string | undefined => {
    const val = searchParams[`${prefix}_${key}`]
    return Array.isArray(val) ? val[0] : val
  }

  const mode: PickerMode = get('mode') === 'some' ? 'some' : 'all'
  const excludedIds = (get('exclude') ?? '').split(',').filter(Boolean)
  const selectedIds = (get('sel') ?? '').split(',').filter(Boolean)
  const category = get('cat') ?? defaultCategory
  const stRaw = get('status')
  const status: PickerStatus = stRaw === 'DRAFT' || stRaw === 'PAID' ? stRaw : 'All'
  const subcategory = get('subcat') ?? 'ALL'
  const q = get('q') ?? ''
  const page = Math.max(1, parseInt(get('page') ?? '1', 10) || 1)
  const psRaw = parseInt(get('pageSize') ?? '25', 10)
  const pageSize: PickerPageSize = ([10, 25, 50, 100] as number[]).includes(psRaw)
    ? (psRaw as PickerPageSize)
    : 25

  return { mode, excludedIds, selectedIds, category, status, subcategory, q, page, pageSize }
}

/**
 * Serialize picker state into URL params.
 * Only non-default values are emitted to keep URLs clean.
 */
export function stateToUrlParams(
  state: ExpensePickerState,
  prefix: string,
  defaultCategory = 'ALL',
): Record<string, string> {
  const p: Record<string, string> = {}
  const set = (k: string, v: string) => { p[`${prefix}_${k}`] = v }

  if (state.mode !== 'all') set('mode', state.mode)
  if (state.excludedIds.length > 0) set('exclude', state.excludedIds.join(','))
  if (state.selectedIds.length > 0) set('sel', state.selectedIds.join(','))
  if (state.category !== defaultCategory) set('cat', state.category)
  if (state.status !== 'All') set('status', state.status)
  if (state.subcategory !== 'ALL') set('subcat', state.subcategory)
  if (state.q) set('q', state.q)
  if (state.page !== 1) set('page', String(state.page))
  if (state.pageSize !== 25) set('pageSize', String(state.pageSize))

  return p
}

/** All URL param keys that belong to a given prefix */
export function getPickerParamKeys(prefix: string): string[] {
  return ['mode', 'exclude', 'sel', 'cat', 'status', 'subcat', 'q', 'page', 'pageSize'].map(
    (k) => `${prefix}_${k}`,
  )
}

/** Returns true when the state equals the default (no custom selection applied) */
export function isDefaultPickerState(state: ExpensePickerState, defaultCategory = 'ALL'): boolean {
  return (
    state.mode === 'all' &&
    state.excludedIds.length === 0 &&
    state.selectedIds.length === 0 &&
    state.category === defaultCategory &&
    state.status === 'All' &&
    state.subcategory === 'ALL' &&
    !state.q
  )
}
