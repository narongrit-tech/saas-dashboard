'use client'

/**
 * NotificationBell
 * Client component that polls for unread notifications and shows a dropdown list.
 * Clicking an item marks it as read and navigates to the COGS run detail page.
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationRead,
  type Notification,
} from '@/app/(dashboard)/inventory/cogs-run-actions'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'เมื่อกี้'
    if (mins < 60) return `${mins} นาทีที่แล้ว`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
    const days = Math.floor(hours / 24)
    return `${days} วันที่แล้ว`
  } catch {
    return ''
  }
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export function NotificationBell() {
  const router = useRouter()
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)

  // Poll unread count every 30 seconds
  const refreshCount = useCallback(async () => {
    const count = await getUnreadNotificationCount()
    setUnreadCount(count)
  }, [])

  useEffect(() => {
    refreshCount()
    const interval = setInterval(refreshCount, 30000)
    return () => clearInterval(interval)
  }, [refreshCount])

  // Load notification list when popover opens
  useEffect(() => {
    if (!open) return

    setLoadingItems(true)
    listNotifications(20)
      .then((items) => setNotifications(items))
      .catch(() => setNotifications([]))
      .finally(() => setLoadingItems(false))
  }, [open])

  async function handleItemClick(notification: Notification) {
    // Mark as read (fire and don't block)
    markNotificationRead(notification.id).then(() => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    })

    setOpen(false)

    // Navigate to entity detail page
    if (notification.entity_type === 'cogs_run') {
      router.push(`/inventory/cogs-runs/${notification.entity_id}`)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">การแจ้งเตือน</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} ใหม่
            </Badge>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[400px] overflow-y-auto divide-y">
          {loadingItems && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              กำลังโหลด...
            </div>
          )}

          {!loadingItems && notifications.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              ไม่มีการแจ้งเตือน
            </div>
          )}

          {!loadingItems &&
            notifications.map((notification) => (
              <button
                key={notification.id}
                className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3 ${
                  !notification.is_read ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                }`}
                onClick={() => handleItemClick(notification)}
              >
                {/* Unread indicator dot */}
                <div className="mt-1.5 shrink-0">
                  {!notification.is_read ? (
                    <span className="block h-2 w-2 rounded-full bg-blue-500" />
                  ) : (
                    <span className="block h-2 w-2 rounded-full bg-transparent" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">
                    {notification.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {notification.body}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatRelativeTime(notification.created_at)}
                  </p>
                </div>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
