export const dynamic = 'force-dynamic'

import { getAppSettings } from '@/app/(dashboard)/settings/actions'
import { GeneralSettingsClient } from '@/components/settings/GeneralSettingsClient'

export default async function GeneralSettingsPage() {
  const result = await getAppSettings()
  return <GeneralSettingsClient initialSettings={result.data ?? null} />
}
