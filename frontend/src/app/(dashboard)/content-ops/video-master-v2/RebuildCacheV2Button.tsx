'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rebuildCacheV2 } from './actions'

export function RebuildCacheV2Button() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function handleRebuild() {
    setLoading(true)
    setMsg(null)
    setIsError(false)
    const res = await rebuildCacheV2()
    setLoading(false)
    if (res.error) {
      setIsError(true)
      setMsg(`Error: ${res.error}`)
    } else {
      setMsg(`✓ ${res.processed} rows · ${res.withThumbnail} thumb · ${res.withStudioData} studio`)
      setTimeout(() => window.location.reload(), 800)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={handleRebuild} disabled={loading}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Rebuilding...' : 'Rebuild Cache V2'}
      </Button>
      {msg && (
        <span className={`text-xs ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {msg}
        </span>
      )}
    </div>
  )
}
