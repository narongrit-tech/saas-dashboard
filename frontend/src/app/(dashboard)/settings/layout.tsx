export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsNav } from '@/components/settings/SettingsNav'

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <SettingsNav />
      </aside>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
