/**
 * Auth context + hook (non-component module, sibling to AuthProvider.tsx).
 *
 * Split out so the provider file stays component-only for react-refresh; this
 * matches the repo's `*-variants.ts` sibling convention.
 */

import { createContext, useContext } from 'react'

import type { SessionUser } from '@/lib/api'

export type AuthStatus = 'loading' | 'authed' | 'anon'

export interface AuthContextValue {
  user: SessionUser | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<SessionUser>
  logout: () => Promise<void>
  refetch: () => Promise<void>
  setUser: (user: SessionUser) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
