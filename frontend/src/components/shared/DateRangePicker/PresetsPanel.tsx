'use client';

import { Button } from '@/components/ui/button';
import { PresetConfig } from './types';

export interface PresetsPanelProps {
  presets: PresetConfig[];
  selectedPreset?: string;
  onPresetClick: (preset: PresetConfig) => void;
  className?: string;
}

/**
 * Presets panel — shows all available presets.
 */
export function PresetsPanel({
  presets,
  selectedPreset,
  onPresetClick,
  className,
}: PresetsPanelProps) {
  return (
    <div className={`space-y-1 ${className || ''}`}>
      {presets.map((preset) => (
        <Button
          key={preset.key}
          variant={selectedPreset === preset.key ? 'default' : 'ghost'}
          size="sm"
          className="w-full justify-start text-sm"
          onClick={() => onPresetClick(preset)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
