'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  CreditCard,
  Wallet,
  TrendingUp,
  Settings,
  Coins,
  GitCompare,
  Landmark,
  Scale,
  Users,
  FileBarChart,
  ChevronDown,
  ChevronRight,
  ArrowLeftCircle,
  Tags,
  Banknote,
  Palette,
  Shield,
  Key,
  Calculator,
  Lock,
  Zap,
  GitFork,
  UserCircle,
  Video,
} from 'lucide-react'

interface MenuItem {
  title: string
  href: string
  icon: React.ElementType
}

interface MenuGroup {
  title: string
  items: MenuItem[]
  defaultExpanded: boolean
}

const menuGroups: MenuGroup[] = [
  {
    title: 'Overview',
    defaultExpanded: true,
    items: [
      {
        title: 'Quick Actions',
        href: '/quick-actions',
        icon: Zap,
      },
      {
        title: 'Dashboard',
        href: '/',
        icon: LayoutDashboard,
      },
      {
        title: 'Performance',
        href: '/overview/performance',
        icon: TrendingUp,
      },
      {
        title: 'Cash P&L',
        href: '/reports/cash-pl',
        icon: Banknote,
      },
    ],
  },
  {
    title: 'Sales',
    defaultExpanded: true,
    items: [
      {
        title: 'Sales Orders',
        href: '/sales',
        icon: ShoppingCart,
      },
      {
        title: 'Affiliates',
        href: '/affiliates',
        icon: Users,
      },
      {
        title: 'Affiliate Report',
        href: '/reports/affiliate',
        icon: FileBarChart,
      },
    ],
  },
  {
    title: 'Content Ops',
    defaultExpanded: true,
    items: [
      {
        title: 'Content Library',
        href: '/content-ops/library',
        icon: Video,
      },
    ],
  },
  {
    title: 'Money',
    defaultExpanded: true,
    items: [
      {
        title: 'Marketplace Finance',
        href: '/finance/marketplaces',
        icon: Wallet,
      },
      {
        title: 'Wallets',
        href: '/wallets',
        icon: CreditCard,
      },
      {
        title: 'CEO Commission',
        href: '/ceo-commission',
        icon: TrendingUp,
      },
      {
        title: 'Company Cashflow',
        href: '/company-cashflow',
        icon: Coins,
      },
      { title: 'Cash Source Flow', href: '/cashflow/source-flow', icon: GitFork    },
      { title: 'CEO Cash Flow',    href: '/ceo-flow',             icon: UserCircle },
      {
        title: 'Bank',
        href: '/bank',
        icon: Landmark,
      },
      {
        title: 'Bank Reconciliation',
        href: '/bank-reconciliation',
        icon: Scale,
      },
      {
        title: 'P&L Reconciliation',
        href: '/reconciliation',
        icon: GitCompare,
      },
    ],
  },
  {
    title: 'Operations',
    defaultExpanded: false,
    items: [
      {
        title: 'Expenses',
        href: '/expenses',
        icon: Receipt,
      },
      {
        title: 'Returns',
        href: '/returns',
        icon: ArrowLeftCircle,
      },
      {
        title: 'Inventory',
        href: '/inventory',
        icon: Package,
      },
      {
        title: 'Payables',
        href: '/payables',
        icon: CreditCard,
      },
      {
        title: 'SKU Mappings',
        href: '/sku-mappings',
        icon: Tags,
      },
    ],
  },
  {
    title: 'Settings',
    defaultExpanded: false,
    items: [
      { title: 'General',       href: '/settings/general',          icon: Settings    },
      { title: 'Appearance',    href: '/settings/appearance',       icon: Palette     },
      { title: 'Users',         href: '/settings/users',            icon: Users       },
      { title: 'Roles',         href: '/settings/roles',            icon: Shield      },
      { title: 'Permissions',   href: '/settings/permissions',      icon: Key         },
      { title: 'Finance Rules', href: '/settings/finance-defaults', icon: Calculator  },
      { title: 'Security',      href: '/settings/security',         icon: Lock        },
    ],
  },
]

interface SidebarContentProps {
  onNavigate?: () => void
}

export function SidebarContent({ onNavigate }: SidebarContentProps) {
  const pathname = usePathname()
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  const isItemActive = useCallback((href: string): boolean => {
    // Settings sub-pages use startsWith so /settings/general is active on that path
    if (href.startsWith('/settings/')) return pathname === href || pathname.startsWith(href + '/')
    return pathname === href
  }, [pathname])

  // Initialize expanded state and auto-expand group with active route
  useEffect(() => {
    const initialExpanded: Record<string, boolean> = {}

    menuGroups.forEach((group) => {
      // Check if this group contains the active route
      const hasActiveRoute = group.items.some((item) => isItemActive(item.href))

      // Expand if: default expanded OR contains active route
      initialExpanded[group.title] = group.defaultExpanded || hasActiveRoute
    })

    setExpandedGroups(initialExpanded)
  }, [pathname, isItemActive])

  function toggleGroup(groupTitle: string) {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupTitle]: !prev[groupTitle],
    }))
  }

  return (
    <div className="flex h-full w-full flex-col bg-card">
      <div className="flex h-16 items-center border-b px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <svg
              className="h-5 w-5 text-primary-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <span className="text-lg font-bold">SaaS Dashboard</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-4 overflow-y-auto scrollbar-hide">
        {menuGroups.map((group) => {
          const isExpanded = expandedGroups[group.title]
          const hasActiveRoute = group.items.some((item) => isItemActive(item.href))

          return (
            <div key={group.title} className="space-y-1">
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group.title)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  hasActiveRoute
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <span>{group.title}</span>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              {/* Group Items */}
              {isExpanded && (
                <div className="ml-2 space-y-1">
                  {group.items.map((item) => {
                    const isActive = isItemActive(item.href)
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.title}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

/** Legacy export — desktop-only sidebar wrapper (used nowhere now but kept for safety) */
export function Sidebar() {
  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r bg-card z-20">
      <SidebarContent />
    </aside>
  )
}
