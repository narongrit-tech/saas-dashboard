'use client';

import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent } from '@/components/ui/sheet';
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
 * Date Range Picker Component
 *
 * Features:
 * - Draft + Confirmation pattern (prevents unwanted API calls)
 * - Preset panel + Dual calendar layout
 * - Bangkok timezone support
 * - Month/Year dropdown navigation
 * - Mobile: bottom Sheet; Desktop: Popover
 */
export function DateRangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  allowFutureDates = false,
  timezone = 'เวลามาตรฐานไทย (UTC+07:00)',
  presets = DEFAULT_PRESETS,
  placeholder = 'เลือกช่วงเวลา',
}: DateRangePickerProps) {
  // Applied state (shown in trigger button, sent to parent)
  const [applied, setApplied] = useState<DateRange>(() => ({
    from: value?.startDate || getBangkokNow(),
    to: value?.endDate || getBangkokNow(),
  }));

  // Draft state (temporary selection in popover/sheet)
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: value?.startDate || getBangkokNow(),
    to: value?.endDate || getBangkokNow(),
  }));

  // Selected preset tracking
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(value?.preset);

  // Open state (shared between Popover and Sheet)
  const [isOpen, setIsOpen] = useState(false);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Sync applied state when value prop changes (controlled component)
  useEffect(() => {
    if (value?.startDate && value?.endDate) {
      setApplied({
        from: value.startDate,
        to: value.endDate,
      });
    }
  }, [value]);

  /**
   * Handle open/close — reset draft to applied when opening
   */
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDraft({
        from: applied.from,
        to: applied.to,
      });
    }
    setIsOpen(open);
  };

  /**
   * Handle preset click — updates draft only
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
   * Handle calendar date selection — updates draft only
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
   * Handle confirm — the ONLY place where onChange is called
   */
  const handleConfirm = () => {
    if (!draft?.from || !draft?.to) {
      return; // Require both dates
    }

    setApplied(draft);

    onChange({
      startDate: draft.from,
      endDate: draft.to,
      preset: selectedPreset,
    });

    setIsOpen(false);
  };

  /**
   * Handle cancel — discard draft and close
   */
  const handleCancel = () => {
    setDraft({
      from: applied.from,
      to: applied.to,
    });
    setIsOpen(false);
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

  const triggerButton = (
    <Button
      variant="outline"
      className="w-full justify-start text-left font-normal md:min-w-[280px] md:w-auto"
      aria-label="เลือกช่วงวันที่"
      onClick={() => handleOpenChange(true)}
    >
      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
      <span className="truncate">{formatTriggerDisplay()}</span>
    </Button>
  );

  const pickerContent = (
    <>
      {/* Presets + Calendar */}
      <div className="flex flex-col gap-4 md:flex-row md:gap-4">
        {/* Presets panel — horizontal scroll on mobile, vertical list on desktop */}
        <div className="md:w-[160px] md:shrink-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-1">ช่วงเวลา</p>
          {/* Mobile: horizontal pills; Desktop: vertical list */}
          <div className="flex flex-wrap gap-1.5 md:hidden">
            {presets.map((preset) => (
              <Button
                key={preset.key}
                variant={selectedPreset === preset.key ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-7 px-2.5"
                onClick={() => handlePresetClick(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="hidden md:block">
            <PresetsPanel
              presets={presets}
              selectedPreset={selectedPreset}
              onPresetClick={handlePresetClick}
            />
          </div>
        </div>

        {/* Calendar — single month on mobile, dual on desktop */}
        <div className="min-w-0">
          <DualCalendar
            value={draft}
            onChange={handleDateSelect}
            disabled={{
              after: allowFutureDates ? maxDate : (maxDate || getBangkokNow()),
              before: minDate,
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <Footer
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        isConfirmDisabled={isConfirmDisabled}
        timezone={timezone}
        className="mt-4 pt-4 border-t"
      />
    </>
  );

  // Mobile: Sheet (bottom drawer)
  if (isMobile) {
    return (
      <>
        {triggerButton}
        <Sheet open={isOpen} onOpenChange={handleOpenChange}>
          <SheetContent
            side="bottom"
            className="h-[90vh] overflow-y-auto px-4 pb-6 pt-6"
          >
            <p className="text-sm font-semibold mb-4">เลือกช่วงวันที่</p>
            {pickerContent}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop: Popover
  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {triggerButton}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-4"
        align="start"
        role="dialog"
        aria-label="เลือกช่วงวันที่"
      >
        <div className="grid grid-cols-[160px_1fr] gap-4">
          {/* Left: Presets Panel */}
          <PresetsPanel
            presets={presets}
            selectedPreset={selectedPreset}
            onPresetClick={handlePresetClick}
          />

          {/* Right: Dual Calendar */}
          <DualCalendar
            value={draft}
            onChange={handleDateSelect}
            disabled={{
              after: allowFutureDates ? maxDate : (maxDate || getBangkokNow()),
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
