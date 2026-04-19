'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runMasterRefresh } from './actions'

export function MasterRefreshButton() {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  function handleRefresh() {
    setMessage(null)
    setIsError(false)
    startTransition(async () => {
      const res = await runMasterRefresh()
      if (!res.success) {
        setMessage(res.error ?? 'Refresh failed')
        setIsError(true)
        return
      }
      const p = res.result?.products_upserted ?? 0
      const s = res.result?.shops_upserted ?? 0
      setMessage(`Registry refreshed: ${p} product${p !== 1 ? 's' : ''}, ${s} shop${s !== 1 ? 's' : ''}`)
      setIsError(false)
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isPending}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isPending ? 'animate-spin' : ''}`} />
        {isPending ? 'Refreshing…' : 'Refresh registry'}
      </Button>
      {message && (
        <p className={`text-xs ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
