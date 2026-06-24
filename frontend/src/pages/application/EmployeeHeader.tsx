/**
 * EmployeeHeader — selected-employee strip inside the form card (TAMM §6.8).
 *
 * Default state: shows the picked employee inline — 28px avatar + name +
 * G-id · department + a small "Change" button.  Click Change → reveals
 * the EmployeePicker combobox.  Picking a new employee collapses back to
 * the inline strip.
 *
 * Replaces the old sticky top picker on the Application page so the form
 * area isn't dominated by an empty "Pick an employee…" input when nothing
 * is chosen.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Pencil, User } from 'lucide-react'

import { api } from '@/lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { pickEmployeeName } from '@/lib/employeeName'

import { EmployeePicker } from './EmployeePicker'

interface EmployeeHeaderProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function EmployeeHeader({ selectedId, onSelect }: EmployeeHeaderProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['employee', selectedId],
    queryFn: () => api.getEmployee(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  // When the parent clears the selection, drop back to the picker view.
  useEffect(() => {
    if (!selectedId) setEditing(true)
  }, [selectedId])

  const handleSelect = (id: string | null): void => {
    onSelect(id)
    if (id) setEditing(false)
  }

  const showPicker = editing || !selectedId
  const detail = detailQuery.data
  const name = detail ? pickEmployeeName(detail, i18n.language) : ''

  if (showPicker) {
    return (
      <div className="mb-5">
        <label className="mb-1.5 block text-[0.75em] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('application.employeeHeader.title', { defaultValue: 'Employee' })}{' '}
          <span className="text-accent">*</span>
        </label>
        <EmployeePicker selectedId={selectedId} onSelect={handleSelect} />
        {selectedId && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="mt-1 text-[0.75em] text-muted-foreground hover:text-foreground"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mb-5">
      <label className="mb-1.5 block text-[0.75em] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('application.employeeHeader.title', { defaultValue: 'Employee' })}{' '}
        <span className="text-accent">*</span>
      </label>
      <div className="flex items-center gap-3 rounded-lg border border-hairline px-3.5 py-2.5">
        <Avatar className="h-7 w-7 bg-primary/10 text-primary">
          {selectedId && detail?.has_photo && (
            <AvatarImage
              src={`/api/v1/employees/${encodeURIComponent(selectedId)}/photo`}
              alt=""
            />
          )}
          <AvatarFallback className="text-[0.7em] font-semibold">
            {detail ? initials(detail.name_en) : <User className="h-3.5 w-3.5" />}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.86em] font-semibold text-foreground">
            {name || '—'}
          </span>
          <span className="flex items-center gap-1.5 text-[0.75em] text-muted-foreground">
            <span className="font-mono">{selectedId}</span>
            {detail?.department && (
              <>
                <span className="text-faint">·</span>
                <span className="truncate">{detail.department}</span>
              </>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('application.employeeHeader.change', { defaultValue: 'Change' })}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-[0.75em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
          {t('application.employeeHeader.change', { defaultValue: 'Change' })}
        </button>
      </div>
    </div>
  )
}
