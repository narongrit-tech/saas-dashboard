export const dynamic = 'force-dynamic'

import { getRoles, getAllPermissions, getRolePermissions } from '@/app/(dashboard)/settings/actions'
import { PermissionsClient } from '@/components/settings/PermissionsClient'

export default async function PermissionsPage() {
  const [rolesResult, permsResult] = await Promise.all([getRoles(), getAllPermissions()])

  const roles = rolesResult.data ?? []
  const permissions = permsResult.data ?? []

  // Fetch permissions for all roles in parallel
  const rolePermissionsMap: Record<string, string[]> = {}
  if (roles.length > 0) {
    const results = await Promise.all(roles.map((r) => getRolePermissions(r.id)))
    roles.forEach((role, idx) => {
      rolePermissionsMap[role.id] = results[idx].data ?? []
    })
  }

  return (
    <PermissionsClient
      roles={roles}
      permissions={permissions}
      initialRolePermissions={rolePermissionsMap}
    />
  )
}
