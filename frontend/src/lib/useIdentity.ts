/**
 * useIdentity — the single source of truth for "who is signed in."
 *
 * Derived from `useAuth()` (the session `SessionUser`), NOT a separate
 * `/identity/me` query. `SessionUser` is a superset of the old `IdentityRead`
 * (it also carries the user's own `email`), so there is exactly one identity
 * and the historical "operator sees the shared-mailbox identity" bug is
 * structurally impossible.
 *
 * The returned `identity` keeps the `IdentityRead` shape so existing consumers
 * (AccountMenu avatar/name, SubmitterPicker default, Dashboard greeting) need
 * no change.
 */

import { useAuth } from '@/lib/authContext'
import type { IdentityRead } from '@/lib/api'

interface UseIdentityResult {
  identity: IdentityRead | undefined
  isLoading: boolean
  isLinked: boolean
  isAdmin: boolean
  isManager: boolean
}

export function useIdentity(): UseIdentityResult {
  const { user, status } = useAuth()

  const identity: IdentityRead | undefined = user
    ? {
        linked: user.employee_id != null,
        employee_id: user.employee_id,
        email: user.email,
        name_en: user.name_en,
        name_ar: user.name_ar,
        position: user.position,
        department: user.department,
        photo_url: user.photo_url,
        role: user.role,
        is_admin: user.is_admin,
        is_manager: user.is_manager,
      }
    : undefined

  return {
    identity,
    isLoading: status === 'loading',
    isLinked: identity?.linked ?? false,
    isAdmin: identity?.is_admin ?? false,
    isManager: identity?.is_manager ?? false,
  }
}
