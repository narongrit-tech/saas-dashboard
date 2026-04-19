'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { EntityAvatar } from './entity-avatar'
import type { ProductTableResult, ShopTableResult } from '@/app/(dashboard)/content-ops/actions'

// Re-export for convenience so pages import from one place
export type { ProductTableResult, ShopTableResult }

// ─── Product full table ────────────────────────────────────────────────────────

export function ProductFullTable({ rows }: { rows: ProductTableResult[] }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(
      (r) =>
        r.productId.toLowerCase().includes(q) ||
        (r.productName ?? '').toLowerCase().includes(q) ||
        (r.topShopName ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  return (
    <div className="space-y-3">
      {/* Instant search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all products..."
          className="w-full sm:w-72 h-8 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {filtered.length} / {rows.length}
          </span>
        )}
      </div>

      {/* Table — all rows, no pagination */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Product</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Shops</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Order Items</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Top Shop</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-sm text-muted-foreground">
                    No products match &quot;{search}&quot;
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.productId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/content-ops/products/${encodeURIComponent(row.productId)}`}
                        className="flex items-center gap-2.5 group"
                      >
                        <EntityAvatar name={row.productName ?? row.productId} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium truncate group-hover:underline">
                            {row.productName ?? row.productId}
                          </p>
                          {row.productName && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {row.productId}
                            </p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {row.shopCount}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {row.orderItems.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <span className="truncate max-w-[160px] block">
                        {row.topShopName ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 bg-muted/20 text-xs text-muted-foreground">
          {filtered.length === rows.length
            ? `${rows.length} products total`
            : `${filtered.length} of ${rows.length} products`}
        </div>
      </div>
    </div>
  )
}

// ─── Shop full table ───────────────────────────────────────────────────────────

export function ShopFullTable({ rows }: { rows: ShopTableResult[] }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(
      (r) =>
        r.shopCode.toLowerCase().includes(q) ||
        (r.shopName ?? '').toLowerCase().includes(q) ||
        (r.topProductName ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  return (
    <div className="space-y-3">
      {/* Instant search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all shops..."
          className="w-full sm:w-72 h-8 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {filtered.length} / {rows.length}
          </span>
        )}
      </div>

      {/* Table — all rows, no pagination */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Shop</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Products</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Order Items</th>
                <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Top Product</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-sm text-muted-foreground">
                    No shops match &quot;{search}&quot;
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.shopCode} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/content-ops/shops/${encodeURIComponent(row.shopCode)}`}
                        className="flex items-center gap-2.5 group"
                      >
                        <EntityAvatar name={row.shopName ?? row.shopCode} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium truncate group-hover:underline">
                            {row.shopName ?? row.shopCode}
                          </p>
                          {row.shopName && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {row.shopCode}
                            </p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {row.productCount}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {row.orderItems.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <span className="truncate max-w-[160px] block">
                        {row.topProductName ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 bg-muted/20 text-xs text-muted-foreground">
          {filtered.length === rows.length
            ? `${rows.length} shops total`
            : `${filtered.length} of ${rows.length} shops`}
        </div>
      </div>
    </div>
  )
}
