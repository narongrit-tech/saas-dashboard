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
}

/**
 * Dual calendar with month/year navigation
 */
export function DualCalendar({
  value,
  onChange,
  disabled,
  className,
}: DualCalendarProps) {
  // Filter out undefined values from disabled prop for react-day-picker
  const disabledMatcher =
    disabled && (disabled.before || disabled.after)
      ? ({
          ...(disabled.before && { before: disabled.before }),
          ...(disabled.after && { after: disabled.after }),
        } as { before?: Date; after?: Date })
      : undefined;

  // Current month for left calendar
  const [leftMonth, setLeftMonth] = useState(() => {
    if (value?.from) {
      return new Date(value.from.getFullYear(), value.from.getMonth(), 1);
    }
    return new Date();
  });

  // Right month is always left month + 1
  const rightMonth = new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1);

  /**
   * Handle month navigation (arrow buttons)
   */
  const handlePreviousMonth = () => {
    const newMonth = new Date(leftMonth);
    newMonth.setMonth(newMonth.getMonth() - 1);
    setLeftMonth(newMonth);
  };

  const handleNextMonth = () => {
    const newMonth = new Date(leftMonth);
    newMonth.setMonth(newMonth.getMonth() + 1);
    setLeftMonth(newMonth);
  };

  /**
   * Handle month change from dropdown (left calendar)
   */
  const handleLeftMonthChange = (month: number) => {
    const newMonth = new Date(leftMonth);
    newMonth.setMonth(month);
    setLeftMonth(newMonth);
  };

  /**
   * Handle year change from dropdown (left calendar)
   */
  const handleLeftYearChange = (year: number) => {
    const newMonth = new Date(leftMonth);
    newMonth.setFullYear(year);
    setLeftMonth(newMonth);
  };

  /**
   * Handle month change from dropdown (right calendar)
   */
  const handleRightMonthChange = (month: number) => {
    const newMonth = new Date(rightMonth);
    newMonth.setMonth(month);
    // Set left month to be 1 month before right month
    const leftDate = new Date(newMonth);
    leftDate.setMonth(leftDate.getMonth() - 1);
    setLeftMonth(leftDate);
  };

  /**
   * Handle year change from dropdown (right calendar)
   */
  const handleRightYearChange = (year: number) => {
    const newMonth = new Date(rightMonth);
    newMonth.setFullYear(year);
    // Set left month to be 1 month before right month
    const leftDate = new Date(newMonth);
    leftDate.setMonth(leftDate.getMonth() - 1);
    setLeftMonth(leftDate);
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
          {/* Left Calendar Selectors */}
          <MonthYearSelector
            month={leftMonth.getMonth()}
            year={leftMonth.getFullYear()}
            onMonthChange={handleLeftMonthChange}
            onYearChange={handleLeftYearChange}
          />

          {/* Right Calendar Selectors */}
          <MonthYearSelector
            month={rightMonth.getMonth()}
            year={rightMonth.getFullYear()}
            onMonthChange={handleRightMonthChange}
            onYearChange={handleRightYearChange}
          />
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

      {/* Dual Calendar */}
      <Calendar
        mode="range"
        selected={value}
        onSelect={onChange}
        numberOfMonths={2}
        month={leftMonth}
        onMonthChange={setLeftMonth}
        disabled={disabledMatcher as any}
        className="rounded-md border"
      />

      {/* Hint text when selecting */}
      {value?.from && !value?.to && (
        <div className="text-xs text-muted-foreground text-center">
          เลือกวันสิ้นสุด
        </div>
      )}
    </div>
  );
}
