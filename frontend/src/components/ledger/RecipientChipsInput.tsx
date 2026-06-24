/**
 * RecipientChipsInput — controlled `string[]` recipient input for the Ledger →
 * Outlook compose (Phase 6). Each address renders as a removable `.chipr` chip;
 * a free-typed valid email commits on Enter / `,` / `;` / blur; invalid input is
 * rejected with an inline error and kept for the user to fix.
 *
 * Typing (non-empty query) opens an autocomplete dropdown: the **Address book**
 * group (saved `contacts`, real addresses → chip on pick) renders FIRST, then
 * the **Employees** group. Employees carry NO email in the schema
 * (`EmployeeListItem` has only `contact`/phone), so an employee row is a
 * *reference* affordance, not an address: picking it calls `onPickEmployee`
 * (the parent routes it to the Ref row) and does NOT add a To/Cc chip. We never
 * synthesise a fake `g-number@…` address.
 *
 * The dropdown is a body-portaled `position: fixed` panel anchored to the field
 * — per the repo's floating-ui-portal pattern, a hand-rolled absolute popover
 * would clip inside the compose overlay's `overflow`/`transform` ancestors.
 * Focusing the field does NOT open the dropdown; only typing does.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import type { AddressBookContactRead, EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { rankContacts } from '@/lib/recipientMatch'

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COMMIT_KEYS = new Set(['Enter', ',', ';'])

export interface RecipientChipsInputProps {
  value: string[]
  onChange: (next: string[]) => void
  /** Saved address-book contacts — the address path for the autocomplete. */
  contacts: AddressBookContactRead[]
  /** Filtered employees for the current query (parent owns the debounce). */
  employeeQuery: (q: string) => EmployeeListItem[]
  /** Picking an employee row routes here (Ref row), never a To/Cc chip. */
  onPickEmployee: (emp: EmployeeListItem) => void
  label: string
  placeholder?: string
  id?: string
}

export function RecipientChipsInput({
  value,
  onChange,
  contacts,
  employeeQuery,
  onPickEmployee,
  label,
  placeholder,
  id,
}: RecipientChipsInputProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = draft.trim()

  // Typing → prefix-first ranked contacts, minus ones already added as chips.
  const matchedContacts =
    q.length === 0
      ? []
      : rankContacts(contacts, q).filter(
          (c) => !value.some((v) => v.toLowerCase() === c.address.toLowerCase()),
        )
  const matchedEmployees = q.length === 0 ? [] : employeeQuery(q)

  const hasResults = matchedContacts.length > 0 || matchedEmployees.length > 0

  function addAddress(addr: string): boolean {
    const trimmed = addr.trim()
    if (!EMAIL_LIKE.test(trimmed)) {
      setError(t('compose.invalidAddress', { address: trimmed }))
      return false
    }
    // De-dupe case-insensitively.
    if (value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('')
      setError(null)
      return true
    }
    onChange([...value, trimmed])
    setDraft('')
    setError(null)
    return true
  }

  function removeAt(idx: number): void {
    onChange(value.filter((_, i) => i !== idx))
  }

  function commitDraft(): void {
    if (draft.trim().length === 0) return
    if (addAddress(draft)) setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (COMMIT_KEYS.has(e.key)) {
      e.preventDefault()
      commitDraft()
      return
    }
    if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      removeAt(value.length - 1)
      return
    }
    if (e.key === 'Escape' && open) {
      // Swallow Escape when it dismisses the dropdown — letting it bubble would
      // ALSO close the (non-modal) compose window. An idle field lets Escape
      // bubble so the compose's scoped Escape-to-close still works.
      e.stopPropagation()
      setOpen(false)
    }
  }

  function pickContact(c: AddressBookContactRead): void {
    addAddress(c.address)
    setOpen(false)
    inputRef.current?.focus()
  }

  function pickEmployee(emp: EmployeeListItem): void {
    onPickEmployee(emp)
    setDraft('')
    setError(null)
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div
      ref={fieldRef}
      className="relative flex flex-1 flex-wrap items-center gap-1.5"
    >
      {value.map((addr, i) => (
        <span
          key={`${addr}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-tinted py-0.5 pe-1.5 ps-2.5 text-xs text-muted-foreground"
        >
          <span dir="ltr">{addr}</span>
          <button
            type="button"
            aria-label={`${t('common.remove')} ${addr}`}
            onClick={() => removeAt(i)}
            className="grid h-[16px] w-[16px] flex-none place-items-center rounded-full text-faint transition-colors hover:text-accent"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      <input
        ref={inputRef}
        id={id}
        dir="ltr"
        type="text"
        role="textbox"
        aria-label={label}
        autoComplete="off"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
          setOpen(e.target.value.trim().length > 0)
        }}
        // onFocus removed — suggestions open only while typing (non-empty query)
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Commit a valid free-typed address on blur; keep invalid for fixing.
          if (draft.trim().length > 0 && EMAIL_LIKE.test(draft.trim())) {
            addAddress(draft)
          }
        }}
        className="min-w-[90px] flex-1 border-0 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-faint"
      />

      {error && (
        <p className="w-full text-[11px] text-accent" role="alert">
          {error}
        </p>
      )}

      {open && hasResults && (
        <AutocompleteDropdown
          anchorRef={fieldRef}
          onClose={() => setOpen(false)}
          contacts={matchedContacts}
          employees={matchedEmployees}
          lang={i18n.language}
          onPickContact={pickContact}
          onPickEmployee={pickEmployee}
        />
      )}
    </div>
  )
}

/**
 * AutocompleteDropdown — body-portaled `position: fixed` panel anchored under
 * the field. Re-places on scroll/resize so it tracks the input; closes on an
 * outside click. Address-book group first, then Employees.
 */
function AutocompleteDropdown({
  anchorRef,
  onClose,
  contacts,
  employees,
  lang,
  onPickContact,
  onPickEmployee,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  contacts: AddressBookContactRead[]
  employees: EmployeeListItem[]
  lang: string
  onPickContact: (c: AddressBookContactRead) => void
  onPickEmployee: (e: EmployeeListItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const place = (): void => {
      const panel = panelRef.current
      const anchor = anchorRef.current
      if (!panel || !anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 8
      const width = Math.min(300, Math.max(220, rect.width))
      let left = rect.left
      left = Math.min(left, window.innerWidth - width - margin)
      left = Math.max(left, margin)
      panel.style.left = `${left}px`
      panel.style.top = `${rect.bottom + 4}px`
      panel.style.width = `${width}px`
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      className="fixed left-0 top-0 z-[70] max-h-[256px] overflow-y-auto rounded-md border border-border bg-surface shadow-[0_12px_34px_rgba(13,25,45,0.18)]"
    >
      {contacts.length > 0 && (
        <div role="group" aria-label={t('ledger.outlook.autocomplete.addressBook')}>
          <div className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-wider text-faint">
            {t('ledger.outlook.autocomplete.addressBook')}
          </div>
          {contacts.map((c) => (
            <button
              key={`c-${c.id}`}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPickContact(c)}
              className="flex w-full items-center justify-between gap-2.5 px-3 py-1.5 text-start text-xs transition-colors hover:bg-surface-tinted"
            >
              <span className="min-w-0 truncate" dir="auto">
                <b className="font-semibold text-foreground">
                  {c.display_name || c.address}
                </b>{' '}
                <span dir="ltr" className="font-mono text-[11px] text-faint">
                  {c.address}
                </span>
              </span>
              <span className="flex-none rounded-full bg-success-soft px-1.5 py-px text-[9px] font-bold text-success">
                {t('ledger.outlook.autocomplete.saved')}
              </span>
            </button>
          ))}
        </div>
      )}

      {employees.length > 0 && (
        <div role="group" aria-label={t('ledger.outlook.autocomplete.employees')}>
          <div className="px-3 pb-1 pt-2 text-[9.5px] font-semibold uppercase tracking-wider text-faint">
            {t('ledger.outlook.autocomplete.employees')}
          </div>
          {employees.map((emp) => (
            <button
              key={`e-${emp.id}`}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPickEmployee(emp)}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-start text-xs transition-colors hover:bg-surface-tinted"
            >
              <span className="min-w-0 truncate">
                <b className="font-semibold text-foreground">
                  {pickEmployeeName(emp, lang)}
                </b>{' '}
                <span className="font-mono text-[11px] text-faint">
                  · {emp.id}
                </span>
              </span>
              <span className="text-[10px] text-faint">
                {t('ledger.outlook.recipients.noEmail')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
