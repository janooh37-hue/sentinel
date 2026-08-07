import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useRecordPrintMode(): () => void {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('print') === '1'
  const printed = useRef(false)

  useEffect(() => {
    if (!requested) printed.current = false
  }, [requested])

  return useCallback(() => {
    if (!requested || printed.current) return
    printed.current = true
    window.print()
    const next = new URLSearchParams(searchParams)
    next.delete('print')
    setSearchParams(next, { replace: true })
  }, [requested, searchParams, setSearchParams])
}
