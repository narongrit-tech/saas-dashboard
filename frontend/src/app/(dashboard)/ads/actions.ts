'use server';

import { createClient } from '@/lib/supabase/server';
import { format } from 'date-fns';

export async function getAdsSummary(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');

    console.log('[ADS_SUMMARY] Query params:', {
      userId: user.id,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const { data, error } = await supabase
      .from('ad_daily_performance')
      .select('spend, revenue, orders')
      .eq('created_by', user.id)
      .gte('ad_date', startDateStr)
      .lte('ad_date', endDateStr);

    if (error) {
      console.error('[ADS_SUMMARY] Query error:', error);
      return { success: false, error: error.message };
    }

    console.log('[ADS_SUMMARY] Rows returned:', data?.length || 0);
    if (data && data.length > 0) {
      console.log('[ADS_SUMMARY] Sample row:', data[0]);
    }

    const totalSpend = data?.reduce((sum, row) => sum + (row.spend || 0), 0) || 0;
    const totalRevenue = data?.reduce((sum, row) => sum + (row.revenue || 0), 0) || 0;
    const totalOrders = data?.reduce((sum, row) => sum + (row.orders || 0), 0) || 0;
    const blendedROI = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    console.log('[ADS_SUMMARY] Calculated totals:', {
      totalSpend,
      totalRevenue,
      totalOrders,
      blendedROI,
    });

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
    console.error('[ADS_SUMMARY] Error:', err);
    return { success: false, error: 'Internal server error' };
  }
}

export async function getAdsPerformance(startDate: Date, endDate: Date) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');

    console.log('[ADS_PERFORMANCE] Query params:', {
      userId: user.id,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const { data, error } = await supabase
      .from('ad_daily_performance')
      .select('*')
      .eq('created_by', user.id)
      .gte('ad_date', startDateStr)
      .lte('ad_date', endDateStr)
      .order('ad_date', { ascending: false });

    if (error) {
      console.error('[ADS_PERFORMANCE] Query error:', error);
      return { success: false, error: error.message };
    }

    console.log('[ADS_PERFORMANCE] Rows returned:', data?.length || 0);
    if (data && data.length > 0) {
      console.log('[ADS_PERFORMANCE] First 3 rows:', data.slice(0, 3));
    }

    return {
      success: true,
      data: data || [],
    };
  } catch (err) {
    console.error('[ADS_PERFORMANCE] Error:', err);
    return { success: false, error: 'Internal server error' };
  }
}
