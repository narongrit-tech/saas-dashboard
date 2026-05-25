'use server'

import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignConfigRow {
  id: string
  campaign_id: string
  campaign_name: string | null
  campaign_type: string | null
  label: string | null
  include_in_pnl: boolean
  updated_at: string
}

export interface UnclassifiedCampaign {
  campaign_id: string
  campaign_name: string | null
  campaign_type: string | null
  last_seen_date: string
  total_spend: number
}

export interface LiveCampaignRow {
  campaign_id: string
  campaign_name: string | null
  last_seen_date: string
  total_spend: number
  // from ad_campaign_config (null = unclassified)
  config_id: string | null
  label: string | null
  include_in_pnl: boolean
}

// ─── Internal helper (not exported — used by actions.ts) ─────────────────────

/**
 * Returns the set of live campaign_ids that have include_in_pnl = true.
 *
 * hasConfig = false  → user hasn't classified any live campaigns yet → caller
 *             should include ALL live spend (backward compat)
 * hasConfig = true   → use includedIds to filter; empty list = zero live spend
 */
export async function getLiveCampaignFilter(
  supabase: ReturnType<typeof createClient>
): Promise<{ hasConfig: boolean; includedIds: string[] }> {
  const { data, error } = await supabase
    .from('ad_campaign_config')
    .select('campaign_id, include_in_pnl')
    .eq('campaign_type', 'live')

  if (error || !data || data.length === 0) {
    return { hasConfig: false, includedIds: [] }
  }

  return {
    hasConfig: true,
    includedIds: (data as { campaign_id: string; include_in_pnl: boolean }[])
      .filter((r) => r.include_in_pnl)
      .map((r) => r.campaign_id),
  }
}

// ─── Public server actions ────────────────────────────────────────────────────

/**
 * Get all distinct live campaigns (with config state merged in).
 * Used by LiveCampaignManager UI.
 */
export async function getLiveCampaigns(): Promise<{
  success: boolean
  data?: LiveCampaignRow[]
  error?: string
}> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    // All distinct live campaigns from ad_daily_performance
    const { data: adRows, error: adError } = await supabase
      .from('ad_daily_performance')
      .select('campaign_id, campaign_name, ad_date, spend')
      .eq('campaign_type', 'live')
      .not('campaign_id', 'is', null)
      .neq('campaign_id', '')

    if (adError) throw new Error(adError.message)

    // Aggregate by campaign_id
    const campaignMap = new Map<string, {
      campaign_id: string
      campaign_name: string | null
      last_seen_date: string
      total_spend: number
    }>()

    for (const row of adRows ?? []) {
      const id = row.campaign_id as string
      const existing = campaignMap.get(id)
      const date = row.ad_date as string
      const spend = (row.spend as number) || 0

      if (!existing) {
        campaignMap.set(id, {
          campaign_id: id,
          campaign_name: row.campaign_name as string | null,
          last_seen_date: date,
          total_spend: spend,
        })
      } else {
        if (date > existing.last_seen_date) existing.last_seen_date = date
        existing.total_spend += spend
      }
    }

    // Fetch all live configs for this user
    const { data: configs, error: cfgError } = await supabase
      .from('ad_campaign_config')
      .select('id, campaign_id, label, include_in_pnl')
      .eq('campaign_type', 'live')

    if (cfgError) throw new Error(cfgError.message)

    const configMap = new Map<string, { id: string; label: string | null; include_in_pnl: boolean }>()
    for (const cfg of configs ?? []) {
      configMap.set(cfg.campaign_id as string, {
        id: cfg.id as string,
        label: cfg.label as string | null,
        include_in_pnl: cfg.include_in_pnl as boolean,
      })
    }

    // Merge
    const rows: LiveCampaignRow[] = Array.from(campaignMap.values())
      .sort((a, b) => b.last_seen_date.localeCompare(a.last_seen_date))
      .map((c) => {
        const cfg = configMap.get(c.campaign_id)
        return {
          campaign_id: c.campaign_id,
          campaign_name: c.campaign_name,
          last_seen_date: c.last_seen_date,
          total_spend: Math.round(c.total_spend * 100) / 100,
          config_id: cfg?.id ?? null,
          label: cfg?.label ?? null,
          include_in_pnl: cfg?.include_in_pnl ?? false,
        }
      })

    return { success: true, data: rows }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด' }
  }
}

/** Upsert a single campaign config (create or update). */
export async function upsertCampaignConfig(params: {
  campaign_id: string
  campaign_name: string | null
  campaign_type: 'live' | 'product'
  label: string | null
  include_in_pnl: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้ กรุณา login ใหม่' }

    const { error } = await supabase
      .from('ad_campaign_config')
      .upsert(
        {
          created_by:    user.id,
          marketplace:   'tiktok',
          campaign_id:   params.campaign_id,
          campaign_name: params.campaign_name,
          campaign_type: params.campaign_type,
          label:         params.label,
          include_in_pnl: params.include_in_pnl,
        },
        { onConflict: 'created_by,marketplace,campaign_id' }
      )

    if (error) throw new Error(error.message)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด' }
  }
}

/** Count unclassified live campaigns (for badge). */
export async function getUnclassifiedLiveCount(): Promise<{
  success: boolean
  count?: number
  error?: string
}> {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ไม่พบข้อมูลผู้ใช้' }

    // Distinct live campaign_ids in ad_daily_performance
    const { data: adRows } = await supabase
      .from('ad_daily_performance')
      .select('campaign_id')
      .eq('campaign_type', 'live')
      .not('campaign_id', 'is', null)
      .neq('campaign_id', '')

    const allIds = new Set((adRows ?? []).map((r) => r.campaign_id as string))

    // Classified campaign_ids
    const { data: cfgRows } = await supabase
      .from('ad_campaign_config')
      .select('campaign_id')
      .eq('campaign_type', 'live')

    const classifiedIds = new Set((cfgRows ?? []).map((r) => r.campaign_id as string))

    const unclassifiedCount = [...allIds].filter((id) => !classifiedIds.has(id)).length
    return { success: true, count: unclassifiedCount }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด' }
  }
}
