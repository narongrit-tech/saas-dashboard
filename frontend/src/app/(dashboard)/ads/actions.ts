'use server';

import { createClient } from '@/lib/supabase/server';

export type CampaignTypeFilter = 'all' | 'product' | 'live';

export async function getAdsSummary(
  startDate: Date,
  endDate: Date,
  campaignType: CampaignTypeFilter = 'all'
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    let query = supabase
      .from('ad_daily_performance')
      .select('spend, revenue, orders')
      .eq('created_by', user.id)
      .gte('ad_date', startDate.toISOString().split('T')[0])
      .lte('ad_date', endDate.toISOString().split('T')[0]);

    // Apply campaign type filter if not 'all'
    if (campaignType === 'product' || campaignType === 'live') {
      query = query.eq('campaign_type', campaignType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching ads summary:', error);
      return { success: false, error: error.message };
    }

    const totalSpend = data?.reduce((sum, row) => sum + (row.spend || 0), 0) || 0;
    const totalRevenue = data?.reduce((sum, row) => sum + (row.revenue || 0), 0) || 0;
    const totalOrders = data?.reduce((sum, row) => sum + (row.orders || 0), 0) || 0;
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
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    let query = supabase
      .from('ad_daily_performance')
      .select('*')
      .eq('created_by', user.id)
      .gte('ad_date', startDate.toISOString().split('T')[0])
      .lte('ad_date', endDate.toISOString().split('T')[0]);

    // Apply campaign type filter if not 'all'
    if (campaignType === 'product' || campaignType === 'live') {
      query = query.eq('campaign_type', campaignType);
    }

    query = query.order('ad_date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching ads performance:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: data || [],
    };
  } catch (err) {
    console.error('Error in getAdsPerformance:', err);
    return { success: false, error: 'Internal server error' };
  }
}
