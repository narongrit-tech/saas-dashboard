export type AttributionQueryState = 'ready' | 'empty' | 'timed_out' | 'failed'
export type AttributionSurfaceState = 'success' | 'partial' | 'timed_out' | 'failed' | 'no_data'
export type AttributionTotalMode = 'exact' | 'derived_last_page' | 'skipped'
export type AttributionSummaryMode = 'exact' | 'page_slice' | 'probe' | 'skipped'

export interface AttributionQueryMeta {
  state: AttributionQueryState
  message: string | null
}

export interface AttributionDiagnostics {
  queryPath: string
  durationMs: number
  degraded: boolean
  timedOut: boolean
  totalMode: AttributionTotalMode
  summaryMode: AttributionSummaryMode
}

interface QueryErrorLike {
  code?: string | null
  message?: string | null
}

export function isAttributionTimeoutError(error: QueryErrorLike | null | undefined): boolean {
  if (!error) return false

  const message = error.message?.toLowerCase() ?? ''
  return error.code === '57014' || message.includes('statement timeout') || message.includes('canceling statement due to statement timeout')
}

export function getAttributionQueryMeta(
  error: QueryErrorLike | null | undefined,
  count: number | null | undefined,
  context = 'Attribution'
): AttributionQueryMeta {
  if (error) {
    if (isAttributionTimeoutError(error)) {
      return {
        state: 'timed_out',
        message: `${context} query timed out before results could be loaded.`,
      }
    }

    return {
      state: 'failed',
      message: error.message?.trim() ? `${context} query failed: ${error.message}` : `${context} query failed.`,
    }
  }

  return {
    state: (count ?? 0) > 0 ? 'ready' : 'empty',
    message: null,
  }
}

export function createAttributionDiagnostics(
  diagnostics: AttributionDiagnostics
): AttributionDiagnostics {
  return diagnostics
}

export function getAttributionSurfaceState(
  meta: AttributionQueryMeta,
  rowCount: number,
  degraded = false
): AttributionSurfaceState {
  if (meta.state === 'timed_out') return 'timed_out'
  if (meta.state === 'failed') return 'failed'
  if (rowCount === 0) return 'no_data'
  return degraded ? 'partial' : 'success'
}

export function buildAttributionLimitedMessage(
  context: string,
  options: {
    exactTotals?: boolean
    exactSummary?: boolean
    probeOnly?: boolean
  } = {}
): string {
  if (options.probeOnly) {
    return `${context} is available via a lightweight probe. Exact totals were skipped to avoid timeouts.`
  }

  if (options.exactTotals === false && options.exactSummary === false) {
    return `${context} loaded a bounded result slice. Exact totals and full summary counts were skipped to avoid timeouts.`
  }

  if (options.exactTotals === false) {
    return `${context} loaded a bounded result slice. Exact totals were skipped to avoid timeouts.`
  }

  if (options.exactSummary === false) {
    return `${context} loaded successfully, but summary metrics are limited to the current slice on this page.`
  }

  return `${context} loaded in limited mode.`
}

export function formatAttributionDiagnostics(diagnostics: AttributionDiagnostics): string {
  return `Path: ${diagnostics.queryPath} · ${diagnostics.durationMs} ms · ${diagnostics.degraded ? 'degraded' : 'standard'} · total ${diagnostics.totalMode} · summary ${diagnostics.summaryMode}`
}

export function logAttributionDiagnostics(
  context: string,
  state: AttributionSurfaceState,
  diagnostics: AttributionDiagnostics,
  message?: string | null
): void {
  const payload = {
    context,
    state,
    queryPath: diagnostics.queryPath,
    durationMs: diagnostics.durationMs,
    degraded: diagnostics.degraded,
    timedOut: diagnostics.timedOut,
    totalMode: diagnostics.totalMode,
    summaryMode: diagnostics.summaryMode,
    message: message ?? null,
  }

  if (state === 'timed_out' || state === 'failed') {
    console.warn('[content-ops attribution]', payload)
    return
  }

  console.info('[content-ops attribution]', payload)
}
