'use client'

/**
 * Manual Column Mapping Wizard
 * Main dialog orchestrating 4-step wizard for manual ads import
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { WizardProgress } from './wizard/WizardProgress'
import { Step1ReportType } from './wizard/Step1ReportType'
import { Step2ColumnMapper } from './wizard/Step2ColumnMapper'
import { Step3Preview } from './wizard/Step3Preview'
import { Step4Confirm } from './wizard/Step4Confirm'
import {
  loadUserPresets,
  parseWithCustomMapping,
  executeManualImport,
} from '@/app/(dashboard)/wallets/manual-mapping-actions'
import type {
  WizardState,
  ReportType,
  UserPreset,
  PreviewResult,
} from '@/types/manual-mapping'
import {
  areAllRequiredFieldsMapped,
  isValidTigerDateRange,
} from '@/types/manual-mapping'

interface ManualMappingWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  adsWalletId: string
  fileBuffer: ArrayBuffer
  fileName: string
  excelHeaders: string[]
  onImportSuccess: () => void
}

export function ManualMappingWizard({
  open,
  onOpenChange,
  adsWalletId,
  fileBuffer,
  fileName,
  excelHeaders,
  onImportSuccess,
}: ManualMappingWizardProps) {
  // Wizard state
  const [wizard, setWizard] = useState<WizardState>({
    step: 1,
    reportType: null,
    columnMapping: {},
    dateRange: null,
    previewData: null,
    savePreset: true,
  })

  const [presets, setPresets] = useState<UserPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Load presets when report type changes
  useEffect(() => {
    if (wizard.reportType) {
      loadPresetsForType(wizard.reportType)
    }
  }, [wizard.reportType])

  const loadPresetsForType = async (reportType: ReportType) => {
    try {
      const result = await loadUserPresets(reportType)
      if (result.success && result.presets) {
        setPresets(result.presets)
      }
    } catch (err) {
      console.error('Error loading presets:', err)
    }
  }

  // Step navigation validation
  const canProceed = {
    step1: wizard.reportType !== null,
    step2:
      areAllRequiredFieldsMapped(wizard.reportType!, wizard.columnMapping) &&
      (wizard.reportType === 'tiger' ? isValidTigerDateRange(wizard.dateRange) : true),
    step3: wizard.previewData !== null && wizard.previewData.errors.length === 0,
    step4: true,
  }

  // Handlers
  const handleReportTypeChange = (type: ReportType) => {
    setWizard((prev) => ({
      ...prev,
      reportType: type,
      columnMapping: {}, // Reset mapping
      dateRange: null, // Reset date range
      previewData: null, // Reset preview
    }))
    setError(null)
  }

  const handleMappingChange = (mapping: Record<string, string>) => {
    setWizard((prev) => ({
      ...prev,
      columnMapping: mapping,
      previewData: null, // Clear preview when mapping changes
    }))
  }

  const handleDateRangeChange = (dateRange: { startDate: string; endDate: string } | null) => {
    setWizard((prev) => ({
      ...prev,
      dateRange,
      previewData: null, // Clear preview when date range changes
    }))
  }

  const handleNext = async () => {
    setError(null)

    // Step 2 -> Step 3: Generate preview
    if (wizard.step === 2) {
      await generatePreview()
      return
    }

    // Step 3 -> Step 4: Just navigate
    if (wizard.step === 3) {
      setWizard((prev) => ({ ...prev, step: 4 }))
      return
    }

    // Other steps: Simple navigation
    if (wizard.step < 4) {
      setWizard((prev) => ({ ...prev, step: (prev.step + 1) as 1 | 2 | 3 | 4 }))
    }
  }

  const handleBack = () => {
    if (wizard.step > 1) {
      // Clear preview when going back from step 3
      if (wizard.step === 3) {
        setWizard((prev) => ({ ...prev, step: 2, previewData: null }))
      } else {
        setWizard((prev) => ({ ...prev, step: (prev.step - 1) as 1 | 2 | 3 | 4 }))
      }
    }
    setError(null)
  }

  const generatePreview = async () => {
    setPreviewLoading(true)
    setError(null)

    try {
      const result = await parseWithCustomMapping(
        fileBuffer,
        fileName,
        wizard.reportType!,
        wizard.columnMapping,
        wizard.dateRange || undefined
      )

      if (!result.success || !result.preview) {
        setError(result.error || 'ไม่สามารถ parse ไฟล์ได้')
        return
      }

      setWizard((prev) => ({
        ...prev,
        previewData: result.preview!,
        step: 3,
      }))
    } catch (err) {
      console.error('Error generating preview:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!wizard.previewData) {
      setError('ไม่มี preview data')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await executeManualImport(
        fileBuffer,
        fileName,
        wizard.reportType!,
        wizard.columnMapping,
        adsWalletId,
        wizard.dateRange || undefined,
        wizard.savePreset
      )

      if (!result.success) {
        setError(result.error || 'ไม่สามารถ import ได้')
        return
      }

      const data = result.data as {
        recordCount: number
        totalSpend: number
        totalRevenue?: number
        avgROAS?: number
      }

      setSuccess(
        `✅ Import สำเร็จ - ${data.recordCount} records, Total Spend: ${data.totalSpend.toLocaleString('th-TH')} THB`
      )

      // Close and refresh after success
      setTimeout(() => {
        handleClose()
        onImportSuccess()
      }, 2500)
    } catch (err) {
      console.error('Error importing:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setWizard({
      step: 1,
      reportType: null,
      columnMapping: {},
      dateRange: null,
      previewData: null,
      savePreset: true,
    })
    setPresets([])
    setError(null)
    setSuccess(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual Column Mapping Wizard</DialogTitle>
          <DialogDescription>
            กำหนด column mapping เองเมื่อ auto-parse ล้มเหลว หรือไฟล์มี column ที่ไม่ standard
          </DialogDescription>
        </DialogHeader>

        {/* Progress Indicator */}
        <WizardProgress currentStep={wizard.step} />

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Success Alert */}
        {success && (
          <Alert className="border-green-500 bg-green-50 text-green-900">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {/* Step Content */}
        <div className="py-4">
          {wizard.step === 1 && (
            <Step1ReportType
              selectedType={wizard.reportType}
              onTypeChange={handleReportTypeChange}
            />
          )}

          {wizard.step === 2 && wizard.reportType && (
            <Step2ColumnMapper
              reportType={wizard.reportType}
              excelHeaders={excelHeaders}
              columnMapping={wizard.columnMapping}
              dateRange={wizard.dateRange}
              presets={presets}
              onMappingChange={handleMappingChange}
              onDateRangeChange={handleDateRangeChange}
              canProceed={canProceed.step2}
            />
          )}

          {wizard.step === 3 && wizard.reportType && (
            <Step3Preview
              reportType={wizard.reportType}
              preview={wizard.previewData}
              loading={previewLoading}
            />
          )}

          {wizard.step === 4 && wizard.reportType && wizard.previewData && (
            <Step4Confirm
              reportType={wizard.reportType}
              fileName={fileName}
              preview={wizard.previewData}
              savePreset={wizard.savePreset}
              onSavePresetChange={(checked) =>
                setWizard((prev) => ({ ...prev, savePreset: checked }))
              }
            />
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            {wizard.step > 1 && (
              <Button variant="outline" onClick={handleBack} disabled={loading || previewLoading}>
                Back
              </Button>
            )}
          </div>

          <div>
            {wizard.step < 4 ? (
              <Button
                onClick={handleNext}
                disabled={
                  !canProceed[`step${wizard.step}` as 'step1' | 'step2' | 'step3'] ||
                  loading ||
                  previewLoading
                }
              >
                {previewLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Preview...
                  </>
                ) : wizard.step === 2 ? (
                  'Generate Preview'
                ) : (
                  'Next'
                )}
              </Button>
            ) : (
              <Button
                onClick={handleConfirmImport}
                disabled={loading || !!success}
                className="bg-green-600 hover:bg-green-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Confirm Import'
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
