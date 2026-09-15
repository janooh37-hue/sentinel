/**
 * PublicAuthRoute — unauthenticated entry for `/verify-email` and
 * `/reset-password` links mailed by the account-mail feature.
 *
 * Mounted by `Shell` *above* the session gate so these links work even while
 * a session is loading or already held (an admin who clicks their own old
 * verify link, say). Captures the `?token=` query param once, then strips it
 * from the address bar/history so it never lingers in browser history or a
 * screenshot, and hands it to `LoginPage` for the actual verify/reset screen.
 */

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { LoginPage } from './LoginPage'

export function PublicAuthRoute({ kind }: { kind: 'verify' | 'reset' }): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')

  useEffect(() => {
    navigate({ pathname: location.pathname, search: '' }, { replace: true })
    // Runs once on mount — the token is already captured into state above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <LoginPage entry={{ kind, token }} />
}
