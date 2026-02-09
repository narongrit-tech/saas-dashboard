'use client';

import { forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';

export interface TriggerButtonProps {
  startDate: Date | null | undefined;
  endDate: Date | null | undefined;
  presetLabel?: string;
  placeholder?: string;
  className?: string;
}

/**
 * Trigger button for DateRangePicker popover
 * Uses forwardRef to work with Radix UI Popover asChild
 */
export const TriggerButton = forwardRef<HTMLButtonElement, TriggerButtonProps>(
  function TriggerButton(
    {
      startDate,
      endDate,
      presetLabel,
      placeholder = 'เลือกช่วงเวลา',
      className,
    },
    ref
  ) {
    /**
     * Format date range for display
     */
    const formatDateRange = (): string => {
      if (!startDate) return placeholder;
      if (!endDate) return format(startDate, 'dd MMM yyyy');

      const start = format(startDate, 'dd MMM yyyy');
      const end = format(endDate, 'dd MMM yyyy');

      // If preset label provided, use it
      if (presetLabel && presetLabel !== 'custom') {
        return `${presetLabel}: ${start} – ${end}`;
      }

      return `${start} – ${end}`;
    };

    return (
      <Button
        ref={ref}
        variant="outline"
        className={`min-w-[280px] justify-start text-left font-normal ${className || ''}`}
        aria-label="เลือกช่วงวันที่"
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {formatDateRange()}
      </Button>
    );
  }
);
