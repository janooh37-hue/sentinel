/**
 * Scoped roles: built-in roles with a fixed capability ceiling and a
 * fail-closed route set (`inmate_reporter`, `fleet_reporter`). The session's
 * `scoped_role` is the only input; nothing here reads `role`.
 *
 * Checks about being a scoped role (no notifications, no derive, no Level
 * changes, no folders, the fixed shell) go through `scopedRoleOf`. Checks about
 * Inmate forms or the inmate shell's relabels compare its result with
 * `'inmate_reporter'` directly.
 */

import type { ScopedRoleName, SessionUser } from '@/lib/api'
import { serviceHref } from '@/lib/quickActions'

export function scopedRoleOf(user: Pick<SessionUser, 'scoped_role'> | null | undefined): ScopedRoleName | null {
  return user?.scoped_role ?? null
}

const INMATE_DESTINATIONS = ['/', '/services', '/books'] as const

/** The scoped role's top-level destinations, in nav order. */
export function scopedDestinations(role: ScopedRoleName, has: (cap: string) => boolean): readonly string[] {
  if (role === 'inmate_reporter') return INMATE_DESTINATIONS
  return has('vehicles.view') ? ['/', '/services', '/books', '/vehicles'] : ['/', '/services', '/books']
}

/** The service forms a fleet reporter may open: the Report from its Services tile,
 *  and the General Book only to revise one the vehicle pages filed (`?revise=`). */
export const FLEET_REPORTER_SERVICES = ['General Book', 'Report'] as const

/** Whether a scoped role may open `pathname`; everything else redirects to `/`. */
export function scopedRouteAllowed(
  role: ScopedRoleName,
  pathname: string,
  has: (cap: string) => boolean,
): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (scopedDestinations(role, has).includes(path) || /^\/books\/\d+$/.test(path)) return true
  if (role === 'inmate_reporter') {
    return path === serviceHref('inmate_conduct_violations') || path === '/application'
  }
  if (FLEET_REPORTER_SERVICES.some((service) => path === serviceHref(service))) return true
  return has('vehicles.view') && path.startsWith('/vehicles/')
}
