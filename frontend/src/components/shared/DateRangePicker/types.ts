import { DateRange } from 'react-day-picker';

/**
 * Date Range Picker component props
 */
export interface DateRangePickerProps {
  /**
   * Current selected date range (controlled component)
   */
  value: DateRangeResult;

  /**
   * Callback when date range is confirmed
   * Only fires when user clicks "ยืนยัน" button
   */
  onChange: (range: DateRangeResult) => void;

  /**
   * Minimum selectable date (optional)
   */
  minDate?: Date;

  /**
   * Maximum selectable date
   * @default getBangkokNow() - prevents selecting future dates
   */
  maxDate?: Date;

  /**
   * Timezone display text
   * @default "เวลามาตรฐานไทย (UTC+07:00)"
   */
  timezone?: string;

  /**
   * Custom presets (optional)
   * If not provided, uses default presets
   */
  presets?: PresetConfig[];

  /**
   * Placeholder text when no range selected
   * @default "เลือกช่วงเวลา"
   */
  placeholder?: string;
}

/**
 * Date range result (output format)
 */
export interface DateRangeResult {
  /**
   * Start date
   */
  startDate: Date;

  /**
   * End date
   */
  endDate: Date;

  /**
   * Preset key if selected from preset (e.g., "last7days")
   */
  preset?: string;
}

/**
 * Preset configuration
 */
export interface PresetConfig {
  /**
   * Unique key for this preset
   */
  key: string;

  /**
   * Display label (Thai)
   */
  label: string;

  /**
   * Function to calculate date range
   */
  getValue: () => DateRangeResult;
}

/**
 * Internal state for draft and applied ranges
 */
export interface DateRangeState {
  /**
   * Applied range (shown in trigger button)
   */
  applied: DateRange;

  /**
   * Draft range (temporary selection in popover)
   */
  draft: DateRange;

  /**
   * Selected preset key (if any)
   */
  selectedPreset?: string;

  /**
   * Popover open state
   */
  isOpen: boolean;
}
