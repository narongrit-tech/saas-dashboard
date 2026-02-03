'use client';

import { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import {
  getDateRangeFromPreset,
  formatDateRange,
  type DatePreset,
  type DateRangeResult,
} from '@/lib/date-range';
import { cn } from '@/lib/utils';

interface DateRangeFilterProps {
  defaultPreset?: DatePreset;
  onChange: (range: DateRangeResult) => void;
  className?: string;
}

const presetLabels: Record<DatePreset, string> = {
  today: 'วันนี้',
  yesterday: 'เมื่อวาน',
  last7days: '7 วันล่าสุด',
  last30days: '30 วันล่าสุด',
  thisMonth: 'เดือนนี้ (MTD)',
  lastMonth: 'เดือนที่แล้ว',
  custom: 'กำหนดเอง',
};

export function DateRangeFilter({
  defaultPreset = 'today',
  onChange,
  className,
}: DateRangeFilterProps) {
  const [preset, setPreset] = useState<DatePreset>(defaultPreset);
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>();
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>();
  const [currentRange, setCurrentRange] = useState<DateRangeResult>(() =>
    getDateRangeFromPreset(defaultPreset)
  );

  // Update range when preset changes
  useEffect(() => {
    if (preset === 'custom') {
      if (customStartDate && customEndDate) {
        const range = getDateRangeFromPreset(preset, customStartDate, customEndDate);
        setCurrentRange(range);
        onChange(range);
      }
    } else {
      const range = getDateRangeFromPreset(preset);
      setCurrentRange(range);
      onChange(range);
    }
  }, [preset, customStartDate, customEndDate, onChange]);

  const handlePresetChange = (value: DatePreset) => {
    setPreset(value);
    // Reset custom dates if switching away from custom
    if (value !== 'custom') {
      setCustomStartDate(undefined);
      setCustomEndDate(undefined);
    }
  };

  const handleCustomDateChange = (start?: Date, end?: Date) => {
    // Auto-switch to custom preset when dates are picked
    if (start || end) {
      setPreset('custom');
    }
    if (start) setCustomStartDate(start);
    if (end) setCustomEndDate(end);
  };

  // Helper: Convert calendar string (YYYY-MM-DD) to Date for UI display
  const parseCalendarDate = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(presetLabels) as DatePreset[]).map((key) => (
              <SelectItem key={key} value={key}>
                {presetLabels[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Always show date pickers for easy access */}
        <div className="flex gap-2 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-[160px] justify-start text-left font-normal',
                  !customStartDate && preset !== 'custom' && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customStartDate
                  ? format(customStartDate, 'dd/MM/yyyy')
                  : preset !== 'custom'
                  ? format(parseCalendarDate(currentRange.startDate), 'dd/MM/yyyy')
                  : 'วันเริ่มต้น'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={customStartDate || parseCalendarDate(currentRange.startDate)}
                onSelect={(date) => handleCustomDateChange(date, customEndDate)}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground">ถึง</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-[160px] justify-start text-left font-normal',
                  !customEndDate && preset !== 'custom' && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customEndDate
                  ? format(customEndDate, 'dd/MM/yyyy')
                  : preset !== 'custom'
                  ? format(parseCalendarDate(currentRange.endDate), 'dd/MM/yyyy')
                  : 'วันสิ้นสุด'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={customEndDate || parseCalendarDate(currentRange.endDate)}
                onSelect={(date) => handleCustomDateChange(customStartDate, date)}
                initialFocus
                disabled={(date) =>
                  customStartDate
                    ? date < customStartDate
                    : preset !== 'custom'
                    ? date < parseCalendarDate(currentRange.startDate)
                    : false
                }
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="text-sm text-muted-foreground ml-auto">
          {formatDateRange(currentRange.startDate, currentRange.endDate)}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        เขตเวลา: UTC+07:00 (ประเทศไทย)
      </div>
    </div>
  );
}
