import { useEffect } from 'react'

import { debugApi } from '@/lib/api'

/**
 * Forward uncaught browser errors and unhandled promise rejections to the
 * server log so they show up in the admin Debug Console instead of dying in
 * a user's DevTools. Each distinct message is sent once per page load.
 */
export function useReportClientErrors(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const sent = new Set<string>()
    const send = (kind: string, message: string, stack = ''): void => {
      if (!message || sent.has(message) || sent.size >= 20) return
      sent.add(message)
      debugApi
        .clientError({ kind, message: message.slice(0, 2000), stack: stack.slice(0, 16000), url: location.pathname })
        .catch(() => undefined) // reporting must never cause another error
    }
    const onError = (e: ErrorEvent): void => send('error', e.message, e.error instanceof Error ? (e.error.stack ?? '') : `${e.filename}:${e.lineno}:${e.colno}`)
    const onRejection = (e: PromiseRejectionEvent): void => {
      const r: unknown = e.reason
      send('unhandledrejection', r instanceof Error ? r.message : String(r), r instanceof Error ? (r.stack ?? '') : '')
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [enabled])
}
