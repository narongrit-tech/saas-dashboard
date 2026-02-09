'use client';

import { Button } from '@/components/ui/button';

export interface FooterProps {
  onCancel: () => void;
  onConfirm: () => void;
  isConfirmDisabled: boolean;
  timezone?: string;
  className?: string;
}

/**
 * Footer with cancel/confirm buttons and timezone display
 */
export function Footer({
  onCancel,
  onConfirm,
  isConfirmDisabled,
  timezone = 'เวลามาตรฐานไทย (UTC+07:00)',
  className,
}: FooterProps) {
  return (
    <div className={`flex items-center justify-between ${className || ''}`}>
      <div className="text-xs text-muted-foreground">
        {timezone}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
        >
          ยกเลิก
        </Button>
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={isConfirmDisabled}
        >
          ✓ ยืนยัน
        </Button>
      </div>
    </div>
  );
}
