import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Hash, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { EmployeeIdChangePanel } from '@/components/employees/EmployeeIdChangePanel'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import { Button } from '@/components/ui/button'
import { ApiError, api, apiErrorMessage } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import type { ExtractionResponse } from '@/lib/extraction'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ACTIVITY_STATEMENT_QUERY } from './statement/statementModel'

type EditLocationState = {
  injectedExtraction?: ExtractionResponse
  idChanged?: { from: string; to: string }
}

export function EmployeeEditPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  return id ? <EmployeeEditRecord key={id} id={id} /> : <NotFoundPage />
}

function EmployeeEditRecord({ id }: { id: string }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [injectedState] = useState(() => location.state as EditLocationState | null)
  const [idChanged, setIdChanged] = useState(injectedState?.idChanged)
  const [correctingNumber, setCorrectingNumber] = useState(false)
  const [profileChanged, setProfileChanged] = useState(false)
  // Bumping the key remounts the form at the stored values: an explicit discard.
  const [formGeneration, setFormGeneration] = useState(0)
  useEffect(() => {
    if (injectedState?.injectedExtraction || injectedState?.idChanged) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} })
    }
  }, [injectedState, location.pathname, location.search, navigate])
  const detail = useQuery({
    queryKey: ['employee-detail', id],
    queryFn: () => api.getEmployeeDetail(id),
  })
  const editMutation = useMutation({
    mutationFn: (values: EmployeeFormOutput) => {
      // The employee number is changed only by the separately authorized workflow.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...patch } = values
      return api.updateEmployee(id, patch)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', id] })
      void qc.invalidateQueries({ queryKey: [ACTIVITY_STATEMENT_QUERY] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('employees.toast.updated'))
      navigate(`/employees/${encodeURIComponent(id)}`)
    },
    onError: (error) => { toast.error(apiErrorMessage(error)) },
  })

  if (detail.isPending) return <div className="p-6 text-muted-foreground">{t('common.loading')}</div>
  if (detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />
  if (!detail.data) return <div role="alert" className="p-6 text-destructive-text">{apiErrorMessage(detail.error)}</div>
  const employee = detail.data.employee
  const name = pickEmployeeName(employee, i18n.language)
  const otherName = i18n.language.startsWith('ar') ? employee.name_en : employee.name_ar
  const formerIds = employee.former_ids ?? []
  const position = pickPosition(employee, i18n.language)
  const employeeHref = `/employees/${encodeURIComponent(employee.id)}`

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto bg-background">
      <header className="shrink-0 text-white" style={{ background: 'var(--hero-grad)' }}>
        <div className="mx-auto w-full max-w-[1240px] px-4 pb-7 pt-3 md:px-8">
          <Link to={employeeHref} className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-white/85 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t('employees.editPage.back')}
          </Link>
          <div className="mt-3 flex flex-wrap items-end gap-6">
            <div className="min-w-0 flex-1 basis-80">
              <h1 className="mb-2 text-sm font-semibold text-white/85">{t('employees.editPage.title')}</h1>
              <p className="break-words text-[clamp(1.8rem,3.5vw,3rem)] font-extrabold leading-tight tracking-tight"><bdi>{name}</bdi></p>
              {otherName && <p className="mt-2 text-lg text-white/85"><bdi>{otherName}</bdi></p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">{t(`employees.status.${employee.status}`)}</span>
                {position && <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold" dir="auto">{position}</span>}
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-5 rounded-2xl border border-white/20 bg-white/10 px-5 py-4 sm:ms-auto sm:w-auto">
              <div><p className="text-xs font-semibold text-white/85">{t('employees.idChange.employeeNumber')}</p><p dir="ltr" className="font-mono text-3xl font-bold tabular-nums">{employee.id}</p>{formerIds.length > 0 && <p className="mt-1 text-xs text-white/85">{t('employees.idChange.formerly', { ids: formerIds.join(i18n.language.startsWith('ar') ? '، ' : ', ') })}</p>}</div>
              {has('employees.change_id') && !correctingNumber && <Button type="button" className="min-h-11 bg-white text-primary hover:bg-white/90" onClick={() => setCorrectingNumber(true)}><Hash className="me-2 size-4" aria-hidden />{t('employees.idChange.correct')}</Button>}
            </div>
          </div>
          {has('employees.change_id') && correctingNumber && <EmployeeIdChangePanel employeeId={employee.id} onCancel={() => setCorrectingNumber(false)} unsavedProfileChanges={profileChanged} onDiscardProfileChanges={() => setFormGeneration((n) => n + 1)} />}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] px-4 py-6 md:px-8">
        {idChanged && <div role="status" className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-foreground"><p>{t('employees.idChange.done', idChanged)}</p><Button type="button" variant="ghost" className="size-11 shrink-0 p-0" aria-label={t('employees.idChange.dismiss')} onClick={() => setIdChanged(undefined)}><X className="size-4" aria-hidden /></Button></div>}
        {injectedState?.injectedExtraction && <p className="mb-4 text-sm text-muted-foreground">{t('employees.intake.reviewAndApply')}</p>}
        <EmployeeForm key={formGeneration} mode="edit" initial={employee} initialExtraction={injectedState?.injectedExtraction} onSubmit={async (values) => { await editMutation.mutateAsync(values) }} onCancel={() => navigate(employeeHref)} submitting={editMutation.isPending} onChangesChange={setProfileChanged} />
      </main>
    </div>
  )
}
