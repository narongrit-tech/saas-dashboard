/**
 * Manual Column Mapping Types
 * For Manual Ads Import Wizard (Phase 4+)
 */

// ============================================================================
// Core Types
// ============================================================================

export type ReportType = 'product' | 'live' | 'tiger'

export interface WizardState {
  step: 1 | 2 | 3 | 4
  reportType: ReportType | null
  columnMapping: Record<string, string> // systemField -> excelColumn (with index: "Cost__0")
  dateRange: {
    // For Tiger reports only (manual date range input)
    startDate: string // YYYY-MM-DD
    endDate: string // YYYY-MM-DD
  } | null
  previewData: PreviewResult | null
  savePreset: boolean // Whether to save mapping as preset after import
}

export interface UserPreset {
  id: string
  filename_pattern: string
  report_type: ReportType
  column_mapping: Record<string, string>
  use_count: number
  last_used_at: string
}

export interface PreviewResult {
  success: boolean
  // Preview data
  dateRange: string | null // "2024-12-01 to 2024-12-31" or null for Tiger (manual)
  totalSpend: number
  totalRevenue?: number // For Product/Live only
  totalOrders?: number // For Product/Live only
  avgROAS?: number // For Product/Live only
  recordCount: number // Number of daily records (Product/Live) or campaigns (Tiger)
  sampleRows: ParsedRow[] // First 5 rows for preview
  // Validation results
  warnings: string[]
  errors: string[]
}

export interface ParsedRow {
  date?: string // YYYY-MM-DD (Product/Live only)
  campaignName: string
  spend: number
  orders?: number // Product/Live only
  revenue?: number // Product/Live only
  roi?: number // Product/Live only
}

// ============================================================================
// Field Definitions
// ============================================================================

export interface FieldDefinition {
  systemName: string // System field name (snake_case)
  displayName: string // Display label for UI
  required: boolean // Whether field is required
  description: string // Help text
  reportTypes: ReportType[] // Which report types use this field
}

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    systemName: 'ad_date',
    displayName: 'Date',
    required: true,
    description: 'Campaign date (YYYY-MM-DD or Excel serial date)',
    reportTypes: ['product', 'live'],
  },
  {
    systemName: 'campaign_name',
    displayName: 'Campaign Name',
    required: true,
    description: 'Campaign or product name',
    reportTypes: ['product', 'live', 'tiger'],
  },
  {
    systemName: 'spend',
    displayName: 'Cost / Spend',
    required: true,
    description: 'Ad spend amount (will strip currency symbols)',
    reportTypes: ['product', 'live', 'tiger'],
  },
  {
    systemName: 'orders',
    displayName: 'Orders / Conversions',
    required: true,
    description: 'Number of orders or conversions',
    reportTypes: ['product', 'live'],
  },
  {
    systemName: 'revenue',
    displayName: 'GMV / Revenue',
    required: true,
    description: 'Gross merchandise value or sales revenue',
    reportTypes: ['product', 'live'],
  },
  {
    systemName: 'roi',
    displayName: 'ROAS / ROI',
    required: false,
    description: 'Return on ad spend (optional, will calculate if missing)',
    reportTypes: ['product', 'live'],
  },
]

/**
 * Get required fields for a specific report type
 */
export function getRequiredFields(reportType: ReportType): FieldDefinition[] {
  return FIELD_DEFINITIONS.filter(
    (field) => field.reportTypes.includes(reportType) && field.required
  )
}

/**
 * Get optional fields for a specific report type
 */
export function getOptionalFields(reportType: ReportType): FieldDefinition[] {
  return FIELD_DEFINITIONS.filter(
    (field) => field.reportTypes.includes(reportType) && !field.required
  )
}

/**
 * Get all fields (required + optional) for a report type
 */
export function getAllFields(reportType: ReportType): FieldDefinition[] {
  return FIELD_DEFINITIONS.filter((field) => field.reportTypes.includes(reportType))
}

// ============================================================================
// Excel Column Option
// ============================================================================

export interface ExcelColumnOption {
  value: string // Column name with index: "Cost__0" (for duplicate handling)
  label: string // Display label: "Cost" or "Cost (Column 3)" for duplicates
  originalName: string // Original column name without index
  columnIndex: number // 0-based column index in Excel
}

/**
 * Convert Excel headers to column options (handles duplicate column names)
 */
export function createExcelColumnOptions(headers: string[]): ExcelColumnOption[] {
  // Count duplicates
  const nameCounts = new Map<string, number>()
  headers.forEach((header) => {
    nameCounts.set(header, (nameCounts.get(header) || 0) + 1)
  })

  // Create options with duplicate indicators
  return headers.map((header, index) => {
    const isDuplicate = (nameCounts.get(header) || 0) > 1
    return {
      value: `${header}__${index}`,
      label: isDuplicate ? `${header} (Column ${index + 1})` : header,
      originalName: header,
      columnIndex: index,
    }
  })
}

/**
 * Extract column index from value (e.g., "Cost__2" -> 2)
 */
export function extractColumnIndex(value: string): number {
  const parts = value.split('__')
  return parts.length === 2 ? parseInt(parts[1], 10) : 0
}

/**
 * Extract original column name from value (e.g., "Cost__2" -> "Cost")
 */
export function extractColumnName(value: string): string {
  const parts = value.split('__')
  return parts[0]
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if all required fields are mapped
 */
export function areAllRequiredFieldsMapped(
  reportType: ReportType,
  columnMapping: Record<string, string>
): boolean {
  const requiredFields = getRequiredFields(reportType)
  return requiredFields.every((field) => {
    const mapped = columnMapping[field.systemName]
    return mapped && mapped.trim() !== ''
  })
}

/**
 * Check if Tiger date range is valid
 */
export function isValidTigerDateRange(dateRange: {
  startDate: string
  endDate: string
} | null): boolean {
  if (!dateRange) return false
  if (!dateRange.startDate || !dateRange.endDate) return false
  return new Date(dateRange.endDate) >= new Date(dateRange.startDate)
}
