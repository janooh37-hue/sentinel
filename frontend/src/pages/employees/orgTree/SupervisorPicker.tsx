import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { pickEmployeeName } from '@/lib/employeeName'
import { compareOrgPeople, isBelow, type OrgPerson } from '@/lib/orgTree'

interface SupervisorPickerProps {
  employee: OrgPerson
  candidates: readonly OrgPerson[]
  anchor: HTMLElement | null
  boundsEl: HTMLElement | null
  onPick: (supervisorId: string | null) => void
  onClose: () => void
}

export function SupervisorPicker({
  employee,
  candidates,
  anchor,
  boundsEl,
  onPick,
  onClose,
}: SupervisorPickerProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const popoverRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [placement, setPlacement] = useState<React.CSSProperties>({ visibility: 'hidden' })
  const host = document.fullscreenElement ?? document.body
  const currentSupervisor = candidates.find((candidate) => candidate.id === employee.supervisor_id)
  const lang = i18n.language
  const filteredCandidates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase(i18n.language)
    return candidates
      .filter((candidate) => candidate.id !== employee.id)
      .filter((candidate) => {
        if (!term) return true
        return [candidate.id, candidate.name_en, candidate.name_ar, candidate.position, candidate.position_ar, candidate.duty_post]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase(i18n.language).includes(term))
      })
      .toSorted(compareOrgPeople)
  }, [candidates, employee.id, i18n.language, query])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const closeOnClickAway = (event: PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', closeOnEscape, true)
    document.addEventListener('pointerdown', closeOnClickAway, true)
    return () => {
      document.removeEventListener('keydown', closeOnEscape, true)
      document.removeEventListener('pointerdown', closeOnClickAway, true)
    }
  }, [anchor, onClose])

  useEffect(() => {
    const popover = popoverRef.current
    if (!popover || !boundsEl) return
    const place = (): void => {
      const bounds = boundsEl.getBoundingClientRect()
      const fallbackAnchor = {
        left: bounds.left + 40,
        top: bounds.top + 40,
        right: bounds.left + 240,
        bottom: bounds.top + 100,
      }
      const anchorBounds = anchor?.getBoundingClientRect() ?? fallbackAnchor
      const gap = 12
      let treeBottom = bounds.top
      Array.from(boundsEl.querySelectorAll<HTMLElement>('.org-node-layer .org-item')).forEach((node) => {
        treeBottom = Math.max(treeBottom, node.getBoundingClientRect().bottom)
      })
      // Aim for the empty canvas under the tree, but never shrink below a
      // usable list: a 100px popover is a header with no options in it. When
      // the gap is shorter than this, keep full height and fall through to the
      // below/above/beside cases instead.
      const minUsableHeight = 210
      const gapUnderTree = bounds.bottom - 10 - (treeBottom + gap)
      popover.style.maxHeight = gapUnderTree >= minUsableHeight ? `${Math.floor(gapUnderTree)}px` : ''
      const popoverBounds = popover.getBoundingClientRect()
      const height = popoverBounds.height
      const width = popoverBounds.width
      let top: number
      if (treeBottom + gap + height <= bounds.bottom - 10) top = treeBottom + gap
      else if (anchorBounds.bottom + gap + height <= bounds.bottom - 10) top = anchorBounds.bottom + gap
      else if (anchorBounds.top - gap - height >= bounds.top + 10) top = anchorBounds.top - gap - height
      else top = Math.max(bounds.top + 10, Math.min(anchorBounds.top, bounds.bottom - height - 10))

      let left = anchorBounds.left
      if (left + width > bounds.right - 10) left = bounds.right - width - 10
      if (left < bounds.left + 10) left = bounds.left + 10
      setPlacement({ left: Math.round(left), top: Math.round(top) })
    }
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [anchor, boundsEl, filteredCandidates.length])

  return createPortal(
    <div
      ref={popoverRef}
      className="org-popover"
      role="dialog"
      aria-label={t('employees.orgTree.pickTitle')}
      style={placement}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <b>{t('employees.orgTree.pickTitle')}</b>
        <button type="button" className="org-popover-close" onClick={onClose} aria-label={t('employees.orgTree.cancel')}>
          ×
        </button>
        <small dir="auto">{t('employees.orgTree.pickSub', { name: pickEmployeeName(employee, lang) })}</small>
      </header>
      <div className="org-popover-current">
        <span>{t('employees.orgTree.pickCurrent')}</span>
        <b dir="auto">{currentSupervisor ? pickEmployeeName(currentSupervisor, lang) : t('employees.orgTree.pickNone')}</b>
      </div>
      <div className="org-popover-field">
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('employees.orgTree.pickPlaceholder')}
          aria-label={t('employees.orgTree.pickPlaceholder')}
        />
      </div>
      <div className="org-popover-list">
        <button type="button" className="org-picker-option org-picker-root" onClick={() => onPick(null)}>
          <span className="org-picker-avatar">⌾</span>
          <span className="org-picker-copy"><b>{t('employees.orgTree.pickNone')}</b></span>
        </button>
        {filteredCandidates.map((candidate) => {
          const invalid = isBelow(candidates, candidate.id, employee.id)
          return (
            <button
              key={candidate.id}
              type="button"
              title={`${pickEmployeeName(candidate, lang)} — ${candidate.id}`}
              className={`org-picker-option${invalid ? ' is-disabled' : ''}`}
              disabled={invalid}
              onClick={() => onPick(candidate.id)}
            >
              <span className="org-picker-avatar">{initials(candidate, lang)}</span>
              <span className="org-picker-copy">
                <b dir="auto">{pickEmployeeName(candidate, lang)}</b>
                <small dir="auto">{[lang === 'ar' && candidate.position_ar?.trim() ? candidate.position_ar : candidate.position, candidate.duty_post].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="org-picker-id">{candidate.id}</span>
            </button>
          )
        })}
      </div>
    </div>,
    host,
  )
}

function initials(person: OrgPerson, language: string): string {
  const words = (pickEmployeeName(person, language) || person.id).trim().split(/\s+/)
  return `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toUpperCase()
}
