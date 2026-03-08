export const dynamic = 'force-dynamic'

import { getUserPreferences } from '@/app/(dashboard)/settings/actions'
import { AppearanceSettingsClient } from '@/components/settings/AppearanceSettingsClient'

export default async function AppearancePage() {
  const result = await getUserPreferences()
  return <AppearanceSettingsClient initialPreferences={result.data ?? null} />
}
