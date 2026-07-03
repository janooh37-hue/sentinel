/**
 * Hero banner for the Employee Detail page.
 *
 * Gradient background (`--hero-grad`) + 96px avatar + name/meta + 3 action
 * buttons. The photo `<img>` falls back to a 3D-style SVG head when the
 * employee has no uploaded photo.
 */

import { Camera, FileText, Pencil, Plane } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { EmployeeRead, EmployeeStatus } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useCapabilities } from '@/lib/useCapabilities'

import { useEmployeePhoto } from '@/components/employees/useEmployeePhoto'

/** First letters of the first two name parts — avatar fallback when no photo. */
function heroInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Maps status → Tailwind bg-* class for the inline status dot. */
const STATUS_DOT_CLS: Record<EmployeeStatus, string> = {
  Active: 'bg-success',
  Resigned: 'bg-warning',
  Terminated: 'bg-destructive',
}

interface Props {
  employee: EmployeeRead
  onEdit: () => void
  onAddLeave: () => void
  onGenerate: () => void
  onChangeStatus?: () => void
}

export function EmployeeHero({ employee, onEdit, onAddLeave, onGenerate, onChangeStatus }: Props): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const name = pickEmployeeName(employee, i18n.language)
  const positionLabel = pickPosition(employee, i18n.language)
  const { has } = useCapabilities()
  const canEdit = has('employees.edit')
  const { upload } = useEmployeePhoto(employee.id)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoSrc = `/api/v1/employees/${encodeURIComponent(employee.id)}/photo?v=${employee.photo_version ?? ''}`

  return (
    <div
      className="relative mb-5 overflow-hidden rounded-2xl p-5 text-white md:p-6"
      style={{ background: 'var(--hero-grad)' }}
    >
      {/* Decorative circle — hidden on mobile so it doesn't push content off-screen */}
      <div aria-hidden className="absolute -end-16 -top-16 h-[220px] w-[220px] rounded-full bg-white/5 max-md:hidden" />

      {/* Top row: avatar+name block + action buttons — flex siblings so the
          name never slides under the buttons at any viewport width.
          On mobile the buttons wrap below; on md+ they sit inline end-aligned. */}
      <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Avatar + name/meta */}
        <div className="grid min-w-0 grid-cols-[64px_1fr] items-center gap-4 md:grid-cols-[96px_1fr]">
          <div className="relative h-16 w-16 md:h-24 md:w-24">
            {employee.has_photo ? (
              <img
                src={photoSrc}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
                }}
                alt={name}
                className="h-full w-full rounded-full object-cover ring-[3px] ring-white/20"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-full w-full items-center justify-center rounded-full bg-white/15 text-[1.4em] font-bold ring-[3px] ring-white/20 md:text-[1.9em]"
              >
                {heroInitials(name)}
              </div>
            )}
            {canEdit && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) upload.mutate(f)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={upload.isPending}
                  aria-label={t('employees.photo.change')}
                  className="absolute -bottom-0.5 -end-0.5 grid h-7 w-7 place-items-center rounded-full bg-white text-foreground shadow ring-1 ring-black/10 transition hover:bg-white/90 disabled:opacity-60 motion-reduce:transition-none"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}
          </div>
          <div className="min-w-0">
            {employee.department && (
              <div className="truncate text-[0.78em] uppercase tracking-widest opacity-80 md:text-[0.82em]">
                {employee.department}
              </div>
            )}
            <div className="mb-1.5 mt-0.5 truncate text-[1.3em] font-bold tracking-tight md:text-[1.85em]">{name}</div>
            <div className="flex flex-wrap items-center gap-2 text-[0.82em] opacity-90 md:gap-3 md:text-[0.86em]">
              <span className="font-mono">{employee.id}</span>
              {positionLabel && (
                <>
                  <span>·</span>
                  <span className="truncate">{positionLabel}</span>
                </>
              )}
              <span>·</span>
              {canEdit && onChangeStatus ? (
                <button
                  type="button"
                  onClick={onChangeStatus}
                  aria-label={t('employees.statusDialog.title')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-0.5 text-[0.86em] font-semibold transition-colors hover:bg-white/25"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLS[employee.status] ?? 'bg-muted'}`} aria-hidden />
                  {t(`employees.status.${employee.status}`, employee.status)}
                  <Pencil className="h-3 w-3 opacity-70" aria-hidden />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-0.5 text-[0.86em] font-semibold">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLS[employee.status] ?? 'bg-muted'}`} aria-hidden />
                  {t(`employees.status.${employee.status}`, employee.status)}
                </span>
              )}
              {employee.doj && (
                <>
                  <span>·</span>
                  <span>{t('employee.joined', { date: employee.doj })}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons — full-width row on mobile; shrink-0 cluster on md+ */}
        <div className="flex shrink-0 flex-wrap gap-2 md:flex-nowrap">
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-4 py-2 text-[0.85em] font-medium backdrop-blur transition-colors hover:bg-white/25"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('actions.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={onAddLeave}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-4 py-2 text-[0.85em] font-medium backdrop-blur transition-colors hover:bg-white/25"
          >
            <Plane className="h-3.5 w-3.5" />
            {t('actions.addLeave')}
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent px-4 py-2 text-[0.85em] font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <FileText className="h-3.5 w-3.5" />
            {t('actions.generateDoc')}
          </button>
        </div>
      </div>
    </div>
  )
}
