/**
 * Fix reporting lines (`employees.edit`): search one employee, choose their new
 * supervisor, and see the department impact before saving. The drag chart
 * stays available as an optional view, but nothing here requires it.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api, type OrgNodeRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { departmentName, invalidateDepartmentData } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'
import type { OrgTreeFocus } from '@/pages/employees/orgTree/OrgTreeView'
import { OrgTreeWorkspace } from '@/pages/employees/orgTree/OrgTreeWorkspace'
import { SupervisorPicker } from '@/pages/employees/orgTree/SupervisorPicker'
import { buildOrgIndex, deriveMembership, membershipChanges } from './model'
import { personPosition } from './labels'
import { PersonSearch } from './PersonSearch'
import { LABEL, LINK_BUTTON, LiveEditsNotice, PANEL, QueryFailure, ViewHeading } from './ui'
import { useOrgData } from './useOrgData'

export function ReportingLines({ initialEmployeeId }: { initialEmployeeId?: string | null }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const [, setParams] = useSearchParams()
  const { canManage, tree, departments, exceptions, index, departmentsById, limitsOn } = useOrgData()
  // Opened from the unattached-units card: start on that person.
  const [selectedId, setSelectedId] = useState<string | null>(initialEmployeeId ?? null)
  // undefined: nothing proposed yet; null: no supervisor (top of a tree).
  const [proposed, setProposed] = useState<string | null | undefined>(undefined)
  const [chartOpen, setChartOpen] = useState(false)
  const [focus, setFocus] = useState<OrgTreeFocus | null>(null)
  const [picker, setPicker] = useState<HTMLElement | null>(null)
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    // Runs after the picker's own placement effect is scheduled, before it measures.
    if (picker) slot?.scrollIntoView({ block: 'nearest' })
  }, [picker, slot])
  const people = useMemo(() => tree.data ?? [], [tree.data])
  const selected = selectedId ? index.byId.get(selectedId) : undefined
  const nameOf = (id: string | null | undefined): string => {
    const person = id ? index.byId.get(id) : undefined
    return person ? pickEmployeeName(person, lang) : t('orgDepartments.reporting.noSupervisor')
  }
  const departmentLabel = (id: number | null | undefined): string => {
    const department = id == null ? undefined : departmentsById.get(id)
    return department ? departmentName(department, lang) : t('orgDepartments.outsideAll')
  }

  // Department impact needs the hand placements, which only department
  // managers can read; without them the preview would be guesswork.
  const impact = useMemo(() => {
    if (!selected || proposed === undefined || !canManage || !exceptions.isSuccess) return null
    const moved = people.map((person) => (person.id === selected.id ? { ...person, supervisor_id: proposed } : person))
    const before = deriveMembership(index, departments.data ?? [], exceptions.data)
    const after = deriveMembership(buildOrgIndex(moved), departments.data ?? [], exceptions.data)
    return { from: before.get(selected.id) ?? null, to: after.get(selected.id) ?? null, changed: membershipChanges(before, after, index.isWorking).length }
  }, [canManage, departments.data, exceptions.data, exceptions.isSuccess, index, people, proposed, selected])

  const save = useMutation({
    mutationFn: ({ employeeId, supervisorId }: { employeeId: string; supervisorId: string | null }) =>
      api.setOrgSupervisor(employeeId, { supervisor_id: supervisorId }),
    onSuccess: (_updated, variables) => {
      invalidateDepartmentData(qc)
      const previous = index.byId.get(variables.employeeId)?.supervisor_id ?? null
      const name = nameOf(variables.employeeId)
      setProposed(undefined)
      toast.success(
        variables.supervisorId
          ? t('employees.orgTree.changed', { name: bidi(name), sup: bidi(nameOf(variables.supervisorId)) })
          : t('employees.orgTree.changedRoot', { name: bidi(name) }),
        { action: { label: t('employees.orgTree.undo'), onClick: () => save.mutate({ employeeId: variables.employeeId, supervisorId: previous }) } },
      )
    },
    onError: (error, variables) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error(t('employees.orgTree.cycle', { name: bidi(nameOf(variables.supervisorId)), other: bidi(nameOf(variables.employeeId)) }))
      } else {
        toast.error(t('employees.orgTree.saveError'))
      }
    },
  })

  function choose(person: OrgNodeRead): void {
    setSelectedId(person.id)
    setProposed(undefined)
  }

  function openChart(): void {
    if (!chartOpen && selected?.duty_unit) {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('unit', selected.duty_unit!)
        return next
      }, { replace: true })
      setFocus({ id: selected.id, nonce: (focus?.nonce ?? 0) + 1 })
    }
    setChartOpen((value) => !value)
  }

  if (tree.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />
  if (tree.isError) return <QueryFailure error={tree.error} retry={() => void tree.refetch()} />

  return (
    <div className="space-y-5">
      <ViewHeading title={t('orgDepartments.reporting.title')}>{t('orgDepartments.reporting.intro')}</ViewHeading>
      <LiveEditsNotice show={limitsOn} />

      <div className={cn(PANEL, 'px-4 py-4')}>
        <PersonSearch
          people={people}
          label={t('orgDepartments.reporting.find')}
          onPick={choose}
          meta={(person) => t('orgDepartments.reporting.reportsTo', { name: bidi(nameOf(index.supervisorOf(person.id))) })}
        />
      </div>

      {selected && (
        <section aria-labelledby="reporting-selected" className={cn(PANEL, 'space-y-4 px-4 py-4')}>
          <div>
            <h3 id="reporting-selected" className="break-words text-[1.05em] font-semibold text-foreground"><bdi>{pickEmployeeName(selected, lang)}</bdi></h3>
            <p className="text-[0.8em] text-muted-foreground">
              <bdi dir="ltr" className="font-mono">{selected.id}</bdi>
              {personPosition(selected, lang) ? <> · <bdi>{personPosition(selected, lang)}</bdi></> : null}
            </p>
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-[0.88em] sm:grid-cols-3">
            <div>
              <dt className={LABEL}>{t('orgDepartments.reporting.currentSupervisor')}</dt>
              <dd className="mt-0.5 text-foreground"><bdi>{nameOf(index.supervisorOf(selected.id))}</bdi></dd>
            </div>
            <div>
              <dt className={LABEL}>{t('orgDepartments.reporting.department')}</dt>
              <dd className="mt-0.5 text-foreground"><bdi>{departmentLabel(selected.department_id)}</bdi></dd>
            </div>
            <div>
              <dt className={LABEL}>{t('orgDepartments.reporting.teamTitle')}</dt>
              <dd className="mt-0.5 text-foreground">{t('orgDepartments.team', { count: index.branchSize(selected.id) })}</dd>
            </div>
          </dl>

          <div>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={save.isPending}
              aria-expanded={picker !== null}
              onClick={(event) => setPicker(event.currentTarget)}
            >
              {t('orgDepartments.reporting.change')}
            </Button>
            {/* While choosing, this slot reserves room in the page and the
                picker opens inside it, so it never lands below the viewport. */}
            <div ref={setSlot} className={picker ? 'h-[380px]' : undefined} />
          </div>

          {proposed !== undefined && (
            <div role="region" aria-label={t('orgDepartments.reporting.previewTitle')} className="space-y-2 rounded-xl bg-surface-tinted/60 px-3.5 py-3 text-[0.88em] text-foreground">
              <p className={LABEL}>{t('orgDepartments.reporting.previewTitle')}</p>
              <p className="flex flex-wrap items-center gap-1.5">
                <span>{t('orgDepartments.reporting.currentSupervisor')}:</span>
                <bdi className="text-muted-foreground line-through decoration-muted-foreground/60">{nameOf(index.supervisorOf(selected.id))}</bdi>
                <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-label={t('orgDepartments.reporting.becomes')} />
                <bdi className="font-semibold">{nameOf(proposed)}</bdi>
              </p>
              {impact ? (
                <>
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span>{t('orgDepartments.reporting.department')}:</span>
                    {impact.from === impact.to ? (
                      <span>{t('orgDepartments.reporting.departmentSame', { name: bidi(departmentLabel(impact.to)) })}</span>
                    ) : (
                      <>
                        <bdi className="text-muted-foreground">{departmentLabel(impact.from)}</bdi>
                        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-label={t('orgDepartments.reporting.becomes')} />
                        <bdi className="font-semibold">{departmentLabel(impact.to)}</bdi>
                      </>
                    )}
                  </p>
                  {index.branchSize(selected.id) - (index.isWorking(selected.id) ? 1 : 0) > 0 && <p>{t('orgDepartments.reporting.teamMoves', { count: index.branchSize(selected.id) - (index.isWorking(selected.id) ? 1 : 0) })}</p>}
                  <p className="text-muted-foreground">{t('orgDepartments.reporting.changedDepartments', { count: impact.changed })}</p>
                </>
              ) : (
                <p className="text-muted-foreground">{t('orgDepartments.reporting.recalculated')}</p>
              )}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="outline" className="min-h-11" disabled={save.isPending} onClick={() => setProposed(undefined)}>{t('common.cancel')}</Button>
                <Button
                  className="min-h-11"
                  disabled={save.isPending}
                  aria-busy={save.isPending || undefined}
                  onClick={() => save.mutate({ employeeId: selected.id, supervisorId: proposed })}
                >
                  {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.reporting.save')}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="reporting-chart" className="space-y-3 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="max-w-[72ch]">
            <h3 id="reporting-chart" className="text-[0.98em] font-semibold text-foreground">{t('orgDepartments.reporting.chartTitle')}</h3>
            <p className="text-[0.84em] text-muted-foreground">{t('orgDepartments.reporting.chartHint')}</p>
          </div>
          <button type="button" className={LINK_BUTTON} aria-expanded={chartOpen} onClick={openChart}>
            <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', chartOpen && 'rotate-180')} aria-hidden />
            {t(chartOpen ? 'orgDepartments.reporting.hideChart' : 'orgDepartments.reporting.showChart')}
          </button>
        </div>
        {chartOpen && <OrgTreeWorkspace editable focus={focus} />}
      </section>

      {picker && selected && (
        <SupervisorPicker
          employee={selected}
          candidates={people}
          anchor={picker}
          boundsEl={slot}
          onClose={() => setPicker(null)}
          onPick={(supervisorId) => {
            setPicker(null)
            setProposed(supervisorId === (index.supervisorOf(selected.id) ?? null) ? undefined : supervisorId)
          }}
        />
      )}
    </div>
  )
}
