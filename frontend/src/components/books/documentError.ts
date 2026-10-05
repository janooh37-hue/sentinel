/**
 * Sibling of `DocumentState.tsx` (repo convention: component files stay
 * component-only for react-refresh).
 */
import { ApiError } from '@/lib/api'

/**
 * Maps a failed document fetch to a `DocumentState` kind: 401/403 means the
 * user may not see the file (`forbidden`, nothing to retry); anything else is a
 * retryable `error`. Accepts an HTTP status, an `ApiError`, or the viewer's own
 * `HTTP <status>` fetch error.
 */
export function documentErrorKind(error: unknown): 'error' | 'forbidden' {
  let status: number | undefined
  if (typeof error === 'number') status = error
  else if (error instanceof ApiError) status = error.status
  else if (error instanceof Error) {
    const match = /^HTTP (\d{3})\b/.exec(error.message)
    if (match) status = Number(match[1])
  }
  return status === 401 || status === 403 ? 'forbidden' : 'error'
}
