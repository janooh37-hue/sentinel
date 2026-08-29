/**
 * AuthProvider — resolves the signed-in user from the `gssg_session` cookie
 * via TanStack Query (`GET /auth/me`), and exposes login/logout/setUser that
 * mutate the cached session. Status is derived from the query, so there's no
 * manual effect-driven state.
 */

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, type SessionUser } from '@/lib/api'
import { AUTH_KEY, AuthContext, type AuthContextValue, type AuthStatus } from '@/lib/authContext'
import { markActivity } from '@/lib/useLockState'


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
      markActivity()
      // A fresh session must never inherit identity-bound data from the
      // previous account. New screens will fetch clean queries after AUTH_KEY
      // mounts the authenticated shell.
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== 'auth-me',
      })
      queryClient.setQueryData(AUTH_KEY, me)
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
