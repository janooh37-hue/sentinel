/**
 * EmployeeBadgeCard — the selected employee rendered as a physical GSSG ID
 * badge hanging from a white retractable badge reel (locked F3 design,
 * mockups/employee-activity-v3-family.html?v=3).
 *
 * The badge is a physical object: literal hex colors, identical in light and
 * dark themes. Only the action buttons below it use theme tokens.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { StatusPill } from './StatusPill'

export interface EmployeeBadgeCardProps {
  employee: EmployeeListItem
  onOpenProfile: (employeeId: string) => void
  onClear: () => void
}

const BAND_GRADIENT = 'linear-gradient(135deg,#0a1f3a 0%,#0d2845 50%,#1d3a5e 100%)'
const BARCODE =
  'repeating-linear-gradient(90deg,#0d1421 0 2px,transparent 2px 5px,#0d1421 5px 6px,transparent 6px 8px,#0d1421 8px 11px,transparent 11px 13px,#0d1421 13px 14px,transparent 14px 18px)'
const HOLO =
  'linear-gradient(100deg,#8fd3f4,#b8a9f5,#f5c98f,#93e9be,#8fd3f4)'
const RIBS = 'repeating-linear-gradient(180deg,#f8f8f6 0 3px,#d9d9d5 3px 5px)'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

export function EmployeeBadgeCard({
  employee,
  onOpenProfile,
  onClear,
}: EmployeeBadgeCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const [photoFailed, setPhotoFailed] = useState(false)
  const name = pickEmployeeName(employee, lang)
  const position = pickPosition(employee, lang)
  const showPhoto = employee.has_photo && !photoFailed

  return (
    <div>
      {/* Retractable badge reel — purely decorative */}
      <div aria-hidden data-testid="badge-reel" className="relative z-[2] flex flex-col items-center">
        <div
          className="relative grid h-[118px] w-[118px] place-items-center rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 28%,#ffffff 0%,#f4f4f2 55%,#e3e3df 100%)',
            boxShadow:
              '0 14px 30px -10px rgba(13,40,69,.35),0 2px 5px rgba(13,40,69,.14)',
          }}
        >
          <div
            className="absolute inset-[13px] rounded-full bg-[#fbfbfa]"
            style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,.13),inset 0 -1px 2px rgba(255,255,255,.9)' }}
          />
          <span className="relative grid h-20 w-20 place-items-center">
            <svg viewBox="0 0 80 80" fill="none" className="absolute inset-0">
              <circle
                cx="40" cy="40" r="34.3" stroke="#cf3238" strokeWidth="8.3"
                strokeDasharray="46.77 7.1" strokeDashoffset="50.32"
                transform="rotate(-90 40 40)"
              />
            </svg>
            <img src="/brand/gssg-globe.png" alt="" className="block h-[52px] w-[52px]" />
          </span>
        </div>
        <div className="-mt-[3px] h-[15px] w-7" style={{ background: RIBS, clipPath: 'polygon(12% 0,88% 0,72% 100%,28% 100%)' }} />
        <div className="-mt-px h-[13px] w-[17px] rounded-full bg-[#f3f3f1]" style={{ boxShadow: 'inset 0 -2px 3px rgba(0,0,0,.13)' }} />
        <div className="-mt-0.5 h-[25px] w-[25px] rounded-full border-[3.5px] border-[#c3c7cd]" style={{ boxShadow: 'inset 0 1px 1px rgba(255,255,255,.7),0 1px 2px rgba(0,0,0,.14)' }} />
        <div
          className="relative -mt-[5px] h-[62px] w-[31px] rounded-t-lg rounded-b-[11px] border-[1.5px] border-[rgba(150,158,170,.5)]"
          style={{
            background: 'linear-gradient(180deg,rgba(255,255,255,.55),rgba(244,246,248,.4))',
            boxShadow: '0 2px 6px rgba(13,40,69,.13)',
          }}
        >
          <span
            className="absolute bottom-[9px] left-1/2 h-[19px] w-[19px] -translate-x-1/2 rounded-full"
            style={{
              background: 'radial-gradient(circle at 35% 30%,#eef0f2,#b9bec7 68%,#99a0aa)',
              boxShadow: 'inset 0 0 0 3px #cdd1d7,inset 0 0 0 6px #a8aeb8,0 1px 2px rgba(0,0,0,.18)',
            }}
          />
        </div>
      </div>

      {/* The badge card */}
      <div
        className="relative -mt-5 overflow-hidden rounded-[20px] bg-white text-[#1a1d21]"
        style={{
          transform: 'rotate(1deg)',
          boxShadow: '0 24px 60px -20px rgba(13,40,69,.35),0 2px 6px rgba(13,40,69,.08)',
        }}
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-2.5 z-[2] h-3.5 w-16 -translate-x-1/2 rounded-full bg-[#f0eee8]"
          style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.25)' }}
        />
        <div className="px-6 pb-3.5 pt-[30px] text-center text-white" style={{ background: BAND_GRADIENT }}>
          <p className="text-[11px] font-extrabold uppercase tracking-[.3em] opacity-85">
            {t('employees.activity.badge.company')}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[.18em] opacity-55">
            {t('employees.activity.badge.role')}
          </p>
          <span
            className="relative z-[1] mx-auto mt-4 grid h-[120px] w-[120px] place-items-center overflow-hidden rounded-2xl bg-[#e8edf3] text-[34px] font-extrabold text-[#0d2845]"
            style={{ border: '4px solid rgba(255,255,255,.9)', boxShadow: '0 8px 20px rgba(4,15,30,.35)' }}
          >
            {showPhoto && (
              <img
                src={`/api/v1/employees/${encodeURIComponent(employee.id)}/photo`}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
                onError={() => setPhotoFailed(true)}
              />
            )}
            {!showPhoto && <span aria-hidden>{initials(name)}</span>}
          </span>
        </div>
        <div className="-mt-[60px] bg-white px-6 pb-[18px] pt-[78px] text-center">
          <p dir="auto" className="text-[21px] font-extrabold tracking-[-0.01em] text-[#0d2845]">{name}</p>
          {position && <p dir="auto" className="mt-1 text-[12.5px] text-[#5b6470]">{position}</p>}
          <div aria-hidden className="mx-auto mt-3.5 h-2.5 w-[70%] rounded-full opacity-80" style={{ background: HOLO, backgroundSize: '300% 100%' }} />
          <div className="mt-3 flex justify-center"><StatusPill status={employee.status} /></div>
          <div aria-hidden className="mx-auto mb-1.5 mt-[18px] h-11 w-[78%]" style={{ background: BARCODE }} />
          <p className="font-mono text-[13px] font-semibold tracking-[.34em] text-[#1a1d21]">{employee.id}</p>
        </div>
      </div>

      {/* Actions — theme-token surface, not part of the physical badge */}
      <div className="mt-5 flex gap-2.5">
        <button
          type="button"
          onClick={() => onOpenProfile(employee.id)}
          className="flex-1 rounded-xl bg-primary px-3 py-3 text-[13.5px] font-bold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('employees.activity.openProfile')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex-1 rounded-xl border border-border-strong bg-surface px-3 py-3 text-[13.5px] font-bold text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('employees.activity.clearEmployee')}
        </button>
      </div>
    </div>
  )
}
