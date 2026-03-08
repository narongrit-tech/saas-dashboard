'use client'

import { useState } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SidebarContent } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'

interface DashboardShellProps {
  children: React.ReactNode
  user?: {
    email?: string
    name?: string
  }
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar — fixed left column, hidden on mobile */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r bg-card z-20">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar — Sheet drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <SidebarContent onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content area */}
      <div className="lg:pl-64 flex flex-col flex-1 min-w-0 overflow-x-hidden">
        <Header
          title="Dashboard"
          user={user}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
