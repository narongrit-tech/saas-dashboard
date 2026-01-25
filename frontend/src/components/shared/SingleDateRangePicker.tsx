'use client';

import { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return { startDate: today, endDate: today };
      },
    },
    {
      label: 'Last 7 Days',
      getValue: () => {
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        const start = new Date();
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        return { startDate: start, endDate: end };
      },
    },
    {
      label: 'MTD',
      getValue: () => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(today);
        end.setHours(23, 59, 59, 999);
        return { startDate: start, endDate: end };
      },
    },
  ],
}: SingleDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
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

  // Auto-apply when both dates selected
  useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      onChange({
        startDate: dateRange.from,
        endDate: dateRange.to,
      });
    }
  }, [dateRange, onChange]);

  const handlePresetClick = (preset: { getValue: () => DateRangeResult }) => {
    const range = preset.getValue();
    setDateRange({ from: range.startDate, to: range.endDate });
    setOpen(false);
  };

  const formatDateRange = () => {
    if (!dateRange?.from) return 'Select date range';
    if (!dateRange.to) return format(dateRange.from, 'dd MMM yyyy');
    return `${format(dateRange.from, 'dd MMM yyyy')} – ${format(dateRange.to, 'dd MMM yyyy')}`;
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
            {formatDateRange()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={setDateRange}
            numberOfMonths={2}
            defaultMonth={dateRange?.from}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
