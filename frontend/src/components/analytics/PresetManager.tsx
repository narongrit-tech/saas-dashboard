'use client'

import { useState } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  createAnalyticsPreset,
  updateAnalyticsPreset,
  deleteAnalyticsPreset,
  touchAnalyticsPreset,
} from '@/app/(dashboard)/analytics/builder/actions'
import { migrateDefinition } from '@/types/analytics-builder'
import type { AnalyticsPreset, AnalyticsDefinition } from '@/types/analytics-builder'

interface PresetManagerProps {
  presets: AnalyticsPreset[]
  currentDefinition: AnalyticsDefinition
  onPresetLoad: (definition: AnalyticsDefinition) => void
  onPresetsReload: () => void
}

export function PresetManager({
  presets,
  currentDefinition,
  onPresetLoad,
  onPresetsReload,
}: PresetManagerProps) {
  const [savingName, setSavingName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleSave() {
    if (!savingName.trim()) return
    setSaving(true)
    setSaveError(null)
    const result = await createAnalyticsPreset(savingName.trim(), currentDefinition)
    setSaving(false)
    if (!result.success) {
      setSaveError(result.error ?? 'Error')
      return
    }
    setSavingName('')
    setShowSaveInput(false)
    onPresetsReload()
  }

  async function handleLoad(preset: AnalyticsPreset) {
    await touchAnalyticsPreset(preset.id)
    onPresetLoad(migrateDefinition(preset.definition))
    onPresetsReload()
  }

  function startRename(preset: AnalyticsPreset) {
    setRenamingId(preset.id)
    setRenameValue(preset.name)
  }

  async function commitRename(id: string) {
    if (!renameValue.trim()) return
    setRenaming(true)
    await updateAnalyticsPreset(id, { name: renameValue.trim() })
    setRenaming(false)
    setRenamingId(null)
    onPresetsReload()
  }

  function confirmDelete(id: string) {
    setDeletingId(id)
  }

  async function commitDelete(id: string) {
    setDeleting(true)
    await deleteAnalyticsPreset(id)
    setDeleting(false)
    setDeletingId(null)
    onPresetsReload()
  }

  function formatLastUsed(ts: string | null): string {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Presets
      </p>

      {/* Save section */}
      {showSaveInput ? (
        <div className="space-y-1">
          <input
            type="text"
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setShowSaveInput(false); setSaveError(null) }
            }}
            placeholder="Preset name"
            autoFocus
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="default"
              onClick={handleSave}
              disabled={saving || !savingName.trim()}
              className="flex-1 h-7 text-xs"
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowSaveInput(false); setSaveError(null) }}
              className="h-7 px-2"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowSaveInput(true)}
          className="w-full h-7 text-xs"
        >
          Save Preset
        </Button>
      )}

      {/* Preset list */}
      {presets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No presets yet</p>
      ) : (
        <div className="space-y-1">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded-md border bg-white p-2 space-y-1">
              {renamingId === preset.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(preset.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    autoFocus
                    className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={() => commitRename(preset.id)}
                    disabled={renaming}
                    className="p-0.5 text-green-600 hover:text-green-700"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setRenamingId(null)}
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : deletingId === preset.id ? (
                <div className="space-y-1">
                  <p className="text-xs text-destructive">Delete &quot;{preset.name}&quot;?</p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => commitDelete(preset.id)}
                      disabled={deleting}
                      className="flex-1 rounded bg-destructive px-2 py-0.5 text-xs text-white hover:bg-destructive/90"
                    >
                      {deleting ? '...' : 'Delete'}
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="flex-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium break-all leading-tight">{preset.name}</span>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => startRename(preset)}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => confirmDelete(preset.id)}
                        className="p-0.5 text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {preset.last_used_at && (
                    <p className="text-xs text-muted-foreground">
                      Last used: {formatLastUsed(preset.last_used_at)}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleLoad(preset)}
                    className="w-full h-6 text-xs"
                  >
                    Load
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
