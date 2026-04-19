'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rebuildOverviewCache } from './actions'

export function RebuildCacheButton() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function handleRebuild() {
    setLoading(true)
    setMsg(null)
    setIsError(false)
    const res = await rebuildOverviewCache()
    setLoading(false)
    if (res.cacheErrors.length > 0) {
      setIsError(true)
      setMsg(`Cache error: ${res.cacheErrors[0]}`)
    } else if (res.error) {
      setIsError(true)
      setMsg(`Error: ${res.error}`)
    } else {
      setMsg(`✓ ${res.processed} rows, ${res.withThumbnail} thumbnails`)
      setTimeout(() => window.location.reload(), 800)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={handleRebuild} disabled={loading}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Rebuilding...' : 'Rebuild Cache'}
      </Button>
      {msg && (
        <span className={`text-xs ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {msg}
        </span>
      )}
    </div>
  )
}
