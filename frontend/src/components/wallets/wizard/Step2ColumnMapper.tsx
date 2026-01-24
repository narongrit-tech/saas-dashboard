/**
 * Step 2: Column Mapping
 * Map Excel columns to system fields + Tiger date range picker
 */

import { useState, useEffect } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertCircle, X, Calendar } from 'lucide-react'
import type {
  ReportType,
  UserPreset,
  ExcelColumnOption,
} from '@/types/manual-mapping'
import {
  getAllFields,
  getRequiredFields,
  areAllRequiredFieldsMapped,
  isValidTigerDateRange,
  createExcelColumnOptions,
} from '@/types/manual-mapping'

interface Step2ColumnMapperProps {
  reportType: ReportType
  excelHeaders: string[]
  columnMapping: Record<string, string>
  dateRange: { startDate: string; endDate: string } | null
  presets: UserPreset[]
  onMappingChange: (mapping: Record<string, string>) => void
  onDateRangeChange: (dateRange: { startDate: string; endDate: string } | null) => void
  canProceed: boolean
}

export function Step2ColumnMapper({
  reportType,
  excelHeaders,
  columnMapping,
  dateRange,
  presets,
  onMappingChange,
  onDateRangeChange,
  canProceed,
}: Step2ColumnMapperProps) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const excelColumnOptions = createExcelColumnOptions(excelHeaders)

  // Get fields for report type
  const allFields = getAllFields(reportType)
  const requiredFields = getRequiredFields(reportType)
  const optionalFields = allFields.filter((f) => !f.required)

  // Handle preset selection
  const handlePresetSelect = (presetId: string) => {
    if (!presetId) {
      setSelectedPreset(null)
      return
    }

    const preset = presets.find((p) => p.id === presetId)
    if (preset) {
      setSelectedPreset(presetId)
      onMappingChange(preset.column_mapping)
    }
  }

  // Handle field mapping
  const handleFieldMap = (systemField: string, excelColumnValue: string) => {
    onMappingChange({
      ...columnMapping,
      [systemField]: excelColumnValue,
    })
    // Clear preset selection when user modifies
    if (selectedPreset) {
      setSelectedPreset(null)
    }
  }

  // Clear preset
  const handleClearPreset = () => {
    setSelectedPreset(null)
    onMappingChange({})
  }

  // Tiger date range handlers
  const handleDateChange = (field: 'startDate' | 'endDate', value: string) => {
    onDateRangeChange({
      startDate: field === 'startDate' ? value : dateRange?.startDate || '',
      endDate: field === 'endDate' ? value : dateRange?.endDate || '',
    })
  }

  // Validation
  const unmappedRequired = requiredFields.filter(
    (field) => !columnMapping[field.systemName] || columnMapping[field.systemName] === ''
  )

  const isTigerDateRangeValid = reportType === 'tiger' ? isValidTigerDateRange(dateRange) : true

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">Map Columns</Label>
        <p className="text-sm text-muted-foreground mt-1">
          เชื่อมต่อ Excel columns กับ system fields
        </p>
      </div>

      {/* Preset Selector */}
      {presets.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
          <Label className="text-sm">Load Preset:</Label>
          <Select value={selectedPreset || ''} onValueChange={handlePresetSelect}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="เลือก saved mapping..." />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.filename_pattern} ({preset.use_count}x)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPreset && (
            <Button variant="ghost" size="sm" onClick={handleClearPreset}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Required Fields */}
      <div>
        <h3 className="font-semibold text-sm mb-2 text-red-700">Required Fields *</h3>
        <div className="space-y-3">
          {requiredFields.map((field) => (
            <div key={field.systemName} className="grid grid-cols-2 gap-3 items-start">
              <div>
                <Label className="text-sm font-medium">
                  {field.displayName} <span className="text-red-500">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
              </div>
              <Select
                value={columnMapping[field.systemName] || ''}
                onValueChange={(value) => handleFieldMap(field.systemName, value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="-- เลือก Excel column --" />
                </SelectTrigger>
                <SelectContent>
                  {excelColumnOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      {/* Optional Fields */}
      {optionalFields.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2 text-gray-700">Optional Fields</h3>
          <div className="space-y-3">
            {optionalFields.map((field) => (
              <div key={field.systemName} className="grid grid-cols-2 gap-3 items-start">
                <div>
                  <Label className="text-sm font-medium">{field.displayName}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
                </div>
                <Select
                  value={columnMapping[field.systemName] || ''}
                  onValueChange={(value) => handleFieldMap(field.systemName, value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="-- Skip (optional) --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">-- Skip --</SelectItem>
                    {excelColumnOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tiger Date Range Picker */}
      {reportType === 'tiger' && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-orange-600" />
            <Label className="text-sm font-semibold text-orange-900">
              Report Date Range <span className="text-red-500">*</span>
            </Label>
          </div>
          <p className="text-xs text-orange-700">
            Tiger report ไม่มี date column ในไฟล์ - กรุณาระบุช่วงเวลาของรายงาน
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Start Date</Label>
              <Input
                type="date"
                value={dateRange?.startDate || ''}
                onChange={(e) => handleDateChange('startDate', e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">End Date</Label>
              <Input
                type="date"
                value={dateRange?.endDate || ''}
                onChange={(e) => handleDateChange('endDate', e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          {dateRange && !isTigerDateRangeValid && (
            <p className="text-xs text-red-600">❌ End date ต้อง >= Start date</p>
          )}
          <p className="text-xs text-orange-700">
            Posting Date = End Date (ตาม business rule)
          </p>
        </div>
      )}

      {/* Validation Alert */}
      {unmappedRequired.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Required fields ยังไม่ครบ:</strong>
            <ul className="list-disc list-inside mt-1">
              {unmappedRequired.map((field) => (
                <li key={field.systemName}>{field.displayName}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {reportType === 'tiger' && !isTigerDateRangeValid && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Tiger report ต้องระบุ date range ที่ valid</strong>
          </AlertDescription>
        </Alert>
      )}

      {/* Success indicator */}
      {canProceed && (
        <Alert className="bg-green-50 border-green-200">
          <AlertCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-900">
            ✅ Column mapping ครบถ้วนแล้ว - กด Next เพื่อดู Preview
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
