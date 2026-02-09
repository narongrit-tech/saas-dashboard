'use client';

import { Button } from '@/components/ui/button';
import { PresetConfig } from './types';
import { RecentSelection } from '@/app/actions/recent-date-selections';

export interface PresetsPanelProps {
  presets: PresetConfig[];
  recentlyUsed: RecentSelection[];
  selectedPreset?: string;
  onPresetClick: (preset: PresetConfig) => void;
  onRecentClick: (recent: RecentSelection) => void;
  className?: string;
}

/**
 * Presets panel with recently used section
 */
export function PresetsPanel({
  presets,
  recentlyUsed,
  selectedPreset,
  onPresetClick,
  onRecentClick,
  className,
}: PresetsPanelProps) {
  return (
    <div className={`space-y-4 ${className || ''}`}>
      {/* Recently Used Section */}
      {recentlyUsed.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase">
            ใช้ล่าสุด
          </div>
          {recentlyUsed.map((recent) => (
            <Button
              key={recent.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sm"
              onClick={() => onRecentClick(recent)}
            >
              <span className="truncate">{recent.label}</span>
            </Button>
          ))}
          <div className="border-t my-2" />
        </div>
      )}

      {/* Presets Section */}
      <div className="space-y-1">
        <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase">
          Presets
        </div>
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
    </div>
  );
}
