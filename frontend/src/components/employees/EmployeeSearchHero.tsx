/**
 * EmployeeSearchHero — State A navy search band for the employee lookup page.
 *
 * Renders the full-width hero band with debounced all-status roster search,
 * a results dropdown (avatar, name, G-number, position, status pill) and a
 * "new employee" ghost CTA.  `children` renders below the search column —
 * Task 6 info-cards slot in there.
 *
 * Layout critical: the band is `overflow:visible` with an inner `absolute
 * overflow:hidden` layer carrying the decorative circles, so the results
 * dropdown is never clipped.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'

// ─── tiny debounce hook (local) ──────────────────────────────────────────────
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  /** Called with the employee id when the user picks a search result. */
  onSelect: (id: string) => void
  /** Called when the user clicks the "new employee" CTA (either location). */
  onCreate: () => void
  /** Employee ids that are currently on approved leave — drives warning pill. */
  onLeaveIds: ReadonlySet<string>
  /** Optional content rendered below the search column (Task 6 info-cards). */
  children?: React.ReactNode
}

// ─── Component ────────────────────────────────────────────────────────────────
export function EmployeeSearchHero({
  onSelect,
  onCreate,
  onLeaveIds,
  children,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  const [q, setQ] = useState('')
  const debounced = useDebouncedValue(q, 250)

  // Fetch roster — enabled only when there is a non-empty debounced query.
  const { data, isPending } = useQuery({
    queryKey: ['employee-search', debounced],
    queryFn: () => api.listEmployees({ q: debounced, limit: 30 }),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  })

  const items = data?.items ?? []
  const showDropdown = debounced.trim().length > 0
  const showNoResults = !isPending && items.length === 0

  return (
    <section
      className="relative overflow-visible text-white"
      style={{ background: 'var(--hero-grad)' }}
    >
      {/* Decorative-circles layer: absolute + overflow:hidden so circles are
          clipped inside the band but the dropdown (in the sibling content
          layer below) is NOT affected. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-[110px] -end-[90px] h-[320px] w-[320px] rounded-full bg-white/[.045]" />
        <div className="absolute -bottom-[140px] start-[8%] h-[260px] w-[260px] rounded-full bg-white/[.035]" />
      </div>

      {/* ── Main content column ─────────────────────────────────────────── */}
      {/* z-[30]: must out-stack the sibling info-cards wrapper (z-[2]) or the
          results dropdown paints beneath the cards' backdrop-blur. */}
      <div className="relative z-[30] mx-auto max-w-[720px] px-8 pb-2 pt-[46px] text-center">
        {/* Eyebrow */}
        <div className="text-[11px] font-semibold uppercase tracking-[.22em] opacity-65">
          {t('employees.lookup.eyebrow')}
        </div>

        {/* Headline */}
        <h1 className="mb-1 mt-2 text-[27px] font-bold tracking-[-0.01em]">
          {t('employees.lookup.title')}
        </h1>

        {/* Subtitle */}
        <p className="text-[13.5px] opacity-75">{t('employees.lookup.subtitle')}</p>

        {/* ── Search wrap — position:relative anchors the dropdown ─── */}
        <div className="relative mt-[22px] text-start">
          {/* Pill searchbox */}
          <div className="flex h-14 items-center gap-3 rounded-full bg-white px-5 shadow-[0_18px_44px_-18px_rgba(0,0,0,.5)]">
            {/* Search icon */}
            <svg
              aria-hidden
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="shrink-0 text-faint"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.3-3.3" />
            </svg>

            {/* Input — type="search" gives implicit role="searchbox" */}
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('employees.lookup.placeholder')}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent font-[inherit] text-base text-foreground outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
            />

            {/* Submit button */}
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-full bg-accent px-5 py-2 text-[13px] font-bold text-white transition-colors hover:bg-accent-hover"
            >
              {t('employees.lookup.searchBtn')}
            </button>
          </div>

          {/* ── Results dropdown ─────────────────────────────────────── */}
          {showDropdown && (
            <div
              role="listbox"
              className="absolute start-0 end-0 top-[calc(100%+8px)] z-[30] overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-[0_24px_60px_-24px_rgba(13,40,69,.55)]"
            >
              {/* Header row */}
              {items.length > 0 && (
                <div className="flex justify-between border-b border-hairline px-[18px] pb-2 pt-[10px] text-[11px] font-semibold uppercase tracking-[.1em] text-faint">
                  <span>{t('employees.lookup.results')}</span>
                  <span>{t('employees.lookup.resultCount', { count: items.length })}</span>
                </div>
              )}

              {/* Result rows — capped height so long result sets scroll inside
                  the dropdown instead of stretching past the viewport. */}
              <div className="max-h-[min(55vh,480px)] overflow-y-auto">
              {items.length > 0
                ? items.map((row, idx) => {
                    // Status pill — mirrors EmployeeMobileCard logic
                    const onLeave = onLeaveIds.has(row.id)
                    let pillBg: string
                    let pillFg: string
                    let pillLabel: string
                    if (onLeave) {
                      pillBg = 'var(--warning-soft)'
                      pillFg = 'var(--warning)'
                      pillLabel = t('employees.statusPill.onLeave')
                    } else if (row.status === 'Active') {
                      pillBg = 'var(--success-soft)'
                      pillFg = 'var(--success)'
                      pillLabel = t('employees.status.Active')
                    } else {
                      pillBg = 'var(--surface-tinted)'
                      pillFg = 'var(--text-muted)'
                      pillLabel = t(`employees.status.${row.status}`)
                    }

                    // Avatar initials: first 2 chars after 'G-' / 'G'
                    const initials = row.id.replace(/^G-?/, '').slice(0, 2)
                    const pos = pickPosition(row, lang)

                    return (
                      <button
                        key={row.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => onSelect(row.id)}
                        className={`flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-[18px] py-[11px] text-start font-[inherit] transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${idx > 0 ? 'border-t border-hairline' : ''}`}
                      >
                        {/* Avatar */}
                        <span className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft">
                          {row.has_photo && (
                            <img
                              src={`/api/v1/employees/${encodeURIComponent(row.id)}/photo`}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                          )}
                          <span className="relative font-mono text-[12px] font-bold text-primary">
                            {initials}
                          </span>
                        </span>

                        {/* Name + meta */}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14.5px] font-semibold text-foreground">
                            {pickEmployeeName(row, lang)}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                            <span className="font-mono text-[11.5px]">{row.id}</span>
                            {pos && (
                              <>
                                <span aria-hidden className="text-faint">·</span>
                                <span className="truncate">{pos}</span>
                              </>
                            )}
                          </span>
                        </span>

                        {/* Status pill */}
                        <span
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-[10px] py-[3px] text-[11.5px] font-bold"
                          style={{ background: pillBg, color: pillFg }}
                        >
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: pillFg }}
                          />
                          {pillLabel}
                        </span>
                      </button>
                    )
                  })
                : /* No results */
                  showNoResults && (
                    <div className="px-[18px] py-[22px] text-center text-[13px] text-muted-foreground">
                      {t('employees.lookup.noResults')}
                      <br />
                      <button
                        type="button"
                        onClick={onCreate}
                        className="mt-[10px] inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-primary px-[18px] py-2 font-[inherit] text-[12.5px] font-bold text-white transition-colors hover:bg-primary-hover"
                      >
                        {t('employees.lookup.createNew')}
                      </button>
                    </div>
                  )}
              </div>

              {/* Footer */}
              {items.length > 0 && (
                <div className="flex justify-between border-t border-hairline bg-surface-raised px-[18px] py-[9px] text-[12px] text-faint">
                  <span>{t('employees.lookup.allStatusesShown')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── New-employee ghost button ────────────────────────────── */}
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-[9px] font-[inherit] text-[13px] font-semibold text-white transition-colors hover:bg-white/[.18]"
          >
            <span
              aria-hidden
              className="grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[13px] font-extrabold leading-none"
            >
              +
            </span>
            {t('employees.lookup.newEmployee')}
          </button>
        </div>
      </div>

      {/* ── Children slot (Task 6 info-cards) ─────────────────────────────── */}
      {children != null && (
        <div className="relative z-[2] mx-auto max-w-[1020px] px-8 pb-[46px]">
          {children}
        </div>
      )}
    </section>
  )
}
