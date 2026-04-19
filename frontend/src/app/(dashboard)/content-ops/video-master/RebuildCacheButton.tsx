'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rebuildOverviewCache } from './actions'

export function RebuildCacheButton() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleRebuild() {
    setLoading(true)
    setMsg(null)
    const res = await rebuildOverviewCache()
    setLoading(false)
    if (res.ok) {
      setMsg(`✓ Rebuilt ${res.rebuilt} rows`)
      setTimeout(() => window.location.reload(), 800)
    } else {
      setMsg(`Error: ${res.error}`)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={handleRebuild} disabled={loading}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Rebuilding...' : 'Rebuild Cache'}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  )
}
