'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  CreditCard,
  BarChart3,
  Wallet,
  TrendingUp,
  Settings,
} from 'lucide-react'

const menuItems = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'Sales Orders',
    href: '/sales',
    icon: ShoppingCart,
  },
  {
    title: 'Expenses',
    href: '/expenses',
    icon: Receipt,
  },
  {
    title: 'Daily P&L',
    href: '/daily-pl',
    icon: BarChart3,
  },
  {
    title: 'Marketplace Wallets',
    href: '/cashflow',
    icon: Wallet,
  },
  {
    title: 'Ads',
    href: '/ads',
    icon: TrendingUp,
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
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col border-r bg-white">
      <div className="flex h-16 items-center border-b px-6">
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

      <nav className="flex-1 space-y-1 p-4">
        {menuItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              {item.title}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
