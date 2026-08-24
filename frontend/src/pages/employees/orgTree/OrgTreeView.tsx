import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crosshair, Expand, GripVertical, Minimize2, Pencil, Search, Shrink, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api, type OrgNodeRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import {
  LINE_W,
  LINE_W_LIN,
  STEM,
  buildForest,
  compareOrgPeople,
  directReports,
  isBelow,
  layoutForest,
  supervisorChain,
  type OrgLayout,
  type OrgPerson,
} from '@/lib/orgTree'
import { useCapabilities } from '@/lib/useCapabilities'
import { SupervisorPicker } from './SupervisorPicker'

interface OrgTreeViewProps {
  unit: string
}

interface DragState {
  employee: OrgPerson
  x: number
  y: number
  originX: number
  originY: number
  active: boolean
  targetId: string | null
}


export function OrgTreeView({ unit }: OrgTreeViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const sectionRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [depth, setDepth] = useState<'all' | '2' | '3'>('2')
  const [search, setSearch] = useState('')
  const [tracedId, setTracedId] = useState<string | null>(null)
  const [scopeId, setScopeId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [picker, setPicker] = useState<{ employee: OrgPerson; anchor: HTMLElement | null; boundsEl: HTMLElement | null } | null>(null)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const viewRef = useRef(view)
  const movedRef = useRef(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const treeQuery = useQuery({ queryKey: ['org-tree'], queryFn: api.listOrgTree })
  const people = useMemo(() => (treeQuery.data ?? []).filter((person) => person.duty_unit === unit), [treeQuery.data, unit])
  const canEdit = has('employees.edit')
  const lang = i18n.language
  const nameOf = useCallback(
    (person: { name_en: string; name_ar?: string | null }): string => pickEmployeeName(person, lang),
    [lang],
  )
  const positionOf = (person: OrgPerson): string | null =>
    lang === 'ar' && person.position_ar?.trim() ? person.position_ar : person.position
  const forest = useMemo(() => buildForest(people), [people])
  const scopedForest = useMemo(() => {
    if (!scopeId) return forest
    const pending = [...forest]
    while (pending.length) {
      const node = pending.pop()!
      if (node.person.id === scopeId) return [node]
      pending.push(...node.children)
    }
    return forest
  }, [forest, scopeId])
  const primaryRootId = scopedForest[0]?.person.id ?? null
  const visibleRoots = useMemo(
    () => scopedForest.filter((root) => root.person.supervisor_id !== null || root.person.id === primaryRootId),
    [primaryRootId, scopedForest],
  )
  const maxLevel = depth === 'all' ? Number.POSITIVE_INFINITY : Number(depth)
  const layout = useMemo(
    () => layoutForest(visibleRoots, { collapsed, maxLevel }),
    [collapsed, maxLevel, visibleRoots],
  )
  const unlinked = useMemo(
    () => people
      .filter((person) => person.supervisor_id === null && person.id !== primaryRootId)
      .toSorted(compareOrgPeople),
    [people, primaryRootId],
  )
  const lineage = useMemo(
    () => (tracedId ? new Set([tracedId, ...supervisorChain(people, tracedId).map((person) => person.id)]) : null),
    [people, tracedId],
  )
  const currentScope = scopeId ? people.find((person) => person.id === scopeId) ?? null : null
  const scopeChain = useMemo(() => (scopeId ? supervisorChain(people, scopeId).toReversed() : []), [people, scopeId])

  const setSupervisor = useMutation({
    mutationFn: ({ employeeId, supervisorId }: { employeeId: string; supervisorId: string | null }) =>
      api.setOrgSupervisor(employeeId, { supervisor_id: supervisorId }),
    onSuccess: (updated, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['org-tree'] })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      const previousSupervisor = people.find((person) => person.id === variables.employeeId)?.supervisor_id ?? null
      const employee = people.find((person) => person.id === variables.employeeId)
      const supervisor = people.find((person) => person.id === variables.supervisorId)
      const fallbackName = pickEmployeeName(updated, lang)
      const message = variables.supervisorId
        ? t('employees.orgTree.changed', { name: employee ? nameOf(employee) : fallbackName, sup: supervisor ? nameOf(supervisor) : variables.supervisorId })
        : t('employees.orgTree.changedRoot', { name: employee ? nameOf(employee) : fallbackName })
      toast.success(message, {
        action: {
          label: t('employees.orgTree.undo'),
          onClick: () => setSupervisor.mutate({ employeeId: variables.employeeId, supervisorId: previousSupervisor }),
        },
      })
    },
    onError: (error, variables) => {
      if (error instanceof ApiError && error.status === 409) {
        const target = people.find((person) => person.id === variables.supervisorId)
        const employee = people.find((person) => person.id === variables.employeeId)
        toast.error(t('employees.orgTree.cycle', { name: target ? nameOf(target) : '', other: employee ? nameOf(employee) : '' }))
      } else {
        toast.error(t('employees.orgTree.saveError'))
      }
    },
  })

  const applyTransform = useCallback((next: { scale: number; tx: number; ty: number }): void => {
    viewRef.current = next
    const canvas = canvasRef.current
    if (canvas) canvas.style.transform = `translate(${next.tx}px, ${next.ty}px) scale(${next.scale})`
    setView(next)
  }, [])

  const fitView = useCallback((): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const width = Math.max(layout.width, 1)
    const height = Math.max(layout.height, 1)
    const scale = Math.max(0.16, Math.min(1, (viewport.clientWidth - 40) / width, (viewport.clientHeight - 40) / height))
    applyTransform({
      scale,
      tx: Math.max(20, (viewport.clientWidth - width * scale) / 2),
      ty: unlinked.length > 0 ? 74 : 20,
    })
  }, [applyTransform, layout.height, layout.width, unlinked.length])

  // Fit once per scope change (depth / drill-in / unit), never on collapse
  // toggles or post-edit refetches — those must not throw away the user's
  // pan and zoom. The flag is armed by the deps effect and consumed by the
  // layout effect in the same commit.
  const fitViewRef = useRef(fitView)
  useEffect(() => {
    fitViewRef.current = fitView
  }, [fitView])
  const needsFitRef = useRef(true)
  useEffect(() => {
    needsFitRef.current = true
  }, [depth, scopeId, unit])
  useEffect(() => {
    if (!needsFitRef.current || layout.nodes.length === 0) return
    needsFitRef.current = false
    const frame = requestAnimationFrame(() => fitViewRef.current())
    return () => cancelAnimationFrame(frame)
  }, [layout])

  // Native non-passive listener: React attaches `onWheel` passively at the
  // root, so `preventDefault()` there is a console error and the page
  // scrolls behind the zoom. Deps include the early-return conditions so the
  // listener attaches once the real viewport mounts.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const current = viewRef.current
      const scale = Math.min(2.2, Math.max(0.25, current.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
      applyTransform({
        scale,
        tx: event.clientX - rect.left - (event.clientX - rect.left - current.tx) * (scale / current.scale),
        ty: event.clientY - rect.top - (event.clientY - rect.top - current.ty) * (scale / current.scale),
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [applyTransform, treeQuery.isLoading, treeQuery.isError, people.length])

  useEffect(() => {
    const onFullscreenChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement))
      setPicker(null)
      requestAnimationFrame(fitView)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [fitView])

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent): void => {
      setDrag((current) => {
        if (!current) return null
        // A press is not a drag until it travels: keeps plain clicks (trace,
        // orphan-chip picker) from being swallowed by the drag machinery.
        const active = current.active || Math.hypot(event.clientX - current.originX, event.clientY - current.originY) > 4
        if (!active) return current
        movedRef.current = true
        const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.org-card[data-person-id]')
        return { ...current, active, x: event.clientX, y: event.clientY, targetId: under?.dataset.personId ?? null }
      })
    }
    const onUp = (): void => {
      setDrag((current) => {
        if (current?.active && current.targetId && current.targetId !== current.employee.id) {
          if (isBelow(people, current.targetId, current.employee.id)) {
            const target = people.find((person) => person.id === current.targetId)
            toast.error(t('employees.orgTree.cycle', { name: target ? nameOf(target) : '', other: nameOf(current.employee) }))
          } else {
            setSupervisor.mutate({ employeeId: current.employee.id, supervisorId: current.targetId })
          }
        }
        return null
      })
      // Deferred: the click (if the browser fires one) dispatches before
      // timers, so suppression still works, but a drop that lands on a
      // different element (no click) cannot swallow the NEXT click.
      setTimeout(() => { movedRef.current = false }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, nameOf, people, setSupervisor, t])

  function toggleCollapsed(id: string): void {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, employee: OrgPerson): void {
    if (!canEdit || !editMode || event.button !== 0) return
    if (event.target instanceof Element && (event.target.closest('[data-org-no-drag]') || (event.target.closest('button') && !event.target.closest('[data-org-drag-handle]')))) return
    event.stopPropagation()
    movedRef.current = false
    setDrag({ employee, x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY, active: false, targetId: null })
  }

  function centerOnManager(): void {
    const targetId = tracedId ? people.find((person) => person.id === tracedId)?.supervisor_id ?? tracedId : layout.nodes[0]?.node.person.id
    const target = layout.nodes.find((node) => node.node.person.id === targetId) ?? layout.nodes[0]
    const viewport = viewportRef.current
    if (!target || !viewport) return
    // Mirror the target's x the same way the node layer does, or centring
    // scrolls to where the card would be in an LTR tree.
    const scale = Math.max(view.scale, 0.9)
    const isRtl = document.documentElement.dir === 'rtl'
    const width = Math.max(layout.width, 600)
    const centreX = mirrorX(target.x, width, isRtl, target.w) + target.w / 2
    const next = {
      scale,
      tx: viewport.clientWidth / 2 - centreX * scale,
      ty: viewport.clientHeight * 0.26 - (target.y + target.h / 2) * scale,
    }
    applyTransform(next)
    document.querySelector<HTMLElement>(`.org-card[data-person-id="${CSS.escape(target.node.person.id)}"]`)?.animate(
      [{ boxShadow: '0 0 0 0 rgba(200,16,46,.55)' }, { boxShadow: '0 0 0 12px rgba(200,16,46,0)' }],
      { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)' },
    )
  }

  function toggleFullscreen(): void {
    const host = sectionRef.current?.closest<HTMLElement>('[data-org-tree-fullscreen-host]')
      ?? sectionRef.current?.closest<HTMLElement>('.overflow-hidden')
      ?? sectionRef.current
    if (document.fullscreenElement) void document.exitFullscreen()
    else void host?.requestFullscreen()
  }

  if (treeQuery.isLoading) return <Skeleton className="h-[520px] w-full rounded-2xl" />
  if (treeQuery.isError) return <p className="py-12 text-center text-sm text-accent">{t('employees.orgTree.loadError')}</p>
  if (people.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">{t('employees.orgTree.empty')}</p>

  const supervisors = people.filter((person) => directReports(people, person.id).length > 0).length
  const widestSpan = Math.max(0, ...people.map((person) => directReports(people, person.id).length))
  const postCount = new Set(people.map((person) => person.duty_post?.trim()).filter(Boolean)).size
  const planeWidth = Math.max(layout.width, 600)
  const rtl = document.documentElement.dir === 'rtl'
  const overlayHost = document.fullscreenElement ?? document.body

  return (
    <section ref={sectionRef} className="org-tree-view flex min-h-[520px] flex-1 flex-col" aria-label={t('employees.orgTree.title')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface px-4 py-3">
        <div className="min-w-0">
          <b className="block text-[1.02em] leading-tight" dir="auto">{unit}</b>
          <small className="text-[0.76em] text-muted-foreground">
            {t('dutyLocations.roster.summary', { employees: people.length, posts: postCount })}
          </small>
        </div>
        <label className="relative ms-auto flex w-full items-center sm:w-[210px]">
          <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <input className="h-9 w-full rounded-full border border-border bg-surface ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('employees.orgTree.searchPlaceholder')} aria-label={t('employees.orgTree.searchPlaceholder')} />
        </label>
        <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface">
          {(['all', '2', '3'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={depth === value} className="org-depth-button" onClick={() => setDepth(value)}>{t(`employees.orgTree.${value === 'all' ? 'depthAll' : `depth${value}`}`)}</button>
          ))}
        </div>
        {canEdit ? <button type="button" className={`org-toolbar-button${editMode ? ' is-active' : ''}`} onClick={() => setEditMode((current) => !current)}><Pencil size={14} />{t('employees.orgTree.editLinks')}</button> : <span className="org-readonly-chip">{t('employees.orgTree.viewOnly')}</span>}
      </div>
      {currentScope && <nav className="org-crumbbar" aria-label={t('employees.orgTree.wholeUnit')}><span>{t('employees.orgTree.showing')}</span><button type="button" onClick={() => setScopeId(null)}>{t('employees.orgTree.wholeUnit')}</button>{scopeChain.map((person) => <button key={person.id} type="button" dir="auto" onClick={() => setScopeId(person.id)}>{nameOf(person)}</button>)}<b dir="auto">{nameOf(currentScope)}</b></nav>}
      {/* Each stat is ONE pluralized phrase, not a number glued to a bare
          noun: Arabic picks a different form per count (موظف / موظفان /
          موظفين), so splitting the number out of the string breaks it. */}
      <div className="org-stats-strip">
        <span>{t('employees.orgTree.people', { count: people.length })}</span>
        <span>{t('employees.orgTree.layers', { count: layout.levels.length })}</span>
        <span>{t('employees.orgTree.supervisors', { count: supervisors })}</span>
        <span>{t('employees.orgTree.widestSpan', { count: widestSpan })}</span>
        {unlinked.length > 0 && (
          <span className="org-unlinked-stat">▲ {t('employees.orgTree.unlinked', { count: unlinked.length })}</span>
        )}
        <span className="ms-auto org-legend">
          <i />
          {t('employees.orgTree.legendReports')}
        </span>
        <span className="org-legend">
          <i className="is-trace" />
          {t('employees.orgTree.legendTrace')}
        </span>
      </div>
      <div
        ref={viewportRef}
        className="org-canvas"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (event.target !== event.currentTarget && !(event.target instanceof Element && event.target.closest('.org-layer'))) return
          const origin = viewRef.current
          const start = { x: event.clientX - origin.tx, y: event.clientY - origin.ty }
          const startClient = { x: event.clientX, y: event.clientY }
          const move = (moveEvent: PointerEvent): void => {
            if (Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y) > 4) movedRef.current = true
            applyTransform({ scale: origin.scale, tx: moveEvent.clientX - start.x, ty: moveEvent.clientY - start.y })
          }
          const end = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); setTimeout(() => { movedRef.current = false }, 0) }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', end)
        }}
        onClick={(event) => {
          // A pan that ends over the plane still fires a click; keep the
          // trace in that case, and keep it when the click landed on a card
          // or control rather than empty canvas.
          if (movedRef.current) { movedRef.current = false; return }
          if (event.target instanceof Element && event.target.closest('.org-card, button, .org-orphan-banner, .org-zoom-bar, .org-hint')) return
          setTracedId(null)
        }}
      >
        <div ref={canvasRef} className="org-tree-plane" style={{ width: planeWidth, height: Math.max(layout.height, 320), transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
          <div className="org-layer org-connector-layer">{layout.links.flatMap((link) => connectorParts(link, Boolean(lineage?.has(link.id) && lineage.has(link.parentId)), planeWidth, rtl))}</div>
          <div className={`org-layer org-node-layer${lineage ? ' is-tracing' : ''}`}>
            {layout.nodes.map((entry) => {
              const person = entry.node.person
              const matching = matches(person, search)
              const traced = Boolean(lineage?.has(person.id))
              const invalidDrop = drag?.targetId === person.id && isBelow(people, person.id, drag.employee.id)
              const validDrop = drag?.targetId === person.id && !invalidDrop && person.id !== drag.employee.id
              return <div key={person.id} className="org-item" style={{ width: entry.w, height: entry.h, transform: `translate(${mirrorX(entry.x, planeWidth, rtl, entry.w)}px, ${entry.y}px)` }}><article data-person-id={person.id} tabIndex={0} className={`org-card${traced ? ' is-traced' : ''}${!matching ? ' is-dimmed' : ''}${drag?.active && drag.employee.id === person.id ? ' is-dragging' : ''}${validDrop ? ' is-drop' : ''}${invalidDrop ? ' is-nodrop' : ''}`} onPointerDown={(event) => startDrag(event, person)} onClick={(event) => { event.stopPropagation(); if (movedRef.current) { movedRef.current = false; return } setTracedId((current) => current === person.id ? null : person.id) }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setTracedId((current) => current === person.id ? null : person.id) } }}>
                <div className="org-card-main"><span className="org-avatar">{initials(person, lang)}</span><div className="min-w-0"><p dir="auto" title={nameOf(person)}>{nameOf(person)}</p><small dir="auto" title={positionOf(person) ?? undefined}>{positionOf(person)}</small></div></div><div className="org-card-foot"><span>{person.id}</span><em dir="auto" title={person.duty_post ?? undefined}>{person.duty_post}</em>{directReports(people, person.id).length > 0 && <button type="button" data-org-no-drag onClick={(event) => { event.stopPropagation(); setScopeId(person.id) }}>{directReports(people, person.id).length} ▾</button>}</div>
                {editMode && canEdit && <><GripVertical className="org-grip" size={14} /><button type="button" data-org-no-drag className="org-edit-button" aria-label={t('employees.orgTree.pickTitle')} onClick={(event) => { event.stopPropagation(); setPicker({ employee: person, anchor: event.currentTarget.closest<HTMLElement>('.org-card'), boundsEl: viewportRef.current }) }}><Pencil size={12} /></button></>}
              </article>{entry.hasChildren && <button type="button" className="org-collapse-pip" aria-expanded={!collapsed.has(person.id)} aria-label={t(`employees.orgTree.${collapsed.has(person.id) ? 'expandReports' : 'collapseReports'}`)} onClick={(event) => { event.stopPropagation(); toggleCollapsed(person.id) }}>{collapsed.has(person.id) ? '+' : '−'}</button>}</div>
            })}
          </div>
        </div>
        {unlinked.length > 0 && <div className="org-orphan-banner"><b>▲ {t('employees.orgTree.orphanTitle', { count: unlinked.length })}</b><small>{t('employees.orgTree.orphanBody')}</small><span>{unlinked.map((person) => <button key={person.id} type="button" dir="auto" data-org-drag-handle className="org-orphan-chip" onPointerDown={(event) => startDrag(event, person)} onClick={() => { if (movedRef.current) { movedRef.current = false; return } if (editMode) setPicker({ employee: person, anchor: null, boundsEl: viewportRef.current }) }}>{nameOf(person)}</button>)}</span></div>}
        <p className="org-hint">{t(`employees.orgTree.${editMode ? 'hintEdit' : 'hint'}`)}</p>
        <div className="org-zoom-bar"><button type="button" className="org-center-button" onClick={centerOnManager}><Crosshair size={15} />{t('employees.orgTree.centerManager')}</button><button type="button" onClick={() => applyTransform({ ...view, scale: Math.min(2.2, view.scale * 1.15) })} aria-label={t('employees.orgTree.zoomIn')}><ZoomIn size={16} /></button><button type="button" onClick={() => applyTransform({ ...view, scale: Math.max(0.25, view.scale / 1.15) })} aria-label={t('employees.orgTree.zoomOut')}><ZoomOut size={16} /></button><button type="button" onClick={fitView} aria-label={t('employees.orgTree.fitView')}><Shrink size={16} /></button><button type="button" onClick={toggleFullscreen} aria-label={t('employees.orgTree.fullscreen')}>{isFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}</button></div>
      </div>
      {picker && <SupervisorPicker employee={picker.employee} candidates={people} anchor={picker.anchor} boundsEl={picker.boundsEl} onClose={() => setPicker(null)} onPick={(supervisorId) => { setPicker(null); setSupervisor.mutate({ employeeId: picker.employee.id, supervisorId }) }} />}
      {drag?.active && createPortal(<div className="org-drag-ghost" style={{ left: drag.x, top: drag.y }}><span className="org-avatar">{initials(drag.employee, lang)}</span><b dir="auto">{nameOf(drag.employee)}</b></div>, overlayHost)}
    </section>
  )
}

/** Mirror an x coordinate when the document reads right-to-left. The plane is
 *  anchored physically (see index.css), so RTL is expressed here in the
 *  geometry: the tree grows from the right edge, matching the rest of the UI. */
function mirrorX(x: number, width: number, rtl: boolean, own = 0): number {
  return rtl ? width - x - own : x
}

function connectorParts(
  link: OrgLayout['links'][number],
  traced: boolean,
  planeWidth: number,
  rtl: boolean,
): React.JSX.Element[] {
  const thickness = traced ? LINE_W_LIN : LINE_W
  const className = `org-seg${traced ? ' is-traced' : ''}`
  const px = mirrorX(link.px, planeWidth, rtl)
  const cx = mirrorX(link.cx, planeWidth, rtl)
  const horizontalLeft = Math.min(px, cx) - thickness / 2
  const horizontalWidth = Math.abs(cx - px) + thickness
  return [
    <div key={`${link.id}-parent`} className={className} style={{ width: thickness, height: STEM + thickness / 2, transform: `translate(${px - thickness / 2}px, ${link.py}px)` }} />,
    ...(horizontalWidth > thickness ? [<div key={`${link.id}-bus`} className={className} style={{ width: horizontalWidth, height: thickness, transform: `translate(${horizontalLeft}px, ${link.py + STEM - thickness / 2}px)` }} />] : []),
    <div key={`${link.id}-child`} className={className} style={{ width: thickness, height: link.cy - link.py - STEM + thickness / 2, transform: `translate(${cx - thickness / 2}px, ${link.py + STEM - thickness / 2}px)` }} />,
  ]
}

function matches(person: OrgPerson, query: string): boolean {
  const term = query.trim().toLocaleLowerCase()
  return !term || [person.id, person.name_en, person.name_ar, person.position, person.position_ar, person.duty_post].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase().includes(term))
}

/** Initials of the displayed (language-appropriate) name, not always the
 *  English one — the avatar should match the name printed beside it. */
function initials(person: OrgNodeRead, language: string): string {
  const words = (pickEmployeeName(person, language) || person.id).trim().split(/\s+/)
  return `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toUpperCase()
}
