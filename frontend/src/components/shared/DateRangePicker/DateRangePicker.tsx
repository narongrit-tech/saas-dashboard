'use client';

import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import {
  getBangkokNow,
  startOfDayBangkok,
  endOfDayBangkok
} from '@/lib/bangkok-time';
import { toBangkokDateString } from '@/lib/bangkok-date-range';
import { DateRangePickerProps, PresetConfig, DateRangeResult } from './types';
import { PresetsPanel } from './PresetsPanel';
import { DualCalendar } from './DualCalendar';
import { Footer } from './Footer';
import {
  getRecentSelections,
  saveRecentSelection,
  RecentSelection,
} from '@/app/actions/recent-date-selections';

/**
 * Default presets (Thai labels)
 */
const DEFAULT_PRESETS: PresetConfig[] = [
  {
    key: 'today',
    label: 'วันนี้',
    getValue: () => {
      const today = getBangkokNow();
      return {
        startDate: startOfDayBangkok(today),
        endDate: endOfDayBangkok(today),
        preset: 'today',
      };
    },
  },
  {
    key: 'yesterday',
    label: 'เมื่อวานนี้',
    getValue: () => {
      const today = getBangkokNow();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        startDate: startOfDayBangkok(yesterday),
        endDate: endOfDayBangkok(yesterday),
        preset: 'yesterday',
      };
    },
  },
  {
    key: 'last7days',
    label: '7 วันที่ผ่านมา',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - 6); // Last 6 days + today = 7 days
      return {
        startDate: startOfDayBangkok(start),
        endDate: endOfDayBangkok(today),
        preset: 'last7days',
      };
    },
  },
  {
    key: 'last14days',
    label: '14 วันที่ผ่านมา',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - 13);
      return {
        startDate: startOfDayBangkok(start),
        endDate: endOfDayBangkok(today),
        preset: 'last14days',
      };
    },
  },
  {
    key: 'last30days',
    label: '30 วันที่ผ่านมา',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return {
        startDate: startOfDayBangkok(start),
        endDate: endOfDayBangkok(today),
        preset: 'last30days',
      };
    },
  },
  {
    key: 'thisWeek',
    label: 'สัปดาห์นี้',
    getValue: () => {
      const today = getBangkokNow();
      const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...
      const start = new Date(today);
      start.setDate(start.getDate() - dayOfWeek); // Start of week (Sunday)
      return {
        startDate: startOfDayBangkok(start),
        endDate: endOfDayBangkok(today),
        preset: 'thisWeek',
      };
    },
  },
  {
    key: 'thisMonth',
    label: 'เดือนนี้',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        startDate: startOfDayBangkok(start),
        endDate: endOfDayBangkok(today),
        preset: 'thisMonth',
      };
    },
  },
  {
    key: 'lastMonth',
    label: 'เดือนที่แล้ว',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0); // Last day of previous month
      return {
        startDate: startOfDayBangkok(start),
        endDate: endOfDayBangkok(end),
        preset: 'lastMonth',
      };
    },
  },
  {
    key: 'custom',
    label: 'กำหนดเอง',
    getValue: () => {
      // Custom preset doesn't auto-select, just labels custom selection
      const today = getBangkokNow();
      return {
        startDate: startOfDayBangkok(today),
        endDate: endOfDayBangkok(today),
        preset: 'custom',
      };
    },
  },
];

/**
 * Date Range Picker Component (Phase 2: Modular + Recently Used)
 *
 * Features:
 * - Draft + Confirmation pattern (prevents unwanted API calls)
 * - Preset panel + Dual calendar layout
 * - Bangkok timezone support
 * - Recently Used (database-backed, max 3 items)
 * - Month/Year dropdown navigation
 * - Modular component architecture
 */
export function DateRangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  timezone = 'เวลามาตรฐานไทย (UTC+07:00)',
  presets = DEFAULT_PRESETS,
  placeholder = 'เลือกช่วงเวลา',
}: DateRangePickerProps) {
  // Applied state (shown in trigger button, sent to parent)
  const [applied, setApplied] = useState<DateRange>(() => ({
    from: value?.startDate || getBangkokNow(),
    to: value?.endDate || getBangkokNow(),
  }));

  // Draft state (temporary selection in popover)
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: value?.startDate || getBangkokNow(),
    to: value?.endDate || getBangkokNow(),
  }));

  // Selected preset tracking
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(value?.preset);

  // Popover open state
  const [isOpen, setIsOpen] = useState(false);

  // Recently Used state
  const [recentlyUsed, setRecentlyUsed] = useState<RecentSelection[]>([]);

  // Sync applied state when value prop changes (controlled component)
  useEffect(() => {
    if (value?.startDate && value?.endDate) {
      setApplied({
        from: value.startDate,
        to: value.endDate,
      });
    }
  }, [value]);

  // Load recently used on mount
  useEffect(() => {
    loadRecentSelections();
  }, []);

  /**
   * Load recently used selections from database
   */
  const loadRecentSelections = async () => {
    try {
      const selections = await getRecentSelections();
      setRecentlyUsed(selections);
    } catch (error) {
      console.error('[DateRangePicker] Failed to load recent selections:', error);
      // Fail silently - return empty array
      setRecentlyUsed([]);
    }
  };

  /**
   * Handle popover open/close
   * Reset draft to applied when opening
   */
  const handleOpenChange = (open: boolean) => {
    if (open) {
      // Reset draft to current applied value
      setDraft({
        from: applied.from,
        to: applied.to,
      });
      // Reload recently used
      loadRecentSelections();
    }
    setIsOpen(open);
  };

  /**
   * Handle preset click
   * Updates draft state only (no onChange call)
   */
  const handlePresetClick = (preset: PresetConfig) => {
    const range = preset.getValue();
    setDraft({
      from: range.startDate,
      to: range.endDate,
    });
    setSelectedPreset(preset.key);
  };

  /**
   * Handle recently used click
   */
  const handleRecentClick = (recent: RecentSelection) => {
    const startDate = new Date(recent.startDate);
    const endDate = new Date(recent.endDate);

    setDraft({
      from: startOfDayBangkok(startDate),
      to: endOfDayBangkok(endDate),
    });
    setSelectedPreset(recent.preset || 'custom');
  };

  /**
   * Handle calendar date selection
   * Updates draft state only (no onChange call)
   */
  const handleDateSelect = (range: DateRange | undefined) => {
    if (!range) {
      setDraft(undefined);
      setSelectedPreset(undefined);
      return;
    }

    // Apply Bangkok timezone boundaries
    if (range.from) {
      range.from = startOfDayBangkok(range.from);
    }
    if (range.to) {
      range.to = endOfDayBangkok(range.to);
    }

    setDraft(range);
    setSelectedPreset('custom');
  };

  /**
   * Handle confirm button click
   * This is the ONLY place where onChange is called
   */
  const handleConfirm = async () => {
    if (!draft?.from || !draft?.to) {
      return; // Require both dates
    }

    // Update applied state
    setApplied(draft);

    // Call parent onChange (single call, explicit)
    onChange({
      startDate: draft.from,
      endDate: draft.to,
      preset: selectedPreset,
    });

    // Save to recently used (async, non-blocking)
    try {
      const label = formatDateRangeLabel(draft.from, draft.to);
      await saveRecentSelection({
        label,
        startDate: toBangkokDateString(draft.from),
        endDate: toBangkokDateString(draft.to),
        preset: selectedPreset !== 'custom' ? selectedPreset : undefined,
      });

      // Refresh recently used list
      await loadRecentSelections();
    } catch (error) {
      console.error('[DateRangePicker] Failed to save recent selection:', error);
      // Don't block user flow if save fails
    }

    // Close popover
    setIsOpen(false);
  };

  /**
   * Handle cancel button click
   * Discard draft and close popover
   */
  const handleCancel = () => {
    // Reset draft to applied (discard changes)
    setDraft({
      from: applied.from,
      to: applied.to,
    });
    setIsOpen(false);
  };

  /**
   * Format date range label for display (for recently used)
   */
  const formatDateRangeLabel = (startDate: Date, endDate: Date): string => {
    const start = format(startDate, 'dd MMM yyyy');
    const end = format(endDate, 'dd MMM yyyy');
    return `${start} – ${end}`;
  };

  /**
   * Get preset label for trigger button
   */
  const getPresetLabel = (): string | undefined => {
    if (!selectedPreset || selectedPreset === 'custom') return undefined;
    const preset = presets.find(p => p.key === selectedPreset);
    return preset?.label;
  };

  /**
   * Check if confirm button should be disabled
   */
  const isConfirmDisabled = !draft?.from || !draft?.to;

  /**
   * Format date range for trigger button display
   */
  const formatTriggerDisplay = (): string => {
    if (!applied?.from) return placeholder;
    if (!applied?.to) return format(applied.from, 'dd MMM yyyy');

    const start = format(applied.from, 'dd MMM yyyy');
    const end = format(applied.to, 'dd MMM yyyy');

    const presetLabel = getPresetLabel();
    if (presetLabel && presetLabel !== 'custom') {
      return `${presetLabel}: ${start} – ${end}`;
    }

    return `${start} – ${end}`;
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="min-w-[280px] justify-start text-left font-normal"
          aria-label="เลือกช่วงวันที่"
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatTriggerDisplay()}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-4"
        align="start"
        role="dialog"
        aria-label="เลือกช่วงวันที่"
      >
        <div className="grid grid-cols-[180px_1fr] gap-4">
          {/* Left: Presets Panel (with Recently Used) */}
          <PresetsPanel
            presets={presets}
            recentlyUsed={recentlyUsed}
            selectedPreset={selectedPreset}
            onPresetClick={handlePresetClick}
            onRecentClick={handleRecentClick}
          />

          {/* Right: Dual Calendar (with Month/Year dropdown) */}
          <DualCalendar
            value={draft}
            onChange={handleDateSelect}
            disabled={{
              after: maxDate || getBangkokNow(),
              before: minDate,
            }}
          />
        </div>

        {/* Footer */}
        <Footer
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          isConfirmDisabled={isConfirmDisabled}
          timezone={timezone}
          className="mt-4 pt-4 border-t"
        />
      </PopoverContent>
    </Popover>
  );
}
