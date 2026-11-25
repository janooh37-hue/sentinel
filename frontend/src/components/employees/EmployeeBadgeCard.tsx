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
import { Link } from 'react-router-dom'

import { BrandWordmark } from '@/components/shell/BrandWordmark'
import { buttonVariants } from '@/components/ui/button-variants'
import type { EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { StatusPill } from './StatusPill'

export interface EmployeeBadgeCardProps {
  employee: EmployeeListItem
  onClear: () => void
}

const ACTION_CLASS = 'h-auto min-h-[44px] whitespace-normal rounded-xl px-3 py-2 text-center leading-snug'
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
  onClear,
}: EmployeeBadgeCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const canEdit = useCapabilities().has('employees.edit')
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const [photoFailed, setPhotoFailed] = useState(false)
  const name = pickEmployeeName(employee, lang)
  const position = pickPosition(employee, lang)
  const showPhoto = employee.has_photo && !photoFailed
  const profileHref = `/employees/${encodeURIComponent(employee.id)}`

  return (
    <div className="mx-auto w-full min-w-0 max-w-[340px]">
      {/* Retractable badge reel — purely decorative */}
      <div aria-hidden data-testid="badge-reel" className="relative z-[2] hidden flex-col items-center lg:flex">
        <div
          className="relative grid h-[88px] w-[88px] place-items-center rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 28%,#ffffff 0%,#f4f4f2 55%,#e3e3df 100%)',
            boxShadow:
              '0 14px 30px -10px rgba(13,40,69,.35),0 2px 5px rgba(13,40,69,.14)',
          }}
        >
          <div
            className="absolute inset-[10px] rounded-full bg-[#fbfbfa]"
            style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,.13),inset 0 -1px 2px rgba(255,255,255,.9)' }}
          />
          {/* Centre hub: the reel is hardware, not a blank plate for a logo. */}
          <span
            className="relative h-[22px] w-[22px] rounded-full"
            style={{
              background: 'radial-gradient(circle at 35% 30%,#eef0f2,#b9bec7 68%,#99a0aa)',
              boxShadow: 'inset 0 0 0 3px #cdd1d7,0 1px 2px rgba(0,0,0,.18)',
            }}
          />
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
        className="relative overflow-hidden rounded-[20px] bg-white text-[#1a1d21] lg:-mt-5 lg:rotate-[1deg]"
        style={{
          boxShadow: '0 24px 60px -20px rgba(13,40,69,.35),0 2px 6px rgba(13,40,69,.08)',
        }}
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-2.5 z-[2] hidden h-3.5 w-16 -translate-x-1/2 rounded-full bg-[#f0eee8] lg:block"
          style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,.25)' }}
        />
        <div className="flex items-center gap-2 px-4 py-3 text-white lg:block lg:px-6 lg:pb-3.5 lg:pt-[46px] lg:text-center" style={{ background: BAND_GRADIENT }}>
          {/* The printed band is navy in both themes, so the on-dark wordmark. In Arabic the company's Arabic
              name is printed under it (so the mark itself is decorative there); in English the mark spells it. */}
          <BrandWordmark
            tone="on-dark"
            alt={lang === 'ar' ? '' : t('employees.activity.badge.company')}
            className="w-[112px] shrink-0 lg:mx-auto lg:w-[150px]"
          />
          {lang === 'ar' && (
            <p className="min-w-0 flex-1 text-end text-[11px] font-bold opacity-85 lg:mt-2.5 lg:text-center lg:text-[12px]">{t('employees.activity.badge.company')}</p>
          )}
          <p className="mt-2.5 hidden text-[10px] uppercase tracking-[.18em] opacity-55 rtl:tracking-normal lg:block">
            {t('employees.activity.badge.role')}
          </p>
          {/* On phones the photo sits next to the identity, below the masthead. */}
          <span
            className="absolute bottom-4 start-4 z-[1] grid size-16 place-items-center overflow-hidden rounded-2xl bg-[#e8edf3] text-[24px] font-extrabold text-[#0d2845] lg:relative lg:bottom-auto lg:start-auto lg:mx-auto lg:mt-4 lg:size-[120px] lg:text-[34px]"
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
        <div className="min-h-24 bg-white px-4 py-3 ps-24 text-start lg:-mt-[60px] lg:min-h-0 lg:px-6 lg:pb-[18px] lg:pt-[78px] lg:text-center">
          <p className="text-[17px] font-extrabold tracking-[-0.01em] text-[#0d2845] rtl:tracking-normal [overflow-wrap:anywhere] lg:text-[21px]"><bdi>{name}</bdi></p>
          {position && <p className="mt-1 text-[12.5px] text-[#5b6470]"><bdi>{position}</bdi></p>}
          <div aria-hidden className="mx-auto mt-3.5 hidden h-2.5 w-[70%] rounded-full opacity-80 lg:block" style={{ background: HOLO, backgroundSize: '300% 100%' }} />
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 lg:mt-3 lg:block">
            <div className="contents lg:flex lg:justify-center"><StatusPill status={employee.status} /></div>
            <div aria-hidden className="mx-auto mb-1.5 mt-[18px] hidden h-11 w-[78%] lg:block" style={{ background: BARCODE }} />
            <bdi className="inline-block font-mono text-[13px] font-semibold tracking-[.18em] text-[#1a1d21] lg:tracking-[.34em]">{employee.id}</bdi>
          </div>
        </div>
      </div>

      {/* Actions — theme-token surface, not part of the physical badge */}
      <div className="mt-3 grid grid-cols-2 gap-2 lg:mt-5 lg:gap-2.5">
        <Link to={profileHref} className={cn(buttonVariants(), ACTION_CLASS)}>
          {t('employees.activity.openProfile')}
        </Link>
        {canEdit && (
          <>
            <Link to={`${profileHref}/edit`} className={cn(buttonVariants({ variant: 'secondary' }), ACTION_CLASS)}>
              {t('common.edit')}
            </Link>
            <Link to={`${profileHref}?action=status`} className={cn(buttonVariants({ variant: 'secondary' }), ACTION_CLASS)}>
              {t('employees.statusDialog.title')}
            </Link>
          </>
        )}
        <button type="button" onClick={onClear} className={cn(buttonVariants({ variant: 'secondary' }), ACTION_CLASS)}>
          {t('employees.activity.clearEmployee')}
        </button>
      </div>
    </div>
  )
}
