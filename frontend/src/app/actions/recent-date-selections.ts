'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Recent selection interface
 */
export interface RecentSelection {
  id: string;
  label: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  preset?: string;
  lastUsedAt: string;
}

/**
 * Get user's recently used date selections
 * Returns max 3 most recent selections
 */
export async function getRecentSelections(): Promise<RecentSelection[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('user_recent_date_selections')
      .select('id, label, start_date, end_date, preset, last_used_at')
      .order('last_used_at', { ascending: false })
      .limit(3);

    if (error) {
      console.error('[getRecentSelections] Error:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      label: row.label,
      startDate: row.start_date,
      endDate: row.end_date,
      preset: row.preset || undefined,
      lastUsedAt: row.last_used_at,
    }));
  } catch (error) {
    console.error('[getRecentSelections] Unexpected error:', error);
    return [];
  }
}

/**
 * Save a recent selection
 * Upserts the selection (update last_used_at if already exists)
 */
export async function saveRecentSelection(selection: {
  label: string;
  startDate: string;
  endDate: string;
  preset?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Upsert (update if exists, insert if not)
    const { error } = await supabase
      .from('user_recent_date_selections')
      .upsert({
        user_id: user.id,
        label: selection.label,
        start_date: selection.startDate,
        end_date: selection.endDate,
        preset: selection.preset || null,
        last_used_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,start_date,end_date',
        ignoreDuplicates: false, // Update last_used_at if exists
      });

    if (error) {
      console.error('[saveRecentSelection] Error:', error);
      return { success: false, error: error.message };
    }

    // Cleanup: Keep only top 3 recent selections
    await cleanupOldSelections(user.id);

    revalidatePath('/');

    return { success: true };
  } catch (error) {
    console.error('[saveRecentSelection] Unexpected error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Cleanup old selections (keep only top 3)
 * @internal
 */
async function cleanupOldSelections(userId: string): Promise<void> {
  try {
    const supabase = await createClient();

    // Get all selections ordered by last_used_at
    const { data: allSelections, error: fetchError } = await supabase
      .from('user_recent_date_selections')
      .select('id')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false });

    if (fetchError || !allSelections) {
      console.error('[cleanupOldSelections] Fetch error:', fetchError);
      return;
    }

    // If more than 3, delete the oldest ones
    if (allSelections.length > 3) {
      const idsToDelete = allSelections.slice(3).map(s => s.id);

      const { error: deleteError } = await supabase
        .from('user_recent_date_selections')
        .delete()
        .in('id', idsToDelete);

      if (deleteError) {
        console.error('[cleanupOldSelections] Delete error:', deleteError);
      }
    }
  } catch (error) {
    console.error('[cleanupOldSelections] Unexpected error:', error);
  }
}

/**
 * Delete a specific recent selection
 */
export async function deleteRecentSelection(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from('user_recent_date_selections')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[deleteRecentSelection] Error:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/');

    return { success: true };
  } catch (error) {
    console.error('[deleteRecentSelection] Unexpected error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
