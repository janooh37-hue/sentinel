/**
 * Virtualised employee roster — TAMM-style row.
 *
 * Row grid: `48px 1fr 200px 110px 28px` — 42px avatar · name/G-id block ·
 * role/department · status pill · chevron. Clicking a row navigates to the
 * Employee Detail page (`/employees/:id`).
 *
 * Avatars are fetched from `GET /api/v1/employees/{id}/photo`; on error the
 * `<img>` is hidden and the gradient-initial fallback shows through. Logical
 * positioning (insetInlineStart, end-padded chevron) so the layout flips
 * cleanly in RTL.
 */

import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { cn } from '@/lib/utils'

import { Avatar3D } from './Avatar3D'

interface Props {
  rows: EmployeeListItem[]
  onLeaveIds?: ReadonlySet<string>
  onSelect: (id: string) => void
}

const ROW_HEIGHT = 64

/**
 * 42px circular avatar. Tries `/api/v1/employees/{id}/photo`; if the image
 * 404s (most employees), reveals an `Avatar3D` SVG underneath — a 3D-style
 * head whose hair/skin variant is hashed from the G-number so the same
 * employee renders consistently across surfaces.
 */
function EmployeeAvatar({ id, hasPhoto }: { id: string; hasPhoto: boolean }): React.JSX.Element {
  const [errored, setErrored] = useState(false)
  const showImg = hasPhoto && !errored
  return (
    <div
      aria-hidden
      className="relative flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-tinted"
    >
      {showImg && (
        <img
          src={`/api/v1/employees/${encodeURIComponent(id)}/photo`}
          alt=""
          loading="lazy"
          onError={() => setErrored(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {!showImg && <Avatar3D id={id} size={42} />}
    </div>
  )
}

interface StatusPillProps {
  tone: 'active' | 'onLeave' | 'hasCase' | 'inactive'
  label: string
}

function StatusDotPill({ tone, label }: StatusPillProps): React.JSX.Element {
  const palette = {
    active: { bg: 'var(--success-soft)', fg: 'var(--success)' },
    onLeave: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    hasCase: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
    inactive: { bg: 'var(--surface-tinted)', fg: 'var(--text-muted)' },
  }[tone]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.78em] font-semibold"
      style={{ background: palette.bg, color: palette.fg }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: palette.fg }}
      />
      {label}
    </span>
  )
}

export function EmployeeList({ rows, onLeaveIds, onSelect }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isRtl = i18n.language.startsWith('ar')
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center px-4 text-xs text-muted-foreground">
        {t('employees.list.empty')}
      </div>
    )
  }

  const Chevron = isRtl ? ChevronLeft : ChevronRight

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <ul
        role="listbox"
        aria-label={t('employees.title')}
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        className="m-0 list-none p-0"
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          if (!row) return null
          const displayName = pickEmployeeName(row, i18n.language)
          const positionLabel = pickPosition(row, i18n.language)
          const onLeave = onLeaveIds?.has(row.id) ?? false
          const isLast = vi.index === rows.length - 1

          let pillTone: StatusPillProps['tone']
          let pillLabel: string
          if (onLeave) {
            pillTone = 'onLeave'
            pillLabel = t('employees.statusPill.onLeave')
          } else if (row.status === 'Active') {
            pillTone = 'active'
            pillLabel = t('employees.status.Active')
          } else {
            pillTone = 'inactive'
            pillLabel = t(`employees.status.${row.status}`)
          }

          return (
            <li
              key={row.id}
              role="option"
              aria-selected={false}
              tabIndex={0}
              onClick={() => onSelect(row.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(row.id)
                }
              }}
              style={{
                position: 'absolute',
                top: 0,
                insetInlineStart: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vi.start}px)`,
                display: 'grid',
                gridTemplateColumns: '48px 1fr 200px 110px 28px',
                alignItems: 'center',
                columnGap: '16px',
              }}
              className={cn(
                'group cursor-pointer px-[18px] transition-colors',
                'hover:bg-[var(--surface-tinted)] focus-visible:bg-[var(--surface-tinted)] focus-visible:outline-none',
                !isLast && 'border-b border-hairline',
              )}
            >
              <EmployeeAvatar id={row.id} hasPhoto={row.has_photo ?? false} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight text-foreground">
                  {displayName}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{row.id}</span>
                  {row.department && (
                    <>
                      <span aria-hidden className="text-faint">·</span>
                      <span className="truncate">{row.department}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {positionLabel ?? <span className="text-muted-foreground">—</span>}
              </div>
              <div className="flex items-center">
                <StatusDotPill tone={pillTone} label={pillLabel} />
              </div>
              <Chevron
                aria-hidden
                className="h-4 w-4 text-faint transition-colors group-hover:text-muted-foreground"
                strokeWidth={2}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
