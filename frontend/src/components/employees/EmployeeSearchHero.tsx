/**
 * The roster search stays visible above both the full lookup view and an
 * employee's activity. Keep the decorative clip separate from the results.
 */
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type EmployeeListItem, type ListEmployeesParams } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { activityEmployeeKey } from '@/components/employees/employeeActivityModel'
import { PendingDepartureBadge } from '@/components/employees/PendingDepartureBadge'
import { statusDetailText } from '@/components/employees/statusDetail'
import { isWorkingStatus } from '@/components/employees/schema'

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  /** Called with the employee id when the user picks a search result. */
  onSelect: (id: string) => void
  /** Called when the user clicks the "new employee" CTA (either location). */
  onCreate: () => void
  /** Employee ids that are currently on approved leave — drives warning pill. */
  onLeaveIds: ReadonlySet<string>
  /** Dashboard links keep the lookup within their selected roster scope. */
  filters?: ListEmployeesParams
  /** Keep only the search bar while the page shows a selected employee. */
  compact?: boolean
  /** Shows the clear button while the page holds a selection; called after the text clears. */
  onClear?: () => void
  /** Additional content under the search in the full lookup view. */
  children?: React.ReactNode
}

// ─── Component ────────────────────────────────────────────────────────────────
export function EmployeeSearchHero({
  onSelect,
  onCreate,
  onLeaveIds,
  filters = {},
  compact = false,
  onClear,
  children,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const resultsId = useId()
  const [q, setQ] = useState('')
  const term = q.trim()
  const debounced = useDebouncedValue(term, 250)
  const showDropdown = term.length > 0 && term === debounced
  const canClear = q.length > 0 || onClear !== undefined

  function clearSearch(): void {
    setQ('')
    onClear?.()
    inputRef.current?.focus({ preventScroll: true })
  }

  const { data, isError, isPending } = useQuery({
    queryKey: ['employee-search', debounced, filters],
    queryFn: () => api.listEmployees({ ...filters, q: debounced, limit: 30 }),
    enabled: showDropdown,
    staleTime: 30_000,
  })

  const items = data?.items ?? []

  function selectEmployee(employee: EmployeeListItem): void {
    // Search results already include the full roster projection the badge needs.
    queryClient.setQueryData(activityEmployeeKey(employee.id), employee)
    setQ('')
    onSelect(employee.id)
    inputRef.current?.focus({ preventScroll: true })
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!showDropdown) return
    if (items.length === 1) selectEmployee(items[0])
    else resultsRef.current?.querySelector<HTMLButtonElement>('button[role=option]')?.focus()
  }

  function handleSearchKey(event: React.KeyboardEvent<HTMLElement>): void {
    if (!showDropdown) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setQ('')
      inputRef.current?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.target === inputRef.current && event.key === 'ArrowDown') {
        const first = resultsRef.current?.querySelector<HTMLButtonElement>('button[role=option]')
        if (!first) return
        event.preventDefault()
        first.focus()
      } else if (event.target instanceof HTMLButtonElement && event.target.getAttribute('role') === 'option') {
        event.preventDefault()
        const adjacent = event.key === 'ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling
        if (adjacent instanceof HTMLButtonElement) adjacent.focus()
        else if (event.key === 'ArrowUp') inputRef.current?.focus()
      }
    }
  }

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
      <div className={`relative z-[30] mx-auto max-w-[720px] px-4 text-center sm:px-8 ${compact ? 'py-3' : 'pb-2 pt-[46px]'}`}>
        {!compact && (
          <div className="text-[11px] font-semibold uppercase tracking-[.22em] opacity-65 rtl:tracking-normal">
            {t('employees.lookup.eyebrow')}
          </div>
        )}
        <h1 className={compact ? 'sr-only' : 'mb-1 mt-2 text-[27px] font-bold tracking-[-0.01em] rtl:tracking-normal'}>
          {t('employees.lookup.title')}
        </h1>
        {!compact && <p className="text-[13.5px] opacity-75">{t('employees.lookup.subtitle')}</p>}

        {/* Positioning anchors the results below the search pill. */}
        <form
          role="search"
          onSubmit={submitSearch}
          onKeyDown={handleSearchKey}
          className={`relative text-start ${compact ? '' : 'mt-[22px]'}`}
        >
          <div className="flex h-14 items-center gap-2 rounded-full bg-surface ps-4 pe-2 shadow-[0_18px_44px_-18px_rgba(0,0,0,.5)] transition-shadow focus-within:ring-2 focus-within:ring-white/70 focus-within:ring-offset-2 focus-within:ring-offset-primary sm:gap-3 sm:ps-5">
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
              ref={inputRef}
              data-employee-hero-search-input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('employees.lookup.placeholder')}
              aria-label={t('employees.lookup.placeholder')}
              aria-controls={showDropdown ? resultsId : undefined}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent font-[inherit] text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />

            {canClear && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label={t('employees.lookup.clearSearch')}
                title={t('employees.lookup.clearSearch')}
                className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}

            {/* Submit button */}
            <button
              type="submit"
              className="min-h-[44px] shrink-0 cursor-pointer rounded-full bg-accent px-3 text-[13px] font-bold text-white transition-colors hover:bg-accent-hover sm:px-5"
            >
              {t('employees.lookup.searchBtn')}
            </button>
          </div>

          {/* ── Results dropdown ─────────────────────────────────────── */}
          {showDropdown && (
            <div
              id={resultsId}
              ref={resultsRef}
              role="listbox"
              aria-label={t('employees.lookup.results')}
              className="absolute start-0 end-0 top-[calc(100%+8px)] z-[30] overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-[0_24px_60px_-24px_rgba(13,40,69,.55)]"
            >
              {/* Header row */}
              {items.length > 0 && (
                <div className="flex justify-between border-b border-hairline px-[18px] pb-2 pt-[10px] text-[11px] font-semibold uppercase tracking-[.1em] text-faint rtl:tracking-normal">
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
                    } else if (isWorkingStatus(row.status)) {
                      pillBg = 'var(--success-soft)'
                      pillFg = 'var(--success)'
                      pillLabel = t(`employees.status.${row.status}`)
                    } else if (row.status === 'Transferred') {
                      pillBg = 'var(--info-soft)'
                      pillFg = 'var(--info)'
                      pillLabel = statusDetailText(t, row)
                    } else {
                      pillBg = 'var(--surface-tinted)'
                      pillFg = 'var(--text-muted)'
                      pillLabel = statusDetailText(t, row)
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
                        onClick={() => selectEmployee(row)}
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
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                            <span className="font-mono text-[11.5px]">{row.id}</span>
                            {row.former_ids?.map((id) => <span key={id}>{t('employees.idChangeActivity.formerly', { id })}</span>)}
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
                          className="inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-full px-[10px] py-[3px] text-[11.5px] font-bold"
                          style={{ background: pillBg, color: pillFg }}
                        >
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: pillFg }}
                          />
                          <span className="truncate" title={pillLabel}>{pillLabel}</span>
                        </span>
                        <PendingDepartureBadge
                          status={row.status}
                          pendingStatus={row.pending_status}
                          endDate={row.end_date}
                          transferSite={row.transfer_site}
                        />
                      </button>
                    )
                  })
                : isPending ? <p role="status" className="px-[18px] py-3 text-sm text-muted-foreground">{t('common.loading')}</p>
                : isError ? <p role="alert" className="px-[18px] py-3 text-sm text-destructive-text">{t('common.loadError')}</p>
                : (
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
                  <span>{Object.values(filters).some(Boolean) ? t('dashboard.widgets.workspace.filteredSearch') : t('employees.lookup.allStatusesShown')}</span>
                </div>
              )}
            </div>
          )}
        </form>

        {!compact && (
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
        )}
      </div>

      {!compact && children != null && (
        <div className="relative z-[2] mx-auto max-w-[1020px] px-8 pb-[46px]">
          {children}
        </div>
      )}
    </section>
  )
}
