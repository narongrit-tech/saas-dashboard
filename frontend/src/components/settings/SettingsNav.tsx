'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Settings,
  Palette,
  Users,
  Shield,
  Key,
  Lock,
  Calculator,
  Download,
  Database,
  Bell,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  badge?: 'P2' | 'P3'
  disabled?: boolean
}

const navItems: NavItem[] = [
  { title: 'General',          href: '/settings/general',          icon: Settings },
  { title: 'Appearance',       href: '/settings/appearance',       icon: Palette },
  { title: 'Users',            href: '/settings/users',            icon: Users },
  { title: 'Roles',            href: '/settings/roles',            icon: Shield },
  { title: 'Permissions',      href: '/settings/permissions',      icon: Key },
  { title: 'Security & Audit', href: '/settings/security',         icon: Lock },
  { title: 'Finance Rules',    href: '/settings/finance-defaults', icon: Calculator,  badge: 'P2' },
  { title: 'Imports & Data',   href: '/settings/imports',          icon: Download,    badge: 'P2', disabled: true },
  { title: 'Master Data',      href: '/settings/master-data',      icon: Database,    badge: 'P2', disabled: true },
  { title: 'Notifications',    href: '/settings/notifications',    icon: Bell,        badge: 'P3', disabled: true },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="space-y-1">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Settings
      </p>
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        const Icon = item.icon

        if (item.disabled) {
          return (
            <div
              key={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium opacity-40 cursor-not-allowed select-none"
              title="ยังไม่รองรับในเวอร์ชันนี้"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.title}</span>
              {item.badge && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                  {item.badge}
                </Badge>
              )}
            </div>
          )
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{item.title}</span>
            {item.badge && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                {item.badge}
              </Badge>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
