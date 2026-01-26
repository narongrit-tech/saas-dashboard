'use client';

import { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import {
  getBangkokNow,
  startOfDayBangkok,
  endOfDayBangkok
} from '@/lib/bangkok-time';

export interface DateRangeResult {
  startDate: Date;
  endDate: Date;
}

interface SingleDateRangePickerProps {
  defaultRange?: DateRangeResult;
  onChange: (range: DateRangeResult) => void;
  presets?: Array<{
    label: string;
    getValue: () => DateRangeResult;
  }>;
}

export function SingleDateRangePicker({
  defaultRange,
  onChange,
  presets = [
    {
      label: 'Today',
      getValue: () => {
        const today = getBangkokNow();
        return {
          startDate: startOfDayBangkok(today),
          endDate: endOfDayBangkok(today)
        };
      },
    },
    {
      label: 'Last 7 Days',
      getValue: () => {
        const now = getBangkokNow();
        const start = new Date(now);
        start.setDate(start.getDate() - 6);
        return {
          startDate: startOfDayBangkok(start),
          endDate: endOfDayBangkok(now)
        };
      },
    },
    {
      label: 'MTD',
      getValue: () => {
        const today = getBangkokNow();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return {
          startDate: startOfDayBangkok(start),
          endDate: endOfDayBangkok(today)
        };
      },
    },
  ],
}: SingleDateRangePickerProps) {
  const [open, setOpen] = useState(false);

  // Applied range (shown in button, sent to parent)
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>(() => {
    if (defaultRange) {
      return {
        from: defaultRange.startDate,
        to: defaultRange.endDate,
      };
    }
    // Default to Last 7 Days
    const lastSevenDays = presets.find((p) => p.label === 'Last 7 Days');
    if (lastSevenDays) {
      const range = lastSevenDays.getValue();
      return { from: range.startDate, to: range.endDate };
    }
    return undefined;
  });

  // Draft range (internal calendar selection state)
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(appliedRange);

  // Sync draftRange with appliedRange when popover opens
  useEffect(() => {
    if (open) {
      setDraftRange(appliedRange);
    }
  }, [open, appliedRange]);

  // Commit range: apply draft and notify parent
  const commitRange = (range: DateRange) => {
    if (range.from && range.to) {
      setAppliedRange(range);
      onChange({
        startDate: range.from,
        endDate: range.to,
      });
      setOpen(false); // Auto-close popover
    }
  };

  // Handle calendar selection
  const handleSelect = (range: DateRange | undefined) => {
    if (!range) {
      setDraftRange(undefined);
      return;
    }

    // Case 1: First click (from only)
    if (range.from && !range.to) {
      setDraftRange(range);
      return;
    }

    // Case 2: Second click with range complete (from + to)
    if (range.from && range.to) {
      // Check if single-day selection (same date clicked twice)
      if (range.from.getTime() === range.to.getTime()) {
        // Single day: commit immediately
        commitRange(range);
      } else {
        // Range: commit immediately
        commitRange(range);
      }
      return;
    }

    // Fallback: update draft
    setDraftRange(range);
  };

  const handlePresetClick = (preset: { getValue: () => DateRangeResult }) => {
    const range = preset.getValue();
    const dateRange = { from: range.startDate, to: range.endDate };
    setAppliedRange(dateRange);
    setDraftRange(dateRange);
    onChange(range);
    setOpen(false);
  };

  const formatDateRangeDisplay = () => {
    if (!appliedRange?.from) return 'Select date range';
    if (!appliedRange.to) return format(appliedRange.from, 'dd MMM yyyy');
    return `${format(appliedRange.from, 'dd MMM yyyy')} – ${format(appliedRange.to, 'dd MMM yyyy')}`;
  };

  const getHintText = () => {
    if (!draftRange?.from) {
      return 'เลือกวันเริ่มต้นและวันสิ้นสุด';
    }
    if (draftRange.from && !draftRange.to) {
      return 'เลือกวันสิ้นสุด';
    }
    return null;
  };

  return (
    <div className="flex items-center gap-2">
      {/* Presets */}
      <div className="flex gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant="outline"
            size="sm"
            onClick={() => handlePresetClick(preset)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Single Date Range Picker */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-[280px] justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formatDateRangeDisplay()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div>
            <Calendar
              mode="range"
              selected={draftRange}
              onSelect={handleSelect}
              numberOfMonths={2}
              defaultMonth={draftRange?.from || appliedRange?.from}
            />
            {/* Hint text */}
            {getHintText() && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/30">
                {getHintText()}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
