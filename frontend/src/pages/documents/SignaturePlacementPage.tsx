/**
 * SignaturePlacementPage — the in-app signature placement workspace
 * (approval-signature-placement plan §9). Reached only via
 * `AdjustSignatureAction`; never launches Word merely to load (the editor
 * query always passes `measure: true` here because the workspace is, by
 * definition, actually open — plan §7.4).
 *
 * Two mutually exclusive modes, matching what `describe_editor` can ever
 * report for one document:
 *  - Placement (`can_adjust && signatures.length > 0`): drag/nudge the one
 *    tracked signature, Reset to its originally measured position, Save.
 *  - Legacy identification (`can_identify`, admin-only, no tracked artifact
 *    yet): confirm which unmarked image in the verified source DOCX is the
 *    manager/approver signature. Candidates carry no page/x/y — identifying
 *    a legacy signature never runs Word measurement (plan §7.2 "changes no
 *    rendered pixel") — so candidates are offered as a thumbnail list
 *    alongside the ordinary multi-page document PDF for visual
 *    cross-reference, not as an exact on-canvas overlay.
 *
 * Physical PDF coordinates never mirror in RTL — only surrounding chrome
 * does (plan §9.9). The canvas column is pinned `direction: ltr` exactly
 * like `BookRecordPage`'s desk.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, ArrowLeft, Loader2, History as HistoryIcon, Check } from 'lucide-react'

import {
  api,
  ApiError,
  apiErrorMessage,
  type LegacyCandidateRead,
  type SignatureEditorRead,
  type SignatureHistoryItemRead,
  type SignatureRead,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import DocPdfCanvas, { type PageBox } from '@/pages/application/DocPdfCanvas'
import {
  dragToPosition,
  mmToPt,
  pageAtPoint,
  placeSignature,
  ptToMm,
} from '@/components/signature/signature-utils'

interface Draft {
  page: number
  x: number
  y: number
}

export function SignaturePlacementPage(): React.JSX.Element {
  const { documentId: rawId } = useParams<{ documentId: string }>()
  const documentId = Number(rawId)
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()

  const editorQuery = useQuery({
    queryKey: ['signature-editor', documentId, 'measured'],
    queryFn: () => api.getSignatureEditor(documentId, true),
    enabled: Number.isFinite(documentId),
  })
  const historyQuery = useQuery({
    queryKey: ['signature-history', documentId],
    queryFn: () => api.getSignatureHistory(documentId),
    enabled: Number.isFinite(documentId),
  })

  const description = editorQuery.data
  const signatures = description?.signatures ?? []
  const placementMode = !!description?.can_adjust && signatures.length > 0
  const identifyMode = !!description?.can_identify && !placementMode

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = signatures.find((s) => s.id === selectedId) ?? signatures[0] ?? null

  // Re-baseline the local draft whenever the selection changes or the
  // server snapshot moves forward (a fresh Save) — computed during render
  // (React's documented "adjusting state when a prop changes" pattern),
  // never carrying a stale draft across either. Not a `useEffect`: setting
  // state directly in the render body while a derived key changes is the
  // sanctioned way to avoid an extra commit-then-effect render cascade.
  const draftKey = selected ? `${selected.id}:${description?.signature_revision ?? 0}` : null
  const [draft, setDraft] = useState<Draft | null>(null)
  const [lastDraftKey, setLastDraftKey] = useState<string | null>(null)
  if (draftKey !== lastDraftKey) {
    setLastDraftKey(draftKey)
    setDraft(
      selected && selected.page != null && selected.x != null && selected.y != null
        ? { page: selected.page, x: selected.x, y: selected.y }
        : null,
    )
  }

  // Same "adjust state during render" pattern as draftKey above: a fresh
  // selection/revision must read as unready immediately, never for one
  // extra frame with the previous signature's stale ready=true.
  const previewKey = selected
    ? `${documentId}:${selected.id}:${description?.signature_revision ?? 0}`
    : null
  const [previewReady, setPreviewReady] = useState(false)
  const [lastPreviewKey, setLastPreviewKey] = useState<string | null>(null)
  if (previewKey !== lastPreviewKey) {
    setLastPreviewKey(previewKey)
    setPreviewReady(false)
  }
  const handlePreviewReadyChange = useCallback((ready: boolean) => setPreviewReady(ready), [])

  const dirty =
    !!draft &&
    !!selected &&
    (draft.page !== selected.page ||
      Math.abs(draft.x - (selected.x ?? 0)) > 1e-9 ||
      Math.abs(draft.y - (selected.y ?? 0)) > 1e-9)

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const goBack = (): void => {
    if (dirty) setLeaveConfirmOpen(true)
    else navigate(-1)
  }

  const moveMutation = useMutation({
    mutationFn: () => {
      if (!description || !selected || !draft) throw new Error('nothing to save')
      if (!previewReady) throw new Error('signature preview is not ready yet')
      return api.moveSignature(documentId, selected.id, {
        signature_revision: description.signature_revision,
        package_revision: description.package_revision,
        source_sha256: description.source_sha256 ?? '',
        page: draft.page,
        x: draft.x,
        y: draft.y,
      })
    },
    onSuccess: (updated: SignatureEditorRead) => {
      qc.setQueryData(['signature-editor', documentId, 'measured'], updated)
      void qc.invalidateQueries({ queryKey: ['signature-editor', documentId] })
      void qc.invalidateQueries({ queryKey: ['signature-history', documentId] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['leaves'] })
      void qc.invalidateQueries({ queryKey: ['documents', documentId] })
      toast.success(t('signaturePlacement.saved'))
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SIGNATURE_REVISION_CONFLICT') {
        toast.error(t('signaturePlacement.conflict'))
        void editorQuery.refetch()
      } else {
        toast.error(apiErrorMessage(err))
      }
    },
  })

  const identifyMutation = useMutation({
    mutationFn: (candidateId: string) => {
      if (!description) throw new Error('editor not loaded')
      return api.identifySignature(documentId, {
        signature_revision: description.signature_revision,
        package_revision: description.package_revision,
        source_sha256: description.source_sha256 ?? '',
        candidate_id: candidateId,
      })
    },
    onSuccess: (updated: SignatureEditorRead) => {
      qc.setQueryData(['signature-editor', documentId, 'measured'], updated)
      void qc.invalidateQueries({ queryKey: ['signature-editor', documentId] })
      void qc.invalidateQueries({ queryKey: ['signature-history', documentId] })
      toast.success(t('signaturePlacement.identified'))
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SIGNATURE_REVISION_CONFLICT') {
        toast.error(t('signaturePlacement.conflict'))
        void editorQuery.refetch()
      } else {
        toast.error(apiErrorMessage(err))
      }
    },
  })

  const resetToDefault = (): void => {
    if (!selected || selected.default_page == null || selected.default_x == null || selected.default_y == null) return
    setDraft({ page: selected.default_page, x: selected.default_x, y: selected.default_y })
  }

  if (!Number.isFinite(documentId)) {
    return <PlacementShell isAr={isAr} onBack={() => navigate(-1)} title={t('signaturePlacement.title')} body={
      <ErrorState message={t('errors.generic')} />
    } />
  }

  const body = editorQuery.isPending ? (
    <div className="flex h-full min-h-[320px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ) : editorQuery.isError ? (
    <ErrorState message={apiErrorMessage(editorQuery.error)} />
  ) : !description ? null : !placementMode && !identifyMode ? (
    <ErrorState
      message={
        description.unavailable_code
          ? t(`signaturePlacement.unavailable.${description.unavailable_code}`, {
              defaultValue: t('signaturePlacement.unavailable.default'),
            })
          : t('signaturePlacement.unavailable.default')
      }
    />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
      <div
        className="flex flex-1 justify-center overflow-auto rounded-xl border border-hairline bg-surface p-4"
        style={{ direction: 'ltr' }}
      >
        <div className="w-full max-w-[640px]">
          {placementMode && selected && draft ? (
            <PlacementCanvas
              key={previewKey}
              documentId={documentId}
              description={description}
              selected={selected}
              draft={draft}
              onDraftChange={setDraft}
              canAdjust={description.can_adjust}
              saving={moveMutation.isPending}
              onReadyChange={handlePreviewReadyChange}
            />
          ) : (
            <DocPdfCanvas pdfUrl={api.documentDownloadUrl(documentId, 'pdf')} />
          )}
        </div>
      </div>

      <aside
        dir={isAr ? 'rtl' : 'ltr'}
        className="flex w-full shrink-0 flex-col gap-4 overflow-auto md:w-[300px]"
      >
        {placementMode && signatures.length > 1 && (
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-hairline bg-surface p-2">
            {signatures.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[0.78em] font-medium',
                  s.id === selected?.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`signaturePlacement.role.${s.role}`)}
              </button>
            ))}
          </div>
        )}
        {placementMode && selected && draft && (
          <PlacementControls
            pages={description.pages}
            selected={selected}
            draft={draft}
            dirty={dirty}
            saving={moveMutation.isPending}
            previewReady={previewReady}
            onDraftChange={setDraft}
            onReset={resetToDefault}
            onSave={() => {
              if (previewReady) moveMutation.mutate()
            }}
            onCancel={goBack}
            canReset={
              selected.default_page != null && selected.default_x != null && selected.default_y != null
            }
          />
        )}

        {identifyMode && description.candidates && (
          <IdentifyPanel
            documentId={documentId}
            candidates={description.candidates}
            busy={identifyMutation.isPending}
            onIdentify={(id) => identifyMutation.mutate(id)}
          />
        )}

        {historyQuery.data && historyQuery.data.items.length > 0 && (
          <HistoryPanel items={historyQuery.data.items} />
        )}
      </aside>
    </div>
  )

  return (
    <PlacementShell
      isAr={isAr}
      onBack={goBack}
      title={t('signaturePlacement.title')}
      body={
        <>
          {body}
          <ConfirmDialog
            open={leaveConfirmOpen}
            onOpenChange={setLeaveConfirmOpen}
            title={t('signaturePlacement.unsavedTitle')}
            description={t('signaturePlacement.unsavedDesc')}
            confirmLabel={t('signaturePlacement.discard')}
            destructive
            onConfirm={() => navigate(-1)}
          />
        </>
      }
    />
  )
}

function PlacementShell({
  isAr,
  onBack,
  title,
  body,
}: {
  isAr: boolean
  onBack: () => void
  title: string
  body: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div dir={isAr ? 'rtl' : 'ltr'} className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3 md:px-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className={cn('h-4 w-4', isAr && 'rotate-180')} />
          {t('signaturePlacement.back')}
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold tracking-tight text-foreground">{title}</h1>
          <p className="text-[0.78em] text-muted-foreground">{t('signaturePlacement.scopeNote')}</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6">{body}</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center px-4 text-center text-[0.9em] text-muted-foreground">
      {message}
    </div>
  )
}

interface DragState {
  startDraft: Draft
  grabOffsetX: number
  grabOffsetY: number
  widthPx: number
  heightPx: number
}

function PlacementCanvas({
  documentId,
  description,
  selected,
  draft,
  onDraftChange,
  canAdjust,
  saving,
  onReadyChange,
}: {
  documentId: number
  description: SignatureEditorRead
  selected: SignatureRead
  draft: Draft
  onDraftChange: (draft: Draft) => void
  canAdjust: boolean
  saving: boolean
  onReadyChange: (ready: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const pagesRef = useRef<PageBox[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pdfReady, setPdfReady] = useState(false)
  const [retryToken, setRetryToken] = useState(0)

  // Same render-time key-reset pattern as the page's draftKey: a manual
  // Retry (retryToken bump) must read as 'loading' immediately, not for one
  // extra frame with the previous 'error' state — so this resets during
  // render rather than as a synchronous setState at the top of the effect.
  const requestKey = `${documentId}:${selected.id}:${description.signature_revision}:${retryToken}`
  const [lastRequestKey, setLastRequestKey] = useState(requestKey)
  if (requestKey !== lastRequestKey) {
    setLastRequestKey(requestKey)
    setImageState('loading')
    setImageUrl(null)
  }

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    api
      .fetchSignatureImageBlob(documentId, selected.id, description.signature_revision)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setImageState('error')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [documentId, selected.id, description.signature_revision, retryToken])

  // Mirror DocPdfCanvas's own onReady-ref pattern: report readiness through a
  // ref so the effect doesn't need `onReadyChange` (a fresh closure every
  // parent render) in its dependency array.
  const onReadyChangeRef = useRef(onReadyChange)
  useEffect(() => {
    onReadyChangeRef.current = onReadyChange
  }, [onReadyChange])
  const previewReady = pdfReady && imageState === 'ready'
  useEffect(() => {
    onReadyChangeRef.current(previewReady)
  }, [previewReady])

  const interactive = canAdjust && previewReady && !saving

  const backgroundUrl = api.signatureEditorBackgroundUrl(
    documentId,
    selected.id,
    description.signature_revision,
  )

  function pointFromEvent(e: React.PointerEvent): { cx: number; cy: number } | null {
    const root = rootRef.current
    if (!root) return null
    const r = root.getBoundingClientRect()
    return { cx: e.clientX - r.left, cy: e.clientY - r.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!interactive) return
    const imgRect = e.currentTarget.getBoundingClientRect()
    dragRef.current = {
      startDraft: draft,
      grabOffsetX: e.clientX - imgRect.left,
      grabOffsetY: e.clientY - imgRect.top,
      widthPx: imgRect.width,
      heightPx: imgRect.height,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    const point = pointFromEvent(e)
    if (!d || !point) return
    const box = pageAtPoint(pagesRef.current, point.cx, point.cy)
    if (!box) return
    const pos = dragToPosition(box, point.cx, point.cy, d.grabOffsetX, d.grabOffsetY, d.widthPx, d.heightPx)
    onDraftChange({ page: box.page, x: pos.x, y: pos.y })
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const point = pointFromEvent(e)
    const box = point ? pageAtPoint(pagesRef.current, point.cx, point.cy) : null
    if (!box) onDraftChange(d.startDraft) // dropped between pages — cancel
    dragRef.current = null
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!interactive) return
    const page = description.pages.find((p) => p.page === draft.page)
    if (!page) return
    const stepPt = e.shiftKey ? 10 : 1
    let dx = 0
    let dy = 0
    if (e.key === 'ArrowLeft') dx = -stepPt
    else if (e.key === 'ArrowRight') dx = stepPt
    else if (e.key === 'ArrowUp') dy = -stepPt
    else if (e.key === 'ArrowDown') dy = stepPt
    else return
    e.preventDefault()
    onDraftChange({
      page: draft.page,
      x: Math.max(0, Math.min(1, draft.x + dx / page.width_pt)),
      y: Math.max(0, Math.min(1, draft.y + dy / page.height_pt)),
    })
  }

  return (
    <div className="relative">
      <DocPdfCanvas
        pdfUrl={backgroundUrl}
        onReady={() => setPdfReady(true)}
        renderOverlay={(pages) => {
          pagesRef.current = pages
          const box = pages.find((p) => p.page === draft.page)
          const pageInfo = description.pages.find((p) => p.page === draft.page)
          if (!box || !pageInfo || selected.width_pt == null || selected.height_pt == null) return null
          const rect = placeSignature(
            box,
            draft.x,
            draft.y,
            selected.width_pt,
            selected.height_pt,
            pageInfo.width_pt,
            pageInfo.height_pt,
          )
          return (
            <div ref={rootRef} className="pointer-events-none absolute inset-0">
              <div
                role="img"
                aria-label={t('signaturePlacement.signatureLabel')}
                tabIndex={interactive ? 0 : -1}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onKeyDown={onKeyDown}
                className={cn(
                  'pointer-events-auto absolute touch-none rounded-sm',
                  previewReady && 'ring-2 ring-primary/70',
                  interactive &&
                    'cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing',
                )}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              >
                {imageUrl && imageState !== 'error' && (
                  <img
                    src={imageUrl}
                    alt=""
                    draggable={false}
                    className="h-full w-full select-none object-contain"
                    onLoad={(e) => {
                      const img = e.currentTarget
                      setImageState(img.naturalWidth > 0 && img.naturalHeight > 0 ? 'ready' : 'error')
                    }}
                    onError={() => setImageState('error')}
                  />
                )}
              </div>
            </div>
          )
        }}
      />
      {pdfReady && imageState === 'loading' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <span
            role="status"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('signaturePlacement.previewLoading')}
          </span>
        </div>
      )}
      {pdfReady && imageState === 'error' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-4">
          <div
            role="alert"
            className="pointer-events-auto flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{t('signaturePlacement.previewFailed')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => setRetryToken((n) => n + 1)}
            >
              {t('common.retry')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function PlacementControls({
  pages,
  selected,
  draft,
  dirty,
  saving,
  previewReady,
  onDraftChange,
  onReset,
  onSave,
  onCancel,
  canReset,
}: {
  pages: SignatureEditorRead['pages']
  selected: SignatureRead
  draft: Draft
  dirty: boolean
  saving: boolean
  previewReady: boolean
  onDraftChange: (draft: Draft) => void
  onReset: () => void
  onSave: () => void
  onCancel: () => void
  canReset: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const page = pages.find((p) => p.page === draft.page)
  const leftMm = page ? ptToMm(draft.x * page.width_pt) : 0
  const topMm = page ? ptToMm(draft.y * page.height_pt) : 0

  function setLeftMm(mm: number): void {
    if (!page || page.width_pt <= 0) return
    onDraftChange({ ...draft, x: Math.max(0, Math.min(1, mmToPt(mm) / page.width_pt)) })
  }

  function setTopMm(mm: number): void {
    if (!page || page.height_pt <= 0) return
    onDraftChange({ ...draft, y: Math.max(0, Math.min(1, mmToPt(mm) / page.height_pt)) })
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1 text-[0.78em] font-medium text-muted-foreground">
          {t('signaturePlacement.page')}
          <Select
            value={String(draft.page)}
            onValueChange={(v) => onDraftChange({ ...draft, page: Number(v) })}
            disabled={!previewReady || saving}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.page} value={String(p.page)}>
                  {p.page}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[0.78em] font-medium text-muted-foreground">
          {t('signaturePlacement.left')}
          <Input
            type="number"
            inputMode="decimal"
            step="0.5"
            dir="ltr"
            value={leftMm.toFixed(1)}
            disabled={!previewReady || saving}
            onChange={(e) => setLeftMm(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.78em] font-medium text-muted-foreground">
          {t('signaturePlacement.top')}
          <Input
            type="number"
            inputMode="decimal"
            step="0.5"
            dir="ltr"
            value={topMm.toFixed(1)}
            disabled={!previewReady || saving}
            onChange={(e) => setTopMm(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canReset || !previewReady || saving}
          onClick={onReset}
        >
          {t('signaturePlacement.reset')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saving || !previewReady}
          onClick={onSave}
          className="ms-auto"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('signaturePlacement.save')}
        </Button>
      </div>
      {selected.role && (
        <p className="mt-3 text-[0.72em] text-muted-foreground">
          {t(`signaturePlacement.role.${selected.role}`)}
        </p>
      )}
    </div>
  )
}

function IdentifyPanel({
  documentId,
  candidates,
  busy,
  onIdentify,
}: {
  documentId: number
  candidates: LegacyCandidateRead[]
  busy: boolean
  onIdentify: (candidateId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [pending, setPending] = useState<string | null>(null)

  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <h2 className="mb-1 text-sm font-bold text-foreground">{t('signaturePlacement.identify')}</h2>
      <p className="mb-3 text-[0.76em] text-muted-foreground">{t('signaturePlacement.identifyHint')}</p>
      <div className="flex flex-col gap-2">
        {candidates.map((c) => (
          <button
            key={c.candidate_id}
            type="button"
            disabled={busy}
            onClick={() => setPending(c.candidate_id)}
            className="flex items-center gap-3 rounded-lg border border-hairline p-2 text-start hover:bg-muted disabled:opacity-50"
          >
            <CandidateThumb documentId={documentId} candidateId={c.candidate_id} />
            <span className="text-[0.78em] text-muted-foreground">
              {t('signaturePlacement.candidateSize', {
                w: Math.round(c.width_emu / 9525),
                h: Math.round(c.height_emu / 9525),
              })}
            </span>
          </button>
        ))}
      </div>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('signaturePlacement.identifyConfirmTitle')}
        description={t('signaturePlacement.identifyConfirmDesc')}
        confirmLabel={t('signaturePlacement.identify')}
        onConfirm={() => {
          if (pending) onIdentify(pending)
          setPending(null)
        }}
      />
    </div>
  )
}

function CandidateThumb({
  documentId,
  candidateId,
}: {
  documentId: number
  candidateId: string
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    api
      .fetchSignatureCandidateImageBlob(documentId, candidateId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [documentId, candidateId])
  return (
    <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-surface-raised">
      {url ? (
        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </span>
  )
}

function HistoryPanel({
  items,
}: {
  items: SignatureHistoryItemRead[]
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-foreground">
        <HistoryIcon className="h-3.5 w-3.5" />
        {t('signaturePlacement.history')}
      </h2>
      <ol className="flex flex-col gap-2.5">
        {[...items].reverse().map((item) => (
          <li key={item.revision} className="text-[0.78em]">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              {item.action === 'move' && <Check className="h-3 w-3 text-success" />}
              {t(`signaturePlacement.historyAction.${item.action}`)}
              {item.before_geometry && item.after_geometry && (
                <span className="text-muted-foreground">
                  {t('signaturePlacement.historyPages', {
                    from: item.before_geometry.page,
                    to: item.after_geometry.page,
                  })}
                </span>
              )}
            </div>
            <div className="text-muted-foreground">{fmt.format(new Date(item.created_at))}</div>
            {(item.pdf_download_url || item.docx_download_url) && (
              <div className="mt-0.5 flex gap-2">
                {item.pdf_download_url && (
                  <a href={item.pdf_download_url} className="text-primary hover:underline">
                    PDF
                  </a>
                )}
                {item.docx_download_url && (
                  <a href={item.docx_download_url} className="text-primary hover:underline">
                    DOCX
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
