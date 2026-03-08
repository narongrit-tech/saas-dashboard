'use client';

import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { MonthYearSelector } from './MonthYearSelector';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface DualCalendarProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  disabled?: {
    before?: Date | undefined;
    after?: Date | undefined;
  };
  className?: string;
  /** When true: single-month view (used on mobile) */
  singleMonth?: boolean;
}

/**
 * Calendar with month/year navigation.
 * Desktop: dual-month side-by-side.
 * Mobile: pass singleMonth=true to render one month only.
 */
export function DualCalendar({
  value,
  onChange,
  disabled,
  className,
  singleMonth = false,
}: DualCalendarProps) {
  const disabledMatcher =
    disabled && (disabled.before || disabled.after)
      ? ({
          ...(disabled.before && { before: disabled.before }),
          ...(disabled.after  && { after:  disabled.after  }),
        } as { before?: Date; after?: Date })
      : undefined;

  const [leftMonth, setLeftMonth] = useState(() => {
    if (value?.from) return new Date(value.from.getFullYear(), value.from.getMonth(), 1);
    return new Date();
  });

  const rightMonth = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1);

  const handlePreviousMonth = () => {
    const m = new Date(leftMonth);
    m.setMonth(m.getMonth() - 1);
    setLeftMonth(m);
  };

  const handleNextMonth = () => {
    const m = new Date(leftMonth);
    m.setMonth(m.getMonth() + 1);
    setLeftMonth(m);
  };

  const handleLeftMonthChange = (month: number) => {
    const m = new Date(leftMonth);
    m.setMonth(month);
    setLeftMonth(m);
  };

  const handleLeftYearChange = (year: number) => {
    const m = new Date(leftMonth);
    m.setFullYear(year);
    setLeftMonth(m);
  };

  const handleRightMonthChange = (month: number) => {
    const m = new Date(rightMonth);
    m.setMonth(month);
    const left = new Date(m);
    left.setMonth(left.getMonth() - 1);
    setLeftMonth(left);
  };

  const handleRightYearChange = (year: number) => {
    const m = new Date(rightMonth);
    m.setFullYear(year);
    const left = new Date(m);
    left.setMonth(left.getMonth() - 1);
    setLeftMonth(left);
  };

  return (
    <div className={`flex flex-col gap-2 ${className || ''}`}>
      {/* Month/Year Navigation */}
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handlePreviousMonth}
          aria-label="เดือนก่อนหน้า"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex gap-4">
          <MonthYearSelector
            month={leftMonth.getMonth()}
            year={leftMonth.getFullYear()}
            onMonthChange={handleLeftMonthChange}
            onYearChange={handleLeftYearChange}
          />
          {!singleMonth && (
            <MonthYearSelector
              month={rightMonth.getMonth()}
              year={rightMonth.getFullYear()}
              onMonthChange={handleRightMonthChange}
              onYearChange={handleRightYearChange}
            />
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleNextMonth}
          aria-label="เดือนถัดไป"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar */}
      <Calendar
        mode="range"
        selected={value}
        onSelect={onChange}
        numberOfMonths={singleMonth ? 1 : 2}
        month={leftMonth}
        onMonthChange={setLeftMonth}
        disabled={disabledMatcher as Parameters<typeof Calendar>[0]['disabled']}
        className="rounded-md border"
      />

      {value?.from && !value?.to && (
        <div className="text-xs text-muted-foreground text-center">เลือกวันสิ้นสุด</div>
      )}
    </div>
  );
}
