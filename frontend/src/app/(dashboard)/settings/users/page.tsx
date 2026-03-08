export const dynamic = 'force-dynamic'

import { listUsers, getRoles } from '@/app/(dashboard)/settings/actions'
import { UsersClient } from '@/components/settings/UsersClient'

export default async function UsersPage() {
  const [usersResult, rolesResult] = await Promise.all([listUsers(), getRoles()])
  return (
    <UsersClient
      initialUsers={usersResult.data ?? []}
      initialError={usersResult.success ? undefined : usersResult.error}
      roles={rolesResult.data ?? []}
    />
  )
}
