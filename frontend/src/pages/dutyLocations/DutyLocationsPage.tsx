/**
 * DutyLocationsPage — roster of employees grouped by duty unit → post, with
 * single assign/edit and a multi-select internal-transfer workflow that
 * generates a General Book transfer letter.
 *
 * Reached from the Services gallery (🚚 tile) and gated on `documents.generate`
 * (the route + the server). Fetches `listEmployees({ limit: 500 })` once and
 * groups client-side via `lib/dutyUnits`.
 *
 * Responsive (≤720px): the unit rail collapses to a horizontal chip-strip and
 * the layout stacks to a single column (UnitRail handles its own flex/scroll;
 * the grid drops to one column below md).
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'

import { api, type EmployeeListItem } from '@/lib/api'
import {
  UNASSIGNED,
  SEED_UNITS,
  groupByUnit,
  postsForUnit,
} from '@/lib/dutyUnits'
import { Skeleton } from '@/components/ui/skeleton'
import { UnitRail, type UnitRailItem } from './UnitRail'
import { RosterTable } from './RosterTable'
import { AssignPopover } from './AssignPopover'
import { TransferDialog } from './TransferDialog'
import { SupervisorDesignations } from './SupervisorDesignations'
import { LeaveDigestPanel } from './LeaveDigestPanel'

export function DutyLocationsPage(): React.JSX.Element {
  const { t } = useTranslation()

  const employeesQuery = useQuery({
    queryKey: ['employees', { limit: 500 }],
    queryFn: () => api.listEmployees({ limit: 500 }),
  })

  const employees = useMemo<EmployeeListItem[]>(
    () => employeesQuery.data?.items ?? [],
    [employeesQuery.data],
  )

  const grouped = useMemo(() => groupByUnit(employees), [employees])

  // Selection (employee ids) — multi-select across posts within a unit.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const [assignTarget, setAssignTarget] = useState<EmployeeListItem | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)

  // Rail items: all 6 seed units ALWAYS shown (count 0 if none assigned yet —
  // they convey the org structure and are valid transfer destinations), then any
  // extra non-seed units present in the data, then the Unassigned bucket last
  // (only when non-empty).
  const railItems = useMemo<UnitRailItem[]>(() => {
    const countOf = (key: string): number => {
      const posts = grouped.get(key)
      return posts ? [...posts.values()].reduce((a, l) => a + l.length, 0) : 0
    }
    const items: UnitRailItem[] = SEED_UNITS.map((u) => ({
      key: u,
      label: u,
      count: countOf(u),
    }))
    for (const key of grouped.keys()) {
      if (key === UNASSIGNED || SEED_UNITS.includes(key)) continue
      items.push({ key, label: key, count: countOf(key) })
    }
    const un = countOf(UNASSIGNED)
    if (un > 0) {
      items.push({ key: UNASSIGNED, label: t('dutyLocations.unassigned'), count: un })
    }
    return items
  }, [grouped, t])

  // The active unit key: any rail key is selectable (incl. empty seed units).
  // Default to the first unit that actually has employees (rail is seed-first,
  // so that's the first populated seed, falling back to Unassigned on a fresh
  // roster), else the first rail item.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const resolvedActiveKey = useMemo(() => {
    const validKeys = new Set(railItems.map((r) => r.key))
    if (activeKey && validKeys.has(activeKey)) return activeKey
    const firstPopulated = railItems.find((r) => r.count > 0)?.key
    return firstPopulated ?? railItems[0]?.key ?? null
  }, [activeKey, railItems])

  const totalEmployees = employees.length
  const unassignedCount = grouped.get(UNASSIGNED)
    ? [...grouped.get(UNASSIGNED)!.values()].reduce((a, l) => a + l.length, 0)
    : 0
  const totalAssigned = totalEmployees - unassignedCount

  // Active unit roster, post-grouped + search-filtered.
  const activePosts = resolvedActiveKey ? grouped.get(resolvedActiveKey) : undefined
  const filteredByPost = useMemo(() => {
    const out = new Map<string, EmployeeListItem[]>()
    if (!activePosts) return out
    const q = search.trim().toLowerCase()
    for (const [post, list] of activePosts) {
      const rows = q
        ? list.filter(
            (e) =>
              e.id.toLowerCase().includes(q) ||
              e.name_en.toLowerCase().includes(q) ||
              (e.name_ar ?? '').toLowerCase().includes(q),
          )
        : list
      if (rows.length > 0) out.set(post, rows)
    }
    return out
  }, [activePosts, search])

  // The selected employees, resolved to full records (for the transfer dialog).
  const selectedEmployees = useMemo(
    () => employees.filter((e) => selected.has(e.id)),
    [employees, selected],
  )

  const activeLabel =
    resolvedActiveKey === UNASSIGNED
      ? t('dutyLocations.unassigned')
      : (resolvedActiveKey ?? '')
  const activeUnitCount = railItems.find((r) => r.key === resolvedActiveKey)?.count ?? 0
  const activePostCount = activePosts ? activePosts.size : 0

  function toggle(id: string, on: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function selectUnit(key: string): void {
    setActiveKey(key)
    setSelected(new Set()) // selection is scoped to a unit
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-24 pt-6 sm:px-6">
        {/* Header */}
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('dutyLocations.tile.category')}
          </div>
          <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('dutyLocations.page.title')}
          </h1>
          <p className="mt-1 text-[0.86em] text-muted-foreground">
            {t('dutyLocations.page.subtitle')}
          </p>
        </header>

        {employeesQuery.isError ? (
          <p className="py-12 text-center text-sm text-accent">
            {t('dutyLocations.page.loadError')}
          </p>
        ) : employeesQuery.isLoading ? (
          <Skeleton className="h-[520px] w-full rounded-2xl" />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div className="grid md:grid-cols-[268px_1fr]">
              <UnitRail
                units={railItems}
                activeKey={resolvedActiveKey ?? ''}
                totalAssigned={totalAssigned}
                totalEmployees={totalEmployees}
                unassignedCount={unassignedCount}
                onSelect={selectUnit}
              />

              <section className="flex min-h-[420px] flex-col">
                {/* Detail head */}
                <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
                  <div>
                    <div className="text-[1.05em] font-bold" dir="auto">
                      {activeLabel}
                    </div>
                    <div className="text-[0.78em] text-muted-foreground">
                      {t('dutyLocations.roster.summary', {
                        employees: activeUnitCount,
                        posts: activePostCount,
                      })}
                    </div>
                  </div>
                  <label className="relative ms-auto flex w-full items-center sm:w-[220px]">
                    <Search
                      className="pointer-events-none absolute start-3 h-4 w-4 text-muted-foreground"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('dutyLocations.roster.searchPlaceholder')}
                      aria-label={t('dutyLocations.roster.searchPlaceholder')}
                      className="h-9 w-full rounded-full border border-border bg-surface ps-9 pe-3 text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    />
                  </label>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <RosterTable
                    groupedByPost={filteredByPost}
                    selected={selected}
                    onToggle={toggle}
                    onAssign={setAssignTarget}
                  />
                </div>

                {/* Supervisor designation editor — only for real units, not Unassigned */}
                {resolvedActiveKey && resolvedActiveKey !== UNASSIGNED && (
                  <SupervisorDesignations
                    unit={resolvedActiveKey}
                    posts={postsForUnit(employees, resolvedActiveKey)}
                  />
                )}

                {/* Leave digest preview + send — only for real units, not Unassigned */}
                {resolvedActiveKey && resolvedActiveKey !== UNASSIGNED && (
                  <LeaveDigestPanel unit={resolvedActiveKey} />
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* Sticky selection bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-primary/40 bg-primary px-4 py-3 text-primary-foreground shadow-lg sm:px-6">
          <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-3">
            <span className="font-semibold">
              {t('dutyLocations.selection.count', { count: selected.size })}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1 rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t('dutyLocations.selection.clear')}
            </button>
            <div className="ms-auto" />
            <button
              type="button"
              onClick={() => setTransferOpen(true)}
              className="rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-primary hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              {t('dutyLocations.selection.transfer')}
            </button>
          </div>
        </div>
      )}

      {/* Assign / edit a single employee */}
      {assignTarget && (
        <AssignPopover
          open={assignTarget !== null}
          employee={assignTarget}
          allEmployees={employees}
          onOpenChange={(open) => {
            if (!open) setAssignTarget(null)
          }}
        />
      )}

      {/* Transfer the selection */}
      {transferOpen && selectedEmployees.length > 0 && (
        <TransferDialog
          open={transferOpen}
          employees={selectedEmployees}
          allEmployees={employees}
          onOpenChange={setTransferOpen}
          onTransferred={() => setSelected(new Set())}
        />
      )}
    </div>
  )
}
