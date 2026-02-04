'use server';

import { createClient } from '@/lib/supabase/server';
import { formatInTimeZone } from 'date-fns-tz';
import { unstable_noStore as noStore } from 'next/cache';

const BANGKOK_TZ = 'Asia/Bangkok';

export type CampaignTypeFilter = 'all' | 'product' | 'live';

export async function getAdsSummary(
  startDate: Date,
  endDate: Date,
  campaignType: CampaignTypeFilter = 'all'
) {
  noStore();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Format dates as Bangkok date strings (YYYY-MM-DD) to avoid UTC shift
    const startDateStr = formatInTimeZone(startDate, BANGKOK_TZ, 'yyyy-MM-dd');
    const endDateStr = formatInTimeZone(endDate, BANGKOK_TZ, 'yyyy-MM-dd');

    // Do not compute totals from rows (pagination-safe)
    // Use PostgreSQL aggregates via RPC for efficiency
    const { data, error } = await supabase.rpc('get_ads_summary', {
      p_user_id: user.id,
      p_start_date: startDateStr,
      p_end_date: endDateStr,
      p_campaign_type: campaignType === 'all' ? null : campaignType,
    });

    if (error) {
      console.error('Error fetching ads summary:', error);
      return { success: false, error: error.message };
    }

    // RPC returns array with single row
    const result = data?.[0] || { total_spend: 0, total_revenue: 0, total_orders: 0 };
    const totalSpend = Number(result.total_spend) || 0;
    const totalRevenue = Number(result.total_revenue) || 0;
    const totalOrders = Number(result.total_orders) || 0;
    const blendedROI = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    return {
      success: true,
      data: {
        total_spend: totalSpend,
        total_revenue: totalRevenue,
        total_orders: totalOrders,
        blended_roi: blendedROI,
      },
    };
  } catch (err) {
    console.error('Error in getAdsSummary:', err);
    return { success: false, error: 'Internal server error' };
  }
}

export async function getAdsPerformance(
  startDate: Date,
  endDate: Date,
  campaignType: CampaignTypeFilter = 'all'
) {
  noStore();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Format dates as Bangkok date strings (YYYY-MM-DD) to avoid UTC shift
    const startDateStr = formatInTimeZone(startDate, BANGKOK_TZ, 'yyyy-MM-dd');
    const endDateStr = formatInTimeZone(endDate, BANGKOK_TZ, 'yyyy-MM-dd');

    // Fetch all data with pagination to bypass 1000 row limit
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('ad_daily_performance')
        .select('*')
        .eq('created_by', user.id)
        .gte('ad_date', startDateStr)
        .lte('ad_date', endDateStr)
        .range(from, from + pageSize - 1)
        .order('ad_date', { ascending: false });

      // Apply campaign type filter if not 'all'
      if (campaignType === 'product' || campaignType === 'live') {
        query = query.eq('campaign_type', campaignType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching ads performance:', error);
        return { success: false, error: error.message };
      }

      if (data && data.length > 0) {
        allData = allData.concat(data);
        hasMore = data.length === pageSize;
        from += pageSize;
      } else {
        hasMore = false;
      }
    }

    return {
      success: true,
      data: allData,
    };
  } catch (err) {
    console.error('Error in getAdsPerformance:', err);
    return { success: false, error: 'Internal server error' };
  }
}
