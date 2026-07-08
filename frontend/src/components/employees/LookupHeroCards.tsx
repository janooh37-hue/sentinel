/**
 * LookupHeroCards — three glass info-cards rendered inside the navy
 * EmployeeSearchHero band (passes them as `children`):
 *
 *   1. آخر الملفات المفتوحة — Recently-opened employee chips (hidden when
 *      localStorage has no recents).
 *   2. وثائق تنتهي قريباً   — Soon-expiring documents: count badge + top-2
 *      rows sorted by days_remaining ascending; footer link → /expiry.
 *   3. ملفات ناقصة البيانات  — Data-gap summary: completeness badge +
 *      localized top-missing field labels; CTA calls onOpen(first_incomplete_id).
 *
 * Styling mirrors `.hcard` / `.rchip` from the employee-page prototype
 * (glass: bg-white/[.07] border-white/[.14] rounded-2xl).
 */
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { getRecentEmployees } from '@/lib/employeeRecents'
import { pickEmployeeName } from '@/lib/employeeName'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** First two characters of `name` — used for avatar initials. */
function twoChars(name: string): string {
  return name.slice(0, 2)
}

// ─── Shared glass card shell ──────────────────────────────────────────────────

function HCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-white/[.14] bg-white/[.07] p-4 backdrop-blur-sm">
      {children}
    </div>
  )
}

// ─── Card header row ──────────────────────────────────────────────────────────

function HCardHead({
  icon,
  title,
  badge,
  badgeTestId,
  warn = false,
}: {
  icon: React.ReactNode
  title: string
  badge?: number | null
  badgeTestId?: string
  warn?: boolean
}): React.JSX.Element {
  return (
    <div className="mb-[11px] flex items-center gap-[9px]">
      <span
        aria-hidden
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[.85rem] ${
          warn ? 'bg-amber-400/[.18] text-amber-400' : 'bg-white/[.12] text-white/85'
        }`}
      >
        {icon}
      </span>
      <h4 className="text-[12px] font-bold tracking-[.08em] opacity-[.85]">{title}</h4>
      {badge != null && badge > 0 && (
        <span
          data-testid={badgeTestId}
          className={`ms-auto rounded-full px-2 py-[1px] font-mono text-[11px] font-bold ${
            warn
              ? 'bg-amber-400/[.18] text-amber-400'
              : 'bg-white/[.12] opacity-[.9]'
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

// ─── Chip button (shared by recents + expiry rows) ───────────────────────────

function Chip({
  onClick,
  avatar,
  label,
  meta,
  metaWarn = false,
}: {
  onClick: () => void
  avatar: string
  label: string
  meta?: string
  metaWarn?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-xl border border-white/[.1] bg-white/[.06] px-2.5 py-1.5 text-start font-[inherit] text-white transition-colors hover:bg-white/[.14]"
    >
      <span
        aria-hidden
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-white/[.15] text-[10.5px] font-bold"
      >
        {avatar}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{label}</span>
      {meta != null && (
        <span
          className={`shrink-0 text-[10.5px] font-bold ${
            metaWarn ? 'text-amber-400' : 'font-mono opacity-60'
          }`}
        >
          {meta}
        </span>
      )}
    </button>
  )
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

const ClockIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
)

const WarningIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
)

const PersonIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
)

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user picks an employee (recent chip or gaps CTA). */
  onOpen: (id: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LookupHeroCards({ onOpen }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  // ── Recents (synchronous — localStorage) ─────────────────────────────────
  const recents = getRecentEmployees(3)

  // ── Expiring documents ────────────────────────────────────────────────────
  const expiryQuery = useQuery({
    queryKey: ['expiry', 90] as const,
    queryFn: () => api.getExpiry(90),
    staleTime: 60_000,
  })

  const allExpiry = expiryQuery.data ?? []
  const sortedExpiry = [...allExpiry].sort((a, b) => a.days_remaining - b.days_remaining)
  const topExpiry = sortedExpiry.slice(0, 2)
  const expiryCount = allExpiry.length

  // ── Completeness / data gaps ──────────────────────────────────────────────
  const completenessQuery = useQuery({
    queryKey: ['employees-completeness'] as const,
    queryFn: () => api.getEmployeesCompleteness(),
    staleTime: 60_000,
  })

  const completeness = completenessQuery.data ?? null
  const incompleteCount = completeness?.incomplete ?? 0
  const firstIncompleteId = completeness?.first_incomplete_id ?? null

  // Resolve field labels and join with a locale-appropriate separator
  const fieldLabels =
    completeness?.top_missing.map((m) => t(`employee.field.${m.field}`)) ?? []
  const separator = lang === 'ar' ? '، ' : ', '
  const joinedFields = fieldLabels.join(separator)

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-[26px] grid grid-cols-1 gap-3.5 text-start md:grid-cols-3">
      {/* ── Card 1: Recently-opened files ──────────────────────────────────
          Hidden entirely when localStorage has no recents. */}
      {recents.length > 0 && (
        <HCard>
          <HCardHead icon={ClockIcon} title={t('employees.lookup.recentTitle')} />
          <div className="flex flex-col gap-1.5">
            {recents.map((emp) => {
              const name = pickEmployeeName(emp, lang)
              return (
                <Chip
                  key={emp.id}
                  onClick={() => onOpen(emp.id)}
                  avatar={twoChars(name)}
                  label={name}
                  meta={emp.id}
                />
              )
            })}
          </div>
        </HCard>
      )}

      {/* ── Card 2: Soon-expiring documents ──────────────────────────────── */}
      <HCard>
        <HCardHead
          icon={WarningIcon}
          title={t('employees.lookup.expiryTitle')}
          badge={expiryCount}
          badgeTestId="expiry-count"
          warn
        />

        {topExpiry.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {topExpiry.map((item) => {
              const name = pickEmployeeName(
                { name_en: item.name_en, name_ar: item.name_ar },
                lang,
              )
              const docLabel = t(`expiry.docType.${item.doc_type}`)
              return (
                <Chip
                  key={`${item.employee_id}-${item.doc_type}`}
                  onClick={() => onOpen(item.employee_id)}
                  avatar={twoChars(name)}
                  label={`${name} — ${docLabel}`}
                  meta={t('employees.lookup.daysLeft', { count: item.days_remaining })}
                  metaWarn
                />
              )
            })}
          </div>
        ) : (
          !expiryQuery.isPending && (
            <p className="text-[12px] opacity-75">{t('employees.lookup.expiryNone')}</p>
          )
        )}

        <div className="mt-[10px]">
          <Link
            to="/expiry"
            className="text-[11.5px] font-semibold text-white/75 no-underline hover:text-white"
          >
            {t('employees.lookup.expiryViewAll')}
          </Link>
        </div>
      </HCard>

      {/* ── Card 3: Data-gap summary ──────────────────────────────────────── */}
      <HCard>
        <HCardHead
          icon={PersonIcon}
          title={t('employees.lookup.gapsTitle')}
          badge={incompleteCount > 0 ? incompleteCount : null}
          badgeTestId="gaps-count"
          warn
        />

        {completeness != null ? (
          incompleteCount > 0 && joinedFields.length > 0 ? (
            <p className="mb-[10px] text-[12px] leading-[1.6] opacity-75">
              {t('employees.lookup.gapsSummary', { fields: joinedFields })}
            </p>
          ) : (
            <p className="mb-[10px] text-[12px] opacity-75">
              {t('employees.lookup.gapsNone')}
            </p>
          )
        ) : null}

        {firstIncompleteId != null && (
          <div className="mt-[10px]">
            <button
              type="button"
              onClick={() => onOpen(firstIncompleteId)}
              className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] font-semibold text-white/75 hover:text-white"
            >
              {t('employees.lookup.gapsCta')}
            </button>
          </div>
        )}
      </HCard>
    </div>
  )
}
