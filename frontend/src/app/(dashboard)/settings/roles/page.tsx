export const dynamic = 'force-dynamic'

import { getRoles } from '@/app/(dashboard)/settings/actions'
import { RolesClient } from '@/components/settings/RolesClient'

export default async function RolesPage() {
  const result = await getRoles()
  return <RolesClient initialRoles={result.data ?? []} />
}
