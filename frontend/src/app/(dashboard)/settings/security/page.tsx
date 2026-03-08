export const dynamic = 'force-dynamic'

import { getSettingsAuditLogs } from '@/app/(dashboard)/settings/actions'
import { SecurityClient } from '@/components/settings/SecurityClient'

export default async function SecurityPage() {
  const result = await getSettingsAuditLogs(50)
  return <SecurityClient initialLogs={result.data ?? []} />
}
