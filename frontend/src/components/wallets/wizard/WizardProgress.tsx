/**
 * Wizard Progress Indicator
 * Shows current step in 4-step wizard
 */

interface WizardProgressProps {
  currentStep: 1 | 2 | 3 | 4
}

const steps = [
  { number: 1, label: 'Report Type' },
  { number: 2, label: 'Column Mapping' },
  { number: 3, label: 'Preview' },
  { number: 4, label: 'Confirm' },
]

export function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center flex-1">
          {/* Step circle */}
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step.number === currentStep
                  ? 'bg-blue-600 text-white'
                  : step.number < currentStep
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-600'
              }`}
            >
              {step.number}
            </div>
            <span
              className={`text-xs mt-1 ${
                step.number === currentStep ? 'text-blue-600 font-medium' : 'text-gray-500'
              }`}
            >
              {step.label}
            </span>
          </div>

          {/* Connector line */}
          {index < steps.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 ${
                step.number < currentStep ? 'bg-green-600' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
