'use client';

import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import {
  getBangkokNow,
  startOfDayBangkok,
  endOfDayBangkok,
} from '@/lib/bangkok-time';
import { DateRangePickerProps, PresetConfig } from './types';
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
      return { startDate: startOfDayBangkok(today), endDate: endOfDayBangkok(today), preset: 'today' };
    },
  },
  {
    key: 'yesterday',
    label: 'เมื่อวานนี้',
    getValue: () => {
      const today = getBangkokNow();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { startDate: startOfDayBangkok(yesterday), endDate: endOfDayBangkok(yesterday), preset: 'yesterday' };
    },
  },
  {
    key: 'last7days',
    label: '7 วันที่ผ่านมา',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { startDate: startOfDayBangkok(start), endDate: endOfDayBangkok(today), preset: 'last7days' };
    },
  },
  {
    key: 'last14days',
    label: '14 วันที่ผ่านมา',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - 13);
      return { startDate: startOfDayBangkok(start), endDate: endOfDayBangkok(today), preset: 'last14days' };
    },
  },
  {
    key: 'last30days',
    label: '30 วันที่ผ่านมา',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { startDate: startOfDayBangkok(start), endDate: endOfDayBangkok(today), preset: 'last30days' };
    },
  },
  {
    key: 'thisWeek',
    label: 'สัปดาห์นี้',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today);
      start.setDate(start.getDate() - today.getDay());
      return { startDate: startOfDayBangkok(start), endDate: endOfDayBangkok(today), preset: 'thisWeek' };
    },
  },
  {
    key: 'thisMonth',
    label: 'เดือนนี้',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: startOfDayBangkok(start), endDate: endOfDayBangkok(today), preset: 'thisMonth' };
    },
  },
  {
    key: 'lastMonth',
    label: 'เดือนที่แล้ว',
    getValue: () => {
      const today = getBangkokNow();
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: startOfDayBangkok(start), endDate: endOfDayBangkok(end), preset: 'lastMonth' };
    },
  },
  {
    key: 'custom',
    label: 'กำหนดเอง',
    getValue: () => {
      const today = getBangkokNow();
      return { startDate: startOfDayBangkok(today), endDate: endOfDayBangkok(today), preset: 'custom' };
    },
  },
];

/**
 * Date Range Picker Component
 *
 * Mobile (< 768px):
 *   Step 1 — preset dropdown; calendar hidden
 *   Step 2 — calendar revealed only when "กำหนดเอง" is selected
 *   Sticky footer with cancel / confirm always visible
 *
 * Desktop (>= 768px):
 *   Popover with presets list + dual calendar side-by-side
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
  // Applied state (shown in trigger button, sent to parent on confirm)
  const [applied, setApplied] = useState<DateRange>(() => ({
    from: value?.startDate || getBangkokNow(),
    to:   value?.endDate   || getBangkokNow(),
  }));

  // Draft state (temporary selection inside picker, not confirmed yet)
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: value?.startDate || getBangkokNow(),
    to:   value?.endDate   || getBangkokNow(),
  }));

  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(value?.preset);
  const [isOpen, setIsOpen]                 = useState(false);
  const [isMobile, setIsMobile]             = useState(false);

  // Calendar visible on mobile only when "กำหนดเอง" is active
  const [showCalendar, setShowCalendar] = useState(false);

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Sync when controlled value changes
  useEffect(() => {
    if (value?.startDate && value?.endDate) {
      setApplied({ from: value.startDate, to: value.endDate });
    }
  }, [value]);

  /** Open / close — reset draft to applied on open */
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDraft({ from: applied.from, to: applied.to });
      // Show calendar if current selection is custom or has no preset label
      setShowCalendar(!selectedPreset || selectedPreset === 'custom');
    }
    setIsOpen(open);
  };

  /** Preset click (desktop list) — updates draft only */
  const handlePresetClick = (preset: PresetConfig) => {
    const range = preset.getValue();
    setDraft({ from: range.startDate, to: range.endDate });
    setSelectedPreset(preset.key);
  };

  /** Preset dropdown change (mobile) */
  const handleMobilePresetChange = (key: string) => {
    const preset = presets.find((p) => p.key === key);
    if (!preset) return;
    setSelectedPreset(key);
    if (key === 'custom') {
      setShowCalendar(true);
    } else {
      const range = preset.getValue();
      setDraft({ from: range.startDate, to: range.endDate });
      setShowCalendar(false);
    }
  };

  /** Calendar selection (draft only, Bangkok timezone boundaries) */
  const handleDateSelect = (range: DateRange | undefined) => {
    if (!range) { setDraft(undefined); setSelectedPreset(undefined); return; }
    if (range.from) range.from = startOfDayBangkok(range.from);
    if (range.to)   range.to   = endOfDayBangkok(range.to);
    setDraft(range);
    setSelectedPreset('custom');
  };

  /** Confirm — only place onChange is called */
  const handleConfirm = () => {
    if (!draft?.from || !draft?.to) return;
    setApplied(draft);
    onChange({ startDate: draft.from, endDate: draft.to, preset: selectedPreset });
    setIsOpen(false);
  };

  /** Cancel — discard draft */
  const handleCancel = () => {
    setDraft({ from: applied.from, to: applied.to });
    setIsOpen(false);
  };

  const getPresetLabel = (): string | undefined => {
    if (!selectedPreset || selectedPreset === 'custom') return undefined;
    return presets.find((p) => p.key === selectedPreset)?.label;
  };

  const isConfirmDisabled = !draft?.from || !draft?.to;

  const formatTriggerDisplay = (): string => {
    if (!applied?.from) return placeholder;
    if (!applied?.to)   return format(applied.from, 'dd MMM yyyy');
    const start = format(applied.from, 'dd MMM yyyy');
    const end   = format(applied.to,   'dd MMM yyyy');
    const label = getPresetLabel();
    return label ? `${label}: ${start} – ${end}` : `${start} – ${end}`;
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

  const disabledMatcher = (() => {
    const d = {
      ...(minDate && { before: minDate }),
      ...(!allowFutureDates ? { after: maxDate || getBangkokNow() } : maxDate ? { after: maxDate } : {}),
    };
    return Object.keys(d).length ? d : undefined;
  })();

  // ─── Mobile: bottom Sheet with 2-step flow ──────────────────────────────────
  if (isMobile) {
    return (
      <>
        {triggerButton}
        <Sheet open={isOpen} onOpenChange={handleOpenChange}>
          <SheetContent
            side="bottom"
            className="h-[90vh] flex flex-col p-0 gap-0"
          >
            {/* Header */}
            <div className="flex-shrink-0 px-5 pt-5 pb-3 border-b pr-12">
              <p className="text-base font-semibold">เลือกช่วงวันที่</p>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Step 1: Preset dropdown */}
              <Select
                value={selectedPreset ?? ''}
                onValueChange={handleMobilePresetChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="เลือกช่วงเวลา" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.key} value={preset.key}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Step 2: Calendar — only for กำหนดเอง */}
              {showCalendar && (
                <DualCalendar
                  value={draft}
                  onChange={handleDateSelect}
                  disabled={disabledMatcher}
                  singleMonth
                />
              )}
            </div>

            {/* Sticky footer */}
            <div className="flex-shrink-0 px-5 py-3 border-t bg-background">
              <Footer
                onCancel={handleCancel}
                onConfirm={handleConfirm}
                isConfirmDisabled={isConfirmDisabled}
                timezone={timezone}
              />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // ─── Desktop: Popover with side-by-side presets + dual calendar ─────────────
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
          <PresetsPanel
            presets={presets}
            selectedPreset={selectedPreset}
            onPresetClick={handlePresetClick}
          />
          <DualCalendar
            value={draft}
            onChange={handleDateSelect}
            disabled={disabledMatcher}
          />
        </div>
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
