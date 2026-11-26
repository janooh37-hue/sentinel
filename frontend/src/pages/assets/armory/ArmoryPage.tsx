import { Plus, Settings2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArmoryItemDetailRead, ArmorySafeRead } from '@/lib/api'
import { ArmoryShell } from './ArmoryShell'
import { FindArmoryDialog } from './FindArmoryDialog'
import { useArmoryLocale } from './armoryFormat'
import { armoryErrorMessage, isArmoryAccessError, useArmoryCacheLifecycle, useArmorySafes } from './armoryQueries'
import { ARMORY_DETAIL_KEYS, patchArmoryParams, readArmoryId, readArmoryTab } from './armoryUrl'
import { ArmoryAssignmentDialog } from './dialogs/ArmoryAssignmentDialog'
import { ArmoryReturnDialog } from './dialogs/ArmoryReturnDialog'
import { ArmorySafeDialog } from './dialogs/ArmorySafeDialog'
import { ArmoryShiftSettingsDialog } from './dialogs/ArmoryShiftSettingsDialog'
import { AddItemDialog } from './items/AddItemDialog'
import { ItemsPane } from './items/ItemsPane'
import { ReceiveStockDialog } from './items/ReceiveStockDialog'
import type { ReceivePreset, ReceiveResume } from './items/intakeTypes'
import { BulkReturnDialog } from './shift/BulkReturnDialog'
import { ShiftCheckDialog } from './shift/ShiftCheckDialog'
import { ShiftPane } from './shift/ShiftPane'
import { useArmoryFindShortcut } from './useArmoryFindShortcut'

// Records panes load on demand so the active desk is usable without their chunks.
const CustodyPane = lazy(() => import('./records/CustodyPane').then(module => ({ default: module.CustodyPane })))
const GuardsPane = lazy(() => import('./records/GuardsPane').then(module => ({ default: module.GuardsPane })))
const AuditPane = lazy(() => import('./records/AuditPane').then(module => ({ default: module.AuditPane })))

const SAFE_STORAGE_KEY = 'armory.safe'
const EMPTY_SAFES: ArmorySafeRead[] = []
const EMPTY_PRESET: ReceivePreset = {}

type AssignmentKind = 'shift' | 'custody'

type Qualification = {
  employeeId: string
  original: { search: string; hash: string; state: unknown }
  guardsSearch: string
  returning: boolean
}

type Task =
  | { kind: 'assignment'; mode: AssignmentKind; safeId: number | null; opener: HTMLElement; qualification: Qualification | null; resumeSignal: number }
  | { kind: 'return'; mode: AssignmentKind; assignmentId: number; opener: HTMLElement | null; tracksIssue: boolean }
  | { kind: 'bulk'; safeId: number; opener: HTMLElement }
  | { kind: 'check' }
  | { kind: 'receive'; preset: ReceivePreset; defaultSafeId: number | null; opener: HTMLElement | null; adding: number[] | null; resume: ReceiveResume | null }
  | { kind: 'addItem' | 'safe' | 'settings' | 'find'; opener: HTMLElement | null }

type CheckDraft = { safeId: number; paused: boolean; opener: HTMLElement }

function returnFocus(opener: HTMLElement | null): RefObject<HTMLElement | null> {
  return {
    get current() {
      // The dialog resolves focus at close, after an originating pane may have unmounted.
      return opener?.isConnected ? opener : document.getElementById('armory-title')
    },
  }
}
const headingFocus = returnFocus(null)

function storedSafe(): string | null {
  try { return sessionStorage.getItem(SAFE_STORAGE_KEY) }
  catch { return null }
}

function ArmoryLoading(): React.JSX.Element {
  const { t } = useArmoryLocale()
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>
      <div aria-hidden className="space-y-2">
        <Skeleton className="h-4 w-40 max-w-full motion-reduce:animate-none" />
        <Skeleton className="h-3 w-64 max-w-full motion-reduce:animate-none" />
      </div>
    </div>
  )
}

export function ArmoryPage(): React.JSX.Element | null {
  const { t } = useArmoryLocale()
  const { principal, canView, canEdit, isLoading } = useArmoryCacheLifecycle()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const safesQuery = useArmorySafes()
  const safesDenied = isArmoryAccessError(safesQuery.error)
  const safes = safesQuery.isSuccess ? safesQuery.data : EMPTY_SAFES
  const canBrowse = safes.length > 0
  const scope = params.get('safe')
  const wantedSafe = scope ?? storedSafe()
  const safeId = safes.find(safe => String(safe.id) === wantedSafe)?.id ?? null
  const tab = readArmoryTab(params)
  const editable = canEdit && !isLoading && principal !== null && !safesDenied
  const requestedReturn = tab === 'shift' && params.get('return') === '1' ? readArmoryId(params, 'issue') : null

  const [task, setTask] = useState<Task | null>(null)
  const [check, setCheck] = useState<CheckDraft | null>(null)
  const [statusKey, setStatus] = useState<string | null>(null)
  const [accessChange, setAccessChange] = useState(0)
  const [dismissedReturn, setDismissedReturn] = useState<{ key: string; stripIssue: boolean } | null>(null)
  const [observed, setObserved] = useState({ principal, editable, tab, safeId, key: location.key })
  const findButtonRef = useRef<HTMLButtonElement>(null)
  const scopeRef = useRef<HTMLSelectElement>(null)

  // Reconcile before rendering children so a previous principal or scope never
  // gets another render of its draft. The two qualification URLs are intentional.
  if (observed.principal !== principal || observed.editable !== editable || observed.key !== location.key || observed.safeId !== safeId) {
    setObserved({ principal, editable, tab, safeId, key: location.key })
    if (observed.principal !== principal || (observed.editable && !editable)) {
      setTask(null)
      setCheck(null)
      setDismissedReturn({ key: location.key, stripIssue: true })
      setStatus('accessChanged')
      setAccessChange(count => count + 1)
    } else if (task?.kind === 'assignment' && task.qualification && observed.key !== location.key) {
      const { qualification } = task
      if (qualification.returning && location.search === qualification.original.search && location.hash === qualification.original.hash) {
        setTask({ ...task, qualification: null, resumeSignal: task.resumeSignal + 1 })
      } else if (qualification.returning || location.search !== qualification.guardsSearch || location.hash) {
        setTask(null)
      }
    } else if (observed.tab !== tab || observed.safeId !== safeId) {
      const sameCheck = tab === 'shift' && check !== null && check.safeId === safeId
      if (!sameCheck) setCheck(null)
      if (!(sameCheck && task?.kind === 'check')) setTask(null)
    } else if (observed.key !== location.key && task && task.kind !== 'check' &&
      !(task.kind === 'return' && task.tracksIssue && requestedReturn === task.assignmentId)) {
      setTask(null)
    }
  }

  useEffect(() => {
    if (!safesQuery.isSuccess || scope === null || (scope !== 'all' && safeId === null)) return
    try { sessionStorage.setItem(SAFE_STORAGE_KEY, scope) }
    catch { /* A blocked storage policy must not prevent scoped navigation. */ }
  }, [safeId, safesQuery.isSuccess, scope])

  const returnDismissed = dismissedReturn?.key === location.key
  const shouldStripIssue = returnDismissed && dismissedReturn?.stripIssue && tab === 'shift' && params.has('issue')
  const shouldStripReturn = params.has('return') && !isLoading && (!editable || requestedReturn === null || returnDismissed || (safesQuery.isSuccess && !canBrowse))
  useEffect(() => {
    // Do not reopen the read-only sheet over the access notice.
    if (shouldStripIssue) setParams(previous => patchArmoryParams(previous, { issue: null, return: null }), { replace: true })
    else if (shouldStripReturn) setParams(previous => patchArmoryParams(previous, { return: null }), { replace: true })
  }, [setParams, shouldStripIssue, shouldStripReturn])

  useEffect(() => {
    if (!accessChange || !canView || isLoading || shouldStripIssue) return
    const frame = requestAnimationFrame(() => headingFocus.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [accessChange, canView, isLoading, shouldStripIssue])

  // The flag also suspends ShiftPane's issue detail, avoiding two modal focus
  // traps. It is removed when the linked return is dismissed, not on reload.
  const linkedReturn = !shouldStripReturn && editable && canBrowse ? requestedReturn : null
  const activeTask: Task | null = task ?? (linkedReturn === null ? null : {
    kind: 'return', mode: 'shift', assignmentId: linkedReturn, opener: null, tracksIssue: true,
  })
  const taskOpener = activeTask && activeTask.kind !== 'check' ? activeTask.opener : null
  const checkOpener = check?.opener ?? null
  const taskFocus = useMemo(() => taskOpener ? returnFocus(taskOpener) : headingFocus, [taskOpener])
  const checkFocus = useMemo(() => checkOpener ? returnFocus(checkOpener) : headingFocus, [checkOpener])

  const openFind = useCallback(() => {
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : findButtonRef.current
    setStatus(null)
    setTask({ kind: 'find', opener })
  }, [])
  useArmoryFindShortcut(openFind, canView && canBrowse && activeTask === null)

  function selectSafe(next: number | null) {
    setStatus(current => current === 'chooseSafeForAction' ? null : current)
    setParams(previous => patchArmoryParams(previous, { safe: next ?? 'all' }))
  }

  function openWrite(next: Task) {
    if (!editable) return
    setStatus(null)
    setTask(next)
  }

  function closeTask(kind: Task['kind']) {
    setTask(current => current?.kind === kind ? null : current)
  }

  function openAssignment(mode: AssignmentKind, opener: HTMLElement) {
    openWrite({ kind: 'assignment', mode, safeId, opener, qualification: null, resumeSignal: 0 })
  }

  function openReturn(assignmentId: number, mode: AssignmentKind, opener: HTMLElement | null) {
    if (!editable) return
    const tracksIssue = mode === 'shift' && tab === 'shift' && readArmoryId(params, 'issue') === assignmentId
    openWrite({ kind: 'return', mode, assignmentId, opener, tracksIssue })
    if (tracksIssue) setParams(previous => patchArmoryParams(previous, { return: 1 }), { replace: true })
  }

  function closeReturn() {
    closeTask('return')
    if (activeTask?.kind === 'return' && activeTask.tracksIssue) setDismissedReturn({ key: location.key, stripIssue: false })
  }

  function correctQualification(employeeId: string) {
    if (!editable || task?.kind !== 'assignment' || task.qualification) return
    const next = new URLSearchParams(params)
    for (const key of ARMORY_DETAIL_KEYS) next.delete(key)
    next.set('tab', 'guards')
    next.set('guard', employeeId)
    const guardsSearch = `?${next}`
    const original = { search: location.search, hash: location.hash, state: location.state }
    setTask({ ...task, qualification: { employeeId, original, guardsSearch, returning: false } })
    void navigate({ search: guardsSearch }, { replace: true })
  }

  function qualificationDone() {
    if (!editable || task?.kind !== 'assignment' || !task.qualification || task.qualification.returning) return
    const { original } = task.qualification
    setTask({ ...task, qualification: { ...task.qualification, returning: true } })
    void navigate({ search: original.search, hash: original.hash }, { replace: true, state: original.state })
  }

  function openBulkReturn(opener: HTMLElement) {
    if (!editable) return
    if (safeId === null) {
      setStatus('chooseSafeForAction')
      scopeRef.current?.focus()
      return
    }
    openWrite({ kind: 'bulk', safeId, opener })
  }

  function openCheck(checkSafeId: number, opener: HTMLElement) {
    if (!editable || !safes.some(safe => safe.id === checkSafeId)) return
    setCheck({ safeId: checkSafeId, paused: false, opener })
    openWrite({ kind: 'check' })
    if (safeId !== checkSafeId) selectSafe(checkSafeId)
  }

  function openReceive(opener: HTMLElement | null, preset: ReceivePreset = EMPTY_PRESET) {
    openWrite({ kind: 'receive', preset, defaultSafeId: safeId, opener, adding: null, resume: null })
  }

  function resumeReceive(itemId: number | null, receiveExisting = false) {
    setTask(current => {
      if (current?.kind === 'receive' && current.adding !== null) {
        const itemIds = itemId === null ? current.adding : [...current.adding, itemId]
        return { ...current, adding: null, resume: { signal: (current.resume?.signal ?? 0) + 1, itemIds } }
      }
      if (receiveExisting && current?.kind === 'addItem' && itemId !== null) {
        return { kind: 'receive', preset: { itemId }, defaultSafeId: safeId, opener: current.opener, adding: null, resume: null }
      }
      return current
    })
  }

  function savedItem(item: ArmoryItemDetailRead, { addAnother }: { addAnother: boolean }) {
    setStatus('savedItem')
    if (addAnother) {
      setTask(current => current?.kind === 'receive' && current.adding !== null
        ? { ...current, adding: [...current.adding, item.id] } : current)
    } else {
      resumeReceive(item.id)
    }
  }

  if (!canView || isLoading) return null

  const assignment = editable && activeTask?.kind === 'assignment' ? activeTask : null
  const qualification = assignment?.qualification
  const qualificationEmployeeId = qualification && !qualification.returning && location.search === qualification.guardsSearch
    ? qualification.employeeId : null
  const receive = editable && activeTask?.kind === 'receive' ? activeTask : null
  const addItem = editable && activeTask?.kind === 'addItem' ? activeTask : null
  const checkOpen = editable && activeTask?.kind === 'check'
  const addSafeButton = editable && (
    <Button type="button" variant={canBrowse ? 'outline' : 'default'} className="min-h-11 gap-2"
      onClick={event => openWrite({ kind: 'safe', opener: event.currentTarget })}>
      <Plus className="size-4" aria-hidden />{t('assets.armory.addSafe')}
    </Button>
  )

  let pane: ReactNode
  if (safesQuery.isError) {
    pane = (
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <p role="alert" className="text-sm text-destructive-text">{safesDenied ? armoryErrorMessage(safesQuery.error) : t('assets.armory.loadFailed')}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void safesQuery.refetch()}>{t('assets.armory.retry')}</Button>
      </div>
    )
  } else if (safesQuery.isPending) {
    pane = <ArmoryLoading />
  } else if (!canBrowse) {
    pane = (
      <div className="flex flex-col items-center rounded-lg border border-border bg-surface pb-8">
        <EmptyState message={t('assets.armory.noSafesTitle')}
          description={t(editable ? 'assets.armory.noSafesEditor' : 'assets.armory.noSafesViewer')} className="px-4 py-8" />
        {addSafeButton}
      </div>
    )
  } else {
    switch (tab) {
      case 'shift':
        pane = <ShiftPane safeId={safeId} safes={safes} checkPaused={editable && check?.safeId === safeId && check.paused}
          onIssue={opener => openAssignment('shift', opener)} onHandover={opener => openAssignment('custody', opener)}
          onReturn={(id, opener) => openReturn(id, 'shift', opener)}
          onBulkReturn={openBulkReturn} onShiftCheck={openCheck} />
        break
      case 'items':
        pane = <ItemsPane safeId={safeId} safes={safes}
          onAddItem={opener => openWrite({ kind: 'addItem', opener })}
          onReceive={openReceive} />
        break
      case 'custody':
        pane = <CustodyPane safeId={safeId} onOpenHandover={opener => openAssignment('custody', opener)}
          onOpenReturn={(id, opener) => openReturn(id, 'custody', opener)} />
        break
      case 'guards':
        pane = <GuardsPane safeId={safeId} qualificationEmployeeId={qualificationEmployeeId} onQualificationDone={qualificationDone} />
        break
      case 'audit':
        pane = <AuditPane safeId={safeId} />
        break
    }
  }

  return (
    <ArmoryShell tab={tab} params={params} safes={safes} safeId={safeId} onScopeChange={selectSafe} onFind={openFind}
      findButtonRef={findButtonRef} scopeRef={scopeRef} status={statusKey ? t(`assets.armory.${statusKey}`) : null}
      actions={editable && canBrowse ? (
        <>
          {addSafeButton}
          <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={event => openWrite({ kind: 'settings', opener: event.currentTarget })}>
            <Settings2 className="size-4" aria-hidden />{t('assets.armory.shiftSettings')}
          </Button>
        </>
      ) : null}>
      <Suspense fallback={<ArmoryLoading />}>{pane}</Suspense>

      {canBrowse && activeTask?.kind === 'find' && <FindArmoryDialog open safeId={safeId} returnFocusRef={taskFocus}
        onOpenChange={open => { if (!open) closeTask('find') }}
        onReturn={(id, kind) => openReturn(id, kind, activeTask.opener)}
        onReceiveSerial={serialCode => openReceive(activeTask.opener, { serialCode })} />}
      {assignment && <ArmoryAssignmentDialog open={assignment.qualification === null} mode={assignment.mode} safeId={assignment.safeId}
        safes={safes} returnFocusRef={taskFocus} resumeSignal={assignment.resumeSignal}
        onOpenChange={open => { if (!open) closeTask('assignment') }} onCorrectQualification={correctQualification}
        onSaved={record => { setStatus(record.kind === 'shift' ? 'savedIssue' : 'savedCustody'); closeTask('assignment') }} />}
      {editable && activeTask?.kind === 'return' && (!activeTask.tracksIssue || linkedReturn === activeTask.assignmentId) && (
        <ArmoryReturnDialog key={`${activeTask.mode}:${activeTask.assignmentId}`} open kind={activeTask.mode} assignmentId={activeTask.assignmentId}
          returnFocusRef={taskFocus} onOpenChange={open => { if (!open) closeReturn() }}
          onSaved={result => {
            setStatus(result.assignment.kind === 'custody' && result.assignment.state === 'ended' ? 'savedEnd' : 'savedReturn')
            closeReturn()
          }} />
      )}
      {editable && activeTask?.kind === 'bulk' && <BulkReturnDialog open safeId={activeTask.safeId} returnFocusRef={taskFocus}
        onOpenChange={open => { if (!open) closeTask('bulk') }} onSaved={() => { setStatus('savedBulkReturn'); closeTask('bulk') }} />}
      {editable && check && (checkOpen || check.paused) && <ShiftCheckDialog key={`${principal}:${check.safeId}`} open={checkOpen}
        safeId={check.safeId} returnFocusRef={checkFocus} onOpenChange={open => { if (!open) closeTask('check') }}
        onPausedChange={paused => setCheck(current => current ? { ...current, paused } : null)}
        onSaved={() => { setCheck(null); setStatus('savedCheck'); closeTask('check') }} />}
      {receive && <ReceiveStockDialog open={receive.adding === null} preset={receive.preset} defaultSafeId={receive.defaultSafeId}
        safes={safes} returnFocusRef={taskFocus} resume={receive.resume}
        onOpenChange={open => { if (!open) closeTask('receive') }}
        onAddMissingItem={() => setTask(current => current?.kind === 'receive' && current.adding === null
          ? { ...current, adding: [] } : current)}
        onSaved={posting => setStatus(posting.kind === 'opening' ? 'intake.savedOpening' : 'savedStock')} />}
      {(addItem || (receive && receive.adding !== null)) && <AddItemDialog open safes={safes} returnFocusRef={addItem ? taskFocus : headingFocus}
        onOpenChange={open => { if (!open) { resumeReceive(null); closeTask('addItem') } }}
        onSaved={savedItem} onReceiveExisting={id => resumeReceive(id, true)} />}
      {editable && activeTask?.kind === 'safe' && <ArmorySafeDialog open returnFocusRef={taskFocus}
        onOpenChange={open => { if (!open) closeTask('safe') }}
        onSaved={safe => { setStatus('savedSafe'); selectSafe(safe.id) }} />}
      {editable && activeTask?.kind === 'settings' && <ArmoryShiftSettingsDialog open returnFocusRef={taskFocus}
        onOpenChange={open => { if (!open) closeTask('settings') }} onSaved={() => setStatus('savedSettings')} />}
    </ArmoryShell>
  )
}
