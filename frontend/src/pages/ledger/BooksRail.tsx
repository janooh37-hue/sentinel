import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Folder, FolderArchive, FolderCheck, FolderInput, FolderOutput, FolderUsers, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import type { BookFolderBox, BookFolderRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'
import { useInboxSummary } from '@/pages/books/useInboxCount'
import { FolderButton } from './outlook/FolderRail'
import { BOOK_DRAG_TYPE, FOLDER_BOXES, draggedBookBox, sharedAudience, toastFolderError, useBookFolders } from './useBookFolders'

export type Scope = BookFolderBox
const SCOPE_ICONS = {
  incoming: FolderInput,
  done: FolderCheck,
  outgoing: FolderOutput,
  archived: FolderArchive,
}
const KEY = 'ledger.booksDesk.folders'
const ACTION_CLASS = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rail-text hover:bg-rail-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

type FolderEdit = { id: number | null; name: string; box: Scope; team: boolean }

export function ScopeIcon({ scope, className }: { scope: Scope; className?: string }): React.JSX.Element {
  const Icon = SCOPE_ICONS[scope]
  return <Icon className={cn('h-4 w-4 shrink-0', (scope === 'incoming' || scope === 'outgoing') && 'rtl:-scale-x-100', className)} strokeWidth={1.8} aria-hidden />
}

/** A shared (team) folder's glyph; personal folders use the plain `Folder`. */
export function FolderGlyph({ team, className }: { team: boolean; className?: string }): React.JSX.Element {
  const Icon = team ? FolderUsers : Folder
  return <Icon className={cn('h-4 w-4 shrink-0', team && 'text-blue-grad-a', className)} strokeWidth={1.8} aria-hidden />
}

function FolderEditor({ edit, canShare, pending, onChange, onSave, onCancel }: {
  edit: FolderEdit
  /** Creating, as a manager: the folder may be shared with the team. */
  canShare: boolean
  pending: boolean
  onChange: (edit: FolderEdit) => void
  onSave: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const hintId = useId()
  const valid = edit.name.trim().length >= 1 && edit.name.trim().length <= 80
  return (
    <form
      className="space-y-2 rounded-md bg-rail-2 p-2"
      aria-label={t(`${KEY}.name`)}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && !pending) onSave()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (!pending) onCancel()
        }
        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
      }}
    >
      <Input
        autoFocus
        dir="auto"
        aria-label={t(`${KEY}.name`)}
        aria-describedby={hintId}
        placeholder={t(`${KEY}.new`)}
        value={edit.name}
        maxLength={80}
        disabled={pending}
        onChange={(event) => onChange({ ...edit, name: event.target.value })}
        onFocus={(event) => event.currentTarget.select()}
        className="h-8 min-w-0 text-[0.8em]"
      />
      <p id={hintId} className="text-[0.7em] leading-relaxed text-rail-text">{t(`${KEY}.nameHint`)}</p>
      {edit.id !== null ? (
        <label className="flex items-center gap-2 text-[0.75em]">
          <span className="shrink-0">{t(`${KEY}.box`)}</span>
          <select
            aria-label={t(`${KEY}.box`)}
            value={edit.box}
            disabled={pending}
            onChange={(event) => onChange({ ...edit, box: event.target.value as Scope })}
            className="h-7 min-w-0 flex-1 rounded-md border border-rail-line bg-rail px-1.5 text-rail-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FOLDER_BOXES.map((box) => <option key={box} value={box}>{t(`ledger.booksDesk.${box}`)}</option>)}
          </select>
        </label>
      ) : canShare ? (
        <label className="flex items-center gap-2 text-[0.75em]">
          <input type="checkbox" checked={edit.team} disabled={pending} onChange={(event) => onChange({ ...edit, team: event.target.checked })} className="h-3.5 w-3.5 accent-current" />
          <span>{t(`${KEY}.shareWithTeam`)}</span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-1.5 text-[0.75em]">
        <button type="submit" disabled={!valid || pending} className="rounded-md bg-rail-3 px-2.5 py-1 font-semibold text-rail-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">{t('common.save')}</button>
        <button type="button" disabled={pending} onClick={onCancel} className="rounded-md px-2.5 py-1 text-rail-text hover:bg-rail-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">{t('common.cancel')}</button>
      </div>
    </form>
  )
}

export function BooksRail({ scope, folderId, switcher, onSelectScope, onSelectFolder }: {
  scope: Scope | null
  folderId: number | null
  switcher?: ReactNode
  onSelectScope: (scope: Scope) => void
  onSelectFolder: (id: number) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const navRef = useRef<HTMLElement>(null)
  const editorReturnRef = useRef<HTMLButtonElement | null>(null)
  const deleteReturnRef = useRef<HTMLButtonElement | null>(null)
  const skipMenuFocusRef = useRef(false)
  const groupId = useId()
  const folders = useBookFolders()
  const summary = useInboxSummary()
  const isMobile = useIsMobile()
  const [editor, setEditor] = useState<FolderEdit | null>(null)
  const [deleting, setDeleting] = useState<BookFolderRead | null>(null)
  // Chevron choices; a box without one is open only while it (or one of its folders) is selected.
  const [toggled, setToggled] = useState<Partial<Record<Scope, boolean>>>({})
  // The box a dragged desk row came from: only that box's folders accept the drop.
  const [dragBox, setDragBox] = useState<Scope | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const canCreateTeam = user?.role === 'admin' || user?.role === 'manager'
  const activeBox = folders.data?.find((folder) => folder.id === folderId)?.box ?? scope
  const isOpen = (box: Scope): boolean => toggled[box] ?? box === activeBox

  function invalidateFolders(): void {
    void qc.invalidateQueries({ queryKey: ['books', 'folders'] })
    void qc.invalidateQueries({ queryKey: ['books', 'routing'] })
  }
  function closeEditor(): void {
    setEditor(null)
    const id = editor?.id
    requestAnimationFrame(() => {
      if (id != null) navRef.current?.querySelector<HTMLButtonElement>(`[data-folder-id="${id}"] button`)?.focus()
      else editorReturnRef.current?.focus()
    })
  }
  const saveMutation = useMutation({
    mutationFn: (edit: FolderEdit) => edit.id === null
      ? api.createBookFolder({ name: edit.name.trim(), box: edit.box, team: edit.team })
      : api.updateBookFolder(edit.id, { name: edit.name.trim(), box: edit.box }),
    onSuccess: (folder, edit) => {
      invalidateFolders()
      closeEditor()
      // A moved folder opens its new box so it stays in view.
      setToggled((current) => ({ ...current, [folder.box]: true }))
      const moved = edit.id !== null && folders.data?.find((row) => row.id === edit.id)?.box !== edit.box
      toast.success(t(`${KEY}.${edit.id === null ? 'created' : moved ? 'moved' : 'renamed'}`))
    },
    onError: (error) => toastFolderError(t, error, `${KEY}.saveError`),
  })
  const deleteMutation = useMutation({
    mutationFn: (folder: BookFolderRead) => api.deleteBookFolder(folder.id),
    onSuccess: (_result, folder) => {
      invalidateFolders()
      if (folderId === folder.id) onSelectScope(folder.box)
      toast.success(t(`${KEY}.deleted`))
    },
    onError: (error) => toastFolderError(t, error, `${KEY}.deleteError`),
  })
  const fileMutation = useMutation({
    mutationFn: ({ bookId, folder }: { bookId: number; folder: BookFolderRead }) => api.addBookToFolder(bookId, folder.id),
    onSuccess: (_result, { folder }) => {
      invalidateFolders()
      toast.success(t(`${KEY}.filedInto`, { name: folder.name }))
    },
    onError: (error) => toastFolderError(t, error, `${KEY}.fileError`),
  })
  useEffect(() => {
    const start = (event: globalThis.DragEvent): void => { setDragBox(draggedBookBox(event.dataTransfer?.types ?? [])) }
    const end = (): void => { setDragBox(null); setDropTarget(null) }
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [])
  function dropHandlers(folder: BookFolderRead) {
    const accepts = dragBox === folder.box
    // Enter and over both claim the drop; Chromium can go quiet on dragover while the pointer rests.
    const over = (event: DragEvent<HTMLDivElement>): void => {
      // Only book rows are droppable; files or text dragged over the rail are ignored.
      if (!event.dataTransfer.types.includes(BOOK_DRAG_TYPE)) return
      if (!accepts) {
        // Not cancelling the event refuses the drop; the browser shows not-allowed.
        event.dataTransfer.dropEffect = 'none'
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDropTarget(folder.id)
    }
    return {
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        // Chromium reports no relatedTarget while dragging between children, so test the pointer.
        const box = event.currentTarget.getBoundingClientRect()
        const inside = event.clientX > box.left && event.clientX < box.right && event.clientY > box.top && event.clientY < box.bottom
        if (!inside) setDropTarget((id) => id === folder.id ? null : id)
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!accepts) return
        event.preventDefault()
        const bookId = Number(event.dataTransfer.getData(BOOK_DRAG_TYPE))
        if (bookId) fileMutation.mutate({ bookId, folder })
      },
    }
  }
  const pending = saveMutation.isPending || deleteMutation.isPending

  function renderEditor(): ReactNode {
    if (!editor) return null
    return <FolderEditor
      key={editor.id ?? `new-${editor.box}`}
      edit={editor}
      canShare={canCreateTeam}
      pending={pending}
      onChange={setEditor}
      onCancel={closeEditor}
      onSave={() => {
        const length = editor.name.trim().length
        if (length >= 1 && length <= 80 && !pending) saveMutation.mutate(editor)
      }}
    />
  }

  function renderFolder(folder: BookFolderRead): ReactNode {
    if (editor?.id === folder.id) return <div key={folder.id} data-folder-id={folder.id}>{renderEditor()}</div>
    const drop = dragBox === null ? undefined : dropTarget === folder.id ? 'target' : dragBox === folder.box ? 'open' : 'refused'
    const label = folder.team ? t(`${KEY}.sharedName`, { name: folder.name }) : folder.name
    const button = (
      <button
        type="button"
        onClick={() => onSelectFolder(folder.id)}
        aria-current={folderId === folder.id ? 'page' : undefined}
        aria-label={`${label} ${folder.count}`}
        className={cn(
          'flex min-w-0 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-[0.82em] transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          folderId === folder.id ? 'bg-rail-3 font-semibold text-white' : cn('text-rail-text hover:bg-rail-2', folder.team && 'bg-blue-grad-a/10'),
        )}
      >
        <FolderGlyph team={folder.team} />
        <span className="flex-1 truncate" dir="auto">{folder.name}</span>
        <span className="flex-none font-mono text-[0.78em] tabular-nums text-rail-faint">{folder.count}</span>
      </button>
    )
    return (
      <div key={folder.id} data-folder-id={folder.id}>
        <div {...dropHandlers(folder)} data-drop={drop} className={cn(
          'flex min-w-0 items-center gap-0.5 rounded-md transition-colors motion-reduce:transition-none',
          drop === 'open' && 'outline-1 -outline-offset-1 outline-dashed outline-rail-line',
          drop === 'target' && 'bg-rail-2 outline-solid outline-rail-faint',
          drop === 'refused' && 'cursor-not-allowed opacity-50',
        )}>
          <div className="min-w-0 flex-1">
            {folder.team ? (
              <Tooltip>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side={i18n.dir() === 'rtl' ? 'left' : 'right'} className="max-w-64 break-words">{sharedAudience(t, i18n.language, folder)}</TooltipContent>
              </Tooltip>
            ) : button}
          </div>
          {folder.can_manage ? <DropdownMenu dir={i18n.dir()}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ACTION_CLASS} disabled={pending} aria-label={t(`${KEY}.actions`, { name: folder.name })} title={t(`${KEY}.actions`, { name: folder.name })}><MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
              if (skipMenuFocusRef.current) event.preventDefault()
              skipMenuFocusRef.current = false
            }}>
              <DropdownMenuItem disabled={pending} onSelect={() => {
                skipMenuFocusRef.current = true
                setEditor({ id: folder.id, name: folder.name, box: folder.box, team: folder.team })
              }}><Pencil className="h-3.5 w-3.5" aria-hidden /><span>{t(`${KEY}.rename`)}</span></DropdownMenuItem>
              <DropdownMenuItem variant="danger" disabled={pending} onSelect={() => {
                deleteReturnRef.current = navRef.current?.querySelector<HTMLButtonElement>(`[data-folder-id="${folder.id}"] button`) ?? null
                setDeleting(folder)
              }}><Trash2 className="h-3.5 w-3.5" aria-hidden /><span>{t(`${KEY}.delete`)}</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> : null}
        </div>
      </div>
    )
  }

  const collator = new Intl.Collator(i18n.language)
  return (
    <TooltipProvider>
      <nav ref={navRef} dir={i18n.dir()} aria-label={t(`${KEY}.navigation`)} className="flex h-full min-h-0 w-[236px] shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-rail-line bg-rail p-3 text-rail-text">
        {switcher ? <div className="mb-3">{switcher}</div> : null}
        {folders.isError ? (
          <div role="alert" className="mb-2 space-y-2 rounded-md bg-rail-2 px-2.5 py-2 text-[0.78em]">
            <p>{t(`${KEY}.loadError`)}</p>
            <button type="button" disabled={folders.isFetching} onClick={() => void folders.refetch()} className="rounded px-1 py-0.5 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{t('ledger.booksDesk.retry')}</button>
          </div>
        ) : null}
        {FOLDER_BOXES.map((box) => {
          const boxLabel = t(`ledger.booksDesk.${box}`)
          const open = isOpen(box)
          const boxFolders = (folders.data ?? []).filter((folder) => folder.box === box).sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
          const creating = editor?.id === null && editor.box === box
          return (
            <div key={box} className="space-y-0.5">
              <div className="flex min-w-0 items-center gap-0.5">
                <div className="min-w-0 flex-1">
                  <FolderButton
                    icon={<ScopeIcon scope={box} />}
                    label={boxLabel}
                    active={folderId === null && scope === box}
                    badge={box === 'incoming' && (summary.data?.unread ?? 0) > 0 ? summary.data?.unread : undefined}
                    onClick={() => {
                      setToggled({ [box]: true })
                      onSelectScope(box)
                    }}
                  />
                </div>
                <button
                  type="button"
                  className={ACTION_CLASS}
                  aria-expanded={open}
                  aria-controls={`${groupId}-${box}`}
                  aria-label={t(`${KEY}.inBox`, { box: boxLabel })}
                  title={t(`${KEY}.inBox`, { box: boxLabel })}
                  onClick={() => setToggled((current) => ({ ...current, [box]: !open }))}
                ><ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', !open && '-rotate-90 rtl:rotate-90')} strokeWidth={1.8} aria-hidden /></button>
                <button
                  type="button"
                  className={ACTION_CLASS}
                  aria-label={t(`${KEY}.newInBox`, { box: boxLabel })}
                  title={t(`${KEY}.newInBox`, { box: boxLabel })}
                  disabled={pending}
                  onClick={(event) => {
                    editorReturnRef.current = event.currentTarget
                    setToggled((current) => ({ ...current, [box]: true }))
                    setEditor({ id: null, name: '', box, team: false })
                  }}
                ><Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden /></button>
              </div>
              {open ? (
                <div id={`${groupId}-${box}`} role="group" aria-label={t(`${KEY}.inBox`, { box: boxLabel })} className="space-y-0.5 pb-1 ps-4">
                  {creating ? renderEditor() : null}
                  {folders.isPending ? <div className="space-y-2 px-2 py-1" aria-label={t('common.loading')} aria-busy="true"><Skeleton className="h-5 w-4/5 bg-rail-2" /></div> : null}
                  {folders.isSuccess && boxFolders.length === 0 && !creating ? <p className="px-2.5 py-1 text-[0.72em] leading-relaxed text-rail-faint">{t(`${KEY}.${isMobile ? 'emptyBoxTouch' : 'emptyBox'}`)}</p> : null}
                  {boxFolders.map(renderFolder)}
                </div>
              ) : null}
            </div>
          )
        })}
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => { if (!open) setDeleting(null) }}
          title={t(`${KEY}.deleteTitle`, { name: deleting?.name ?? '' })}
          description={t(`${KEY}.deleteBody`, { name: deleting?.name ?? '' })}
          confirmLabel={t(`${KEY}.delete`)}
          destructive
          returnFocusRef={deleteReturnRef}
          onConfirm={() => { if (deleting && !pending) deleteMutation.mutate(deleting) }}
        />
      </nav>
    </TooltipProvider>
  )
}
