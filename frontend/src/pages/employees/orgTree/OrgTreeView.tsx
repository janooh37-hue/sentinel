import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crosshair, Expand, GripVertical, Minimize2, Pencil, Search, Shrink, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api, type OrgNodeRead } from '@/lib/api'
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
  targetId: string | null
}


export function OrgTreeView({ unit }: OrgTreeViewProps): React.JSX.Element {
  const { t } = useTranslation()
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
  const [drag, setDrag] = useState<DragState | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const treeQuery = useQuery({ queryKey: ['org-tree'], queryFn: api.listOrgTree })
  const people = useMemo(() => (treeQuery.data ?? []).filter((person) => person.duty_unit === unit), [treeQuery.data, unit])
  const canEdit = has('employees.edit')
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
      const message = variables.supervisorId
        ? t('employees.orgTree.changed', { name: employee?.name_en ?? updated.name_en, sup: supervisor?.name_en ?? variables.supervisorId })
        : t('employees.orgTree.changedRoot', { name: employee?.name_en ?? updated.name_en })
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
        toast.error(t('employees.orgTree.cycle', { name: target?.name_en ?? '', other: employee?.name_en ?? '' }))
      }
    },
  })

  const applyTransform = useCallback((next: { scale: number; tx: number; ty: number }): void => {
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

  useEffect(() => {
    const frame = requestAnimationFrame(fitView)
    return () => cancelAnimationFrame(frame)
  }, [depth, fitView, scopeId, unit])

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
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.org-card[data-person-id]')
      const targetId = under?.dataset.personId ?? null
      setDrag((current) => (current ? { ...current, x: event.clientX, y: event.clientY, targetId } : null))
    }
    const onUp = (): void => {
      setDrag((current) => {
        if (current?.targetId && current.targetId !== current.employee.id) {
          if (isBelow(people, current.targetId, current.employee.id)) {
            const target = people.find((person) => person.id === current.targetId)
            toast.error(t('employees.orgTree.cycle', { name: target?.name_en ?? '', other: current.employee.name_en }))
          } else {
            setSupervisor.mutate({ employeeId: current.employee.id, supervisorId: current.targetId })
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, people, setSupervisor, t])

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
    setDrag({ employee, x: event.clientX, y: event.clientY, targetId: null })
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
          <input className="h-9 w-full rounded-full border border-border bg-surface ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('employees.orgTree.searchPlaceholder')} />
        </label>
        <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface">
          {(['all', '2', '3'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={depth === value} className="org-depth-button" onClick={() => setDepth(value)}>{t(`employees.orgTree.${value === 'all' ? 'depthAll' : `depth${value}`}`)}</button>
          ))}
        </div>
        {canEdit ? <button type="button" className={`org-toolbar-button${editMode ? ' is-active' : ''}`} onClick={() => setEditMode((current) => !current)}><Pencil size={14} />{t('employees.orgTree.editLinks')}</button> : <span className="org-readonly-chip">{t('employees.orgTree.viewOnly')}</span>}
      </div>
      {currentScope && <nav className="org-crumbbar" aria-label={t('employees.orgTree.wholeUnit')}><span>{t('employees.orgTree.showing')}</span><button type="button" onClick={() => setScopeId(null)}>{t('employees.orgTree.wholeUnit')}</button>{scopeChain.map((person) => <button key={person.id} type="button" dir="auto" onClick={() => setScopeId(person.id)}>{person.name_en}</button>)}<b dir="auto">{currentScope.name_en}</b></nav>}
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
        onWheel={(event) => {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          const scale = Math.min(2.2, Math.max(0.25, view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
          applyTransform({ scale, tx: event.clientX - rect.left - (event.clientX - rect.left - view.tx) * (scale / view.scale), ty: event.clientY - rect.top - (event.clientY - rect.top - view.ty) * (scale / view.scale) })
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget && !(event.target instanceof Element && event.target.closest('.org-layer'))) return
          const start = { x: event.clientX - view.tx, y: event.clientY - view.ty }
          const move = (moveEvent: PointerEvent): void => applyTransform({ ...view, tx: moveEvent.clientX - start.x, ty: moveEvent.clientY - start.y })
          const end = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', end)
        }}
        onClick={(event) => { if (event.target === event.currentTarget) setTracedId(null) }}
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
              return <div key={person.id} className="org-item" style={{ width: entry.w, height: entry.h, transform: `translate(${mirrorX(entry.x, planeWidth, rtl, entry.w)}px, ${entry.y}px)` }}><article data-person-id={person.id} className={`org-card${traced ? ' is-traced' : ''}${!matching ? ' is-dimmed' : ''}${drag?.employee.id === person.id ? ' is-dragging' : ''}${validDrop ? ' is-drop' : ''}${invalidDrop ? ' is-nodrop' : ''}`} onPointerDown={(event) => startDrag(event, person)} onClick={(event) => { event.stopPropagation(); setTracedId((current) => current === person.id ? null : person.id) }}>
                <div className="org-card-main"><span className="org-avatar">{initials(person)}</span><div className="min-w-0"><p dir="auto">{person.name_en}</p><small dir="auto">{person.position}</small></div></div><div className="org-card-foot"><span>{person.id}</span><em dir="auto">{person.duty_post}</em>{directReports(people, person.id).length > 0 && <button type="button" data-org-no-drag onClick={(event) => { event.stopPropagation(); setScopeId(person.id) }}>{directReports(people, person.id).length} ▾</button>}</div>
                {editMode && canEdit && <><GripVertical className="org-grip" size={14} /><button type="button" data-org-no-drag className="org-edit-button" onClick={(event) => { event.stopPropagation(); setPicker({ employee: person, anchor: event.currentTarget.closest<HTMLElement>('.org-card'), boundsEl: viewportRef.current }) }}><Pencil size={12} /></button></>}
              </article>{entry.hasChildren && <button type="button" className="org-collapse-pip" onClick={(event) => { event.stopPropagation(); toggleCollapsed(person.id) }}>{collapsed.has(person.id) ? '+' : '−'}</button>}</div>
            })}
          </div>
        </div>
        {unlinked.length > 0 && <div className="org-orphan-banner"><b>▲ {t('employees.orgTree.orphanTitle', { count: unlinked.length })}</b><small>{t('employees.orgTree.orphanBody')}</small><span>{unlinked.map((person) => <button key={person.id} type="button" data-org-drag-handle className="org-orphan-chip" onPointerDown={(event) => startDrag(event, person)} onClick={() => editMode && setPicker({ employee: person, anchor: null, boundsEl: viewportRef.current })}>{person.name_en}</button>)}</span></div>}
        <p className="org-hint">{t(`employees.orgTree.${editMode ? 'hintEdit' : 'hint'}`)}</p>
        <div className="org-zoom-bar"><button type="button" className="org-center-button" onClick={centerOnManager}><Crosshair size={15} />{t('employees.orgTree.centerManager')}</button><button type="button" onClick={() => applyTransform({ ...view, scale: Math.min(2.2, view.scale * 1.15) })} aria-label={t('employees.orgTree.zoomIn')}><ZoomIn size={16} /></button><button type="button" onClick={() => applyTransform({ ...view, scale: Math.max(0.25, view.scale / 1.15) })} aria-label={t('employees.orgTree.zoomOut')}><ZoomOut size={16} /></button><button type="button" onClick={fitView} aria-label={t('employees.orgTree.fitView')}><Shrink size={16} /></button><button type="button" onClick={toggleFullscreen} aria-label={t('employees.orgTree.fullscreen')}>{isFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}</button></div>
      </div>
      {picker && <SupervisorPicker employee={picker.employee} candidates={people} anchor={picker.anchor} boundsEl={picker.boundsEl} onClose={() => setPicker(null)} onPick={(supervisorId) => { setPicker(null); setSupervisor.mutate({ employeeId: picker.employee.id, supervisorId }) }} />}
      {drag && createPortal(<div className="org-drag-ghost" style={{ left: drag.x, top: drag.y }}><span className="org-avatar">{initials(drag.employee)}</span><b dir="auto">{drag.employee.name_en}</b></div>, overlayHost)}
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
  return !term || [person.id, person.name_en, person.name_ar, person.duty_post].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase().includes(term))
}

function initials(person: OrgNodeRead): string {
  const words = (person.name_en || person.name_ar || person.id).trim().split(/\s+/)
  return `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toUpperCase()
}
