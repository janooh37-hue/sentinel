/**
 * One proposed department before it exists: the two required names and a
 * derived preview of its parent, its people and where they come from. Shared by
 * the guided setup and the single "Add department" sheet.
 */

import { useId, useState } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DepartmentRead, OrgNodeRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { departmentName } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { nameSuggestions, type DraftNames } from './labels'
import type { DraftPreview, OrgIndex } from './model'
import { INPUT } from './ui'

export function DraftNameFields({ person, fields, errors, onSuggest, disabled }: {
  person: OrgNodeRead
  fields: Record<keyof DraftNames, UseFormRegisterReturn>
  errors: Partial<Record<keyof DraftNames, string | undefined>>
  onSuggest: (field: keyof DraftNames, value: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {(['name_en', 'name_ar'] as const).map((field) => {
        const suggestions = nameSuggestions(person, field)
        const error = errors[field]
        return (
          <div key={field} className="min-w-0">
            <label htmlFor={`${id}-${field}`} className="text-[0.84em] font-medium text-foreground">
              {t(field === 'name_en' ? 'orgDepartments.form.nameEn' : 'orgDepartments.form.nameAr')}
            </label>
            <input
              id={`${id}-${field}`}
              dir={field === 'name_ar' ? 'rtl' : 'ltr'}
              lang={field === 'name_ar' ? 'ar' : 'en'}
              className={INPUT}
              maxLength={128}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-${field}-error` : undefined}
              {...fields[field]}
            />
            {error && <p id={`${id}-${field}-error`} role="alert" className="mt-1 text-[0.8em] text-accent">{error}</p>}
            {suggestions.length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.78em] text-muted-foreground">
                <span>{t('orgDepartments.form.useLabel')}</span>
                {suggestions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSuggest(field, value)}
                    className="min-h-8 rounded-full border border-border bg-surface px-2.5 text-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <bdi dir={field === 'name_ar' ? 'rtl' : 'ltr'}>{value}</bdi>
                  </button>
                ))}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Parent, people and moves for one proposed head, computed with everything else selected. */
export function DraftPreviewSummary({ preview, index, departmentsById, draftName }: {
  preview: DraftPreview
  index: OrgIndex
  departmentsById: ReadonlyMap<number, DepartmentRead>
  /** Display name of another proposed department, by its head. */
  draftName: (headId: string) => string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [open, setOpen] = useState(false)
  const listId = useId()
  const parent = preview.parent.kind === 'department'
    ? departmentsById.get(preview.parent.id)
    : undefined
  const parentLabel = preview.parent.kind === 'none'
    ? t('orgDepartments.preview.topLevel')
    : preview.parent.kind === 'draft'
      ? t('orgDepartments.preview.partOfDraft', { name: bidi(draftName(preview.parent.headId)) })
      : t('orgDepartments.preview.partOf', { name: bidi(parent ? departmentName(parent, lang) : '') })
  const inSubDepartments = preview.branchSize - preview.memberIds.length
  const members = preview.memberIds
    .map((id) => index.byId.get(id))
    .filter((person): person is OrgNodeRead => !!person)

  return (
    <div className="space-y-1.5 text-[0.84em] text-foreground">
      <p>{parentLabel}</p>
      <p>
        <span className="font-semibold">{t('orgDepartments.preview.members', { count: preview.memberIds.length })}</span>
        {inSubDepartments > 0 && (
          <span className="text-muted-foreground"> · {t('orgDepartments.preview.inSubDepartments', { count: inSubDepartments })}</span>
        )}
      </p>
      {preview.movedFrom.length > 0 && (
        <p className="text-muted-foreground">
          {preview.movedFrom.map(({ from, count }) => {
            const source = from === null ? undefined : departmentsById.get(from)
            return from === null
              ? t('orgDepartments.preview.fromOutside', { count })
              : t('orgDepartments.preview.fromDepartment', { count, name: bidi(source ? departmentName(source, lang) : '') })
          }).join(' · ')}
        </p>
      )}
      {members.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex min-h-9 items-center gap-1 rounded-md text-[0.95em] font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />
            {t(open ? 'orgDepartments.preview.hidePeople' : 'orgDepartments.preview.showPeople')}
          </button>
          {open && (
            <ul id={listId} className="mt-1 max-h-56 columns-1 gap-6 overflow-y-auto rounded-lg bg-surface-tinted/60 px-3 py-2 sm:columns-2">
              {members.map((person) => (
                <li key={person.id} className="break-inside-avoid py-0.5">
                  <bdi>{pickEmployeeName(person, lang)}</bdi>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
