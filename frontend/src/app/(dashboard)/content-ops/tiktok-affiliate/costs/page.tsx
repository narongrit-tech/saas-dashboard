'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, AlertCircle, Info, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getCosts, insertCost, deleteCost, type CostRow } from '../actions'

const COST_TYPE_STYLE: Record<string, string> = {
  ads: 'text-blue-700 bg-blue-50 border-blue-200',
  creator: 'text-purple-700 bg-purple-50 border-purple-200',
  misc: 'text-gray-700 bg-gray-50 border-gray-200',
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function today(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

export default function CostsPage() {
  const [rows, setRows] = useState<CostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await getCosts()
    setRows(data)
    setListError(error)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function handleInsert(formData: FormData) {
    setFormError(null)
    startTransition(async () => {
      const result = await insertCost(formData)
      if (!result.success) {
        setFormError(result.error)
        return
      }
      formRef.current?.reset()
      setShowForm(false)
      await load()
    })
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const result = await deleteCost(id)
    setDeletingId(null)
    if (result.success) {
      await load()
    } else {
      setListError(result.error)
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/content-ops/tiktok-affiliate">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Overview
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Cost Input</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            tt_content_costs — {rows.length} row{rows.length !== 1 ? 's' : ''}. Run profit refresh after changes.
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowForm((p) => !p); setFormError(null) }}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add cost
        </Button>
      </div>

      {/* Allocation explanation */}
      <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/20">
        <CardContent className="py-3 px-4">
          <div className="flex gap-2 text-sm">
            <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-blue-900 dark:text-blue-200">
              <p className="font-medium">How cost allocation works</p>
              <ul className="text-xs space-y-0.5 text-blue-800 dark:text-blue-300">
                <li>• <strong>product_id blank</strong> → cost spreads across all products for that content by realized GMV share</li>
                <li>• <strong>product_id set</strong> → 100% allocated to that (content, product) pair</li>
                <li>• <strong>cost_date</strong> should match the Bangkok business date of the orders you're attributing to</li>
                <li>• Unallocated costs (no matching order date) are preserved — not discarded</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insert form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New cost row</CardTitle>
            <CardDescription className="text-xs">All fields required except product_id and notes</CardDescription>
          </CardHeader>
          <CardContent>
            <form ref={formRef} action={handleInsert} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Content ID *</label>
                  <input
                    name="content_id"
                    required
                    placeholder="e.g. 7443219…"
                    className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Product ID <span className="text-muted-foreground/60">(optional)</span></label>
                  <input
                    name="product_id"
                    placeholder="blank = spread across all products"
                    className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Cost type *</label>
                  <select
                    name="cost_type"
                    required
                    defaultValue=""
                    className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="" disabled>Select type</option>
                    <option value="ads">ads</option>
                    <option value="creator">creator</option>
                    <option value="misc">misc</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Amount *</label>
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="0.00"
                    className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Currency *</label>
                  <input
                    name="currency"
                    required
                    placeholder="THB"
                    defaultValue="THB"
                    className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring uppercase"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Cost date *</label>
                  <input
                    name="cost_date"
                    type="date"
                    required
                    defaultValue={today()}
                    className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notes <span className="text-muted-foreground/60">(optional)</span></label>
                <input
                  name="notes"
                  placeholder="Campaign name, reference, etc."
                  className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {formError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save cost'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowForm(false); setFormError(null) }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {listError && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {listError}
        </div>
      )}

      {!loading && rows.length === 0 && !listError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <DollarSign className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No cost rows yet</p>
            <p className="text-xs text-muted-foreground">Add costs to compute real profit. Without costs, profit = commission only.</p>
            <Button size="sm" className="mt-2" onClick={() => setShowForm(true)}>
              Add first cost
            </Button>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content ID</TableHead>
                    <TableHead>Product ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Cost date</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.content_id}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.product_id ?? <span className="italic text-muted-foreground/60">all products</span>}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${COST_TYPE_STYLE[row.cost_type] ?? ''}`}>
                          {row.cost_type}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(row.amount)}</TableCell>
                      <TableCell className="text-xs">{row.currency}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.cost_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{row.notes ?? '—'}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleDelete(row.id)}
                          disabled={deletingId === row.id}
                          className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          title="Delete cost row"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          After adding or removing cost rows, go to{' '}
          <Link href="/content-ops/tiktok-affiliate/profit" className="underline hover:text-foreground">
            Profit
          </Link>{' '}
          and run a refresh to recompute allocations.
        </p>
      )}
    </div>
  )
}
