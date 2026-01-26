'use client';

import { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { getBangkokNow, startOfDayBangkok, endOfDayBangkok } from '@/lib/bangkok-time';
import { cn } from '@/lib/utils';

export interface DateRangeValue {
  from: Date;
  to: Date;
}

interface UnifiedDateRangePickerProps {
  value?: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  disabled?: boolean;
  className?: string;
  defaultPreset?: 'today' | 'last7' | 'last30';
}

// Preset definitions
const presets = [
  {
    label: 'Today',
    getValue: () => {
      const today = getBangkokNow();
      return {
        from: startOfDayBangkok(today),
        to: endOfDayBangkok(today),
      };
    },
  },
  {
    label: 'Yesterday',
    getValue: () => {
      const yesterday = new Date(getBangkokNow());
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        from: startOfDayBangkok(yesterday),
        to: endOfDayBangkok(yesterday),
      };
    },
  },
  {
    label: 'Last 7 days',
    getValue: () => {
      const now = getBangkokNow();
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return {
        from: startOfDayBangkok(start),
        to: endOfDayBangkok(now),
      };
    },
  },
  {
    label: 'Last 30 days',
    getValue: () => {
      const now = getBangkokNow();
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return {
        from: startOfDayBangkok(start),
        to: endOfDayBangkok(now),
      };
    },
  },
  {
    label: 'Last 3 months',
    getValue: () => {
      const now = getBangkokNow();
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      return {
        from: startOfDayBangkok(start),
        to: endOfDayBangkok(now),
      };
    },
  },
  {
    label: 'Last 6 months',
    getValue: () => {
      const now = getBangkokNow();
      const start = new Date(now);
      start.setMonth(start.getMonth() - 6);
      return {
        from: startOfDayBangkok(start),
        to: endOfDayBangkok(now),
      };
    },
  },
  {
    label: 'Last 12 months',
    getValue: () => {
      const now = getBangkokNow();
      const start = new Date(now);
      start.setMonth(start.getMonth() - 12);
      return {
        from: startOfDayBangkok(start),
        to: endOfDayBangkok(now),
      };
    },
  },
];

export function UnifiedDateRangePicker({
  value,
  onChange,
  disabled = false,
  className,
  defaultPreset = 'last7',
}: UnifiedDateRangePickerProps) {
  const [open, setOpen] = useState(false);

  // Applied range (controlled by parent via value prop)
  const appliedRange: DateRange | undefined = value
    ? { from: value.from, to: value.to }
    : undefined;

  // Draft range (internal calendar selection)
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(appliedRange);

  // Initialize with default preset if no value (runs once on mount)
  useEffect(() => {
    if (!value) {
      const defaultPresetData = presets.find((p) =>
        p.label.toLowerCase().includes(defaultPreset)
      );
      if (defaultPresetData) {
        const range = defaultPresetData.getValue();
        onChange(range);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync draftRange with appliedRange ONLY when popover opens
  useEffect(() => {
    if (open) {
      setDraftRange(appliedRange);
    }
  }, [open]);

  // Commit range: apply and close
  const commitRange = (range: DateRange) => {
    if (range.from && range.to) {
      onChange({
        from: range.from,
        to: range.to,
      });
      setOpen(false);
    }
  };

  // Handle calendar selection
  const handleSelect = (range: DateRange | undefined) => {
    if (!range) {
      setDraftRange(undefined);
      return;
    }

    // Case 1: First click (from only, no to)
    if (range.from && !range.to) {
      setDraftRange(range);
      // DO NOT apply, DO NOT close
      return;
    }

    // Case 2: Second click (from + to)
    if (range.from && range.to) {
      // Apply range and close popover
      commitRange(range);
      return;
    }
  };

  // Handle preset click
  const handlePresetClick = (preset: { getValue: () => DateRangeValue }) => {
    const range = preset.getValue();
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
      return 'Select start and end date';
    }
    if (draftRange.from && !draftRange.to) {
      return 'Select end date';
    }
    return null;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'min-w-[280px] justify-start text-left font-normal',
            !appliedRange && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatDateRangeDisplay()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Preset Panel (Left) */}
          <div className="border-r p-3 space-y-1 min-w-[140px]">
            <div className="text-xs font-medium text-muted-foreground mb-2">Quick Select</div>
            {presets.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="w-full justify-start text-sm font-normal"
                onClick={() => handlePresetClick(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Calendar (Right) */}
          <div>
            <Calendar
              mode="range"
              selected={draftRange}
              onSelect={handleSelect}
              numberOfMonths={2}
              defaultMonth={draftRange?.from || appliedRange?.from || getBangkokNow()}
            />
            {/* Hint text */}
            {getHintText() && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/30">
                {getHintText()}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
