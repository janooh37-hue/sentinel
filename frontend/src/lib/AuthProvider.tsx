/**
 * AuthProvider — resolves the signed-in user from the `gssg_session` cookie
 * via TanStack Query (`GET /auth/me`), and exposes login/logout/setUser that
 * mutate the cached session. Status is derived from the query, so there's no
 * manual effect-driven state.
 */

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, type SessionUser } from '@/lib/api'
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/lib/authContext'

const AUTH_KEY = ['auth-me'] as const

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient()

  const query = useQuery<SessionUser | null>({
    queryKey: AUTH_KEY,
    // A 401 means "not signed in" — resolve it to null so the query stays in a
    // success state and status derivation is a clean data-presence check.
    queryFn: async () => {
      try {
        return await api.authMe()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
  const refetchMe = query.refetch

  const status: AuthStatus = query.isPending ? 'loading' : query.data ? 'authed' : 'anon'
  const user = query.data ?? null

  const login = useCallback(
    async (email: string, password: string): Promise<SessionUser> => {
      const me = await api.login(email, password)
      queryClient.setQueryData(AUTH_KEY, me)
      // Refresh identity-aware queries (identity/me, settings, account) with
      // the new session cookie — but leave the auth query as just-set.
      await queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== 'auth-me',
      })
      return me
    },
    [queryClient],
  )

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.logout()
    } finally {
      // Flip to anon immediately (cookie is gone) and drop identity-aware
      // caches so they refetch clean on next sign-in.
      queryClient.setQueryData(AUTH_KEY, null)
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth-me' })
    }
  }, [queryClient])

  const refetch = useCallback(async (): Promise<void> => {
    await refetchMe()
  }, [refetchMe])

  const setUser = useCallback(
    (next: SessionUser): void => {
      queryClient.setQueryData(AUTH_KEY, next)
    },
    [queryClient],
  )

  const value: AuthContextValue = { user, status, login, logout, refetch, setUser }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
