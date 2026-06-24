/**
 * CounterpartyPicker — hybrid combobox + free-text input.
 *
 * Fetches suggestions from listLedgerCounterparties(q) while the user
 * types. The user can also submit a brand-new counterparty value
 * (free text entry). Uses TanStack Query with placeholderData.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface CounterpartyPickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function CounterpartyPicker({
  value,
  onChange,
  placeholder,
  className,
}: CounterpartyPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState(value)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending blur-close timeout on unmount (avoid setState-after-unmount).
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  const suggestionsQuery = useQuery({
    queryKey: ['ledger-counterparties', inputValue],
    queryFn: () => api.listLedgerCounterparties(inputValue, 10),
    placeholderData: (prev) => prev,
    enabled: inputValue.length > 0,
  })

  const suggestions = suggestionsQuery.data ?? []
  // Filter out exact match if user has typed it exactly
  const filtered = suggestions.filter(
    (s) => s.toLowerCase() !== inputValue.toLowerCase() || suggestions.length > 1,
  )

  function commit(val: string): void {
    setInputValue(val)
    onChange(val)
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        placeholder={placeholder ?? t('ledger.form.counterparty')}
        autoComplete="off"
        onChange={(e) => {
          setInputValue(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so click on suggestion fires first
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(inputValue)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
          {filtered.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Prevent blur before click
                  e.preventDefault()
                  commit(s)
                }}
                className="flex w-full items-center px-3 py-2 text-sm text-foreground hover:bg-surface-tinted"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
