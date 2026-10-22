import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Folder, FolderArchive, FolderCheck, FolderInput, FolderOutput, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { BookFolderRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'
import { useInboxSummary } from '@/pages/books/useInboxCount'
import { FolderButton } from './outlook/FolderRail'
import { BOOK_DRAG_TYPE, toastFolderError, useBookFolders } from './useBookFolders'

export type Scope = 'incoming' | 'done' | 'outgoing' | 'archived'
const SCOPES: readonly Scope[] = ['incoming', 'done', 'outgoing', 'archived']
const SCOPE_ICONS = {
  incoming: FolderInput,
  done: FolderCheck,
  outgoing: FolderOutput,
  archived: FolderArchive,
}
const KEY = 'ledger.booksDesk.folders'
const ACTION_CLASS = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rail-text hover:bg-rail-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

type FolderEdit = { id: number | null; name: string; team: boolean }

export function ScopeIcon({ scope, className }: { scope: Scope; className?: string }): React.JSX.Element {
  const Icon = SCOPE_ICONS[scope]
  return <Icon className={cn('h-4 w-4 shrink-0', (scope === 'incoming' || scope === 'outgoing') && 'rtl:-scale-x-100', className)} strokeWidth={1.8} aria-hidden />
}


function FolderNameEditor({ name, pending, onChange, onSave, onCancel }: {
  name: string
  pending: boolean
  onChange: (name: string) => void
  onSave: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const hintId = useId()
  const valid = name.trim().length >= 1 && name.trim().length <= 80
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
        value={name}
        maxLength={80}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        className="h-8 min-w-0 text-[0.8em]"
      />
      <p id={hintId} className="text-[0.7em] leading-relaxed text-rail-text">{t(`${KEY}.nameHint`)}</p>
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
  const folders = useBookFolders()
  const summary = useInboxSummary()
  const isMobile = useIsMobile()
  const [editor, setEditor] = useState<FolderEdit | null>(null)
  const [deleting, setDeleting] = useState<BookFolderRead | null>(null)
  // A desk row is being dragged: every folder shows it accepts the drop.
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const canCreateTeam = user?.role === 'admin' || user?.role === 'manager'

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
      ? api.createBookFolder({ name: edit.name.trim(), team: edit.team })
      : api.renameBookFolder(edit.id, edit.name.trim()),
    onSuccess: (_folder, edit) => {
      invalidateFolders()
      closeEditor()
      toast.success(t(`${KEY}.${edit.id === null ? 'created' : 'renamed'}`))
    },
    onError: (error) => toastFolderError(t, error, `${KEY}.saveError`),
  })
  const deleteMutation = useMutation({
    mutationFn: (folder: BookFolderRead) => api.deleteBookFolder(folder.id),
    onSuccess: (_result, folder) => {
      invalidateFolders()
      if (folderId === folder.id) onSelectScope('incoming')
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
    const start = (event: globalThis.DragEvent): void => { if (event.dataTransfer?.types.includes(BOOK_DRAG_TYPE)) setDragging(true) }
    const end = (): void => { setDragging(false); setDropTarget(null) }
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
    // Enter and over both claim the drop; Chromium can go quiet on dragover while the pointer rests.
    const over = (event: DragEvent<HTMLDivElement>): void => {
      // Only book rows are droppable; files or text dragged over the rail are ignored.
      if (!event.dataTransfer.types.includes(BOOK_DRAG_TYPE)) return
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
        event.preventDefault()
        const bookId = Number(event.dataTransfer.getData(BOOK_DRAG_TYPE))
        if (bookId) fileMutation.mutate({ bookId, folder })
      },
    }
  }
  const pending = saveMutation.isPending || deleteMutation.isPending

  function renderEditor(): ReactNode {
    if (!editor) return null
    return <FolderNameEditor
      key={editor.id ?? `new-${editor.team}`}
      name={editor.name}
      pending={pending}
      onChange={(name) => setEditor({ ...editor, name })}
      onCancel={closeEditor}
      onSave={() => {
        const length = editor.name.trim().length
        if (length >= 1 && length <= 80 && !pending) saveMutation.mutate(editor)
      }}
    />
  }

  return (
    <nav ref={navRef} dir={i18n.dir()} aria-label={t(`${KEY}.navigation`)} className="flex h-full min-h-0 w-[236px] shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-rail-line bg-rail p-3 text-rail-text">
      {switcher ? <div className="mb-3">{switcher}</div> : null}
      {SCOPES.map((value) => <FolderButton
        key={value}
        icon={<ScopeIcon scope={value} />}
        label={t(`ledger.booksDesk.${value}`)}
        active={folderId === null && scope === value}
        badge={value === 'incoming' && (summary.data?.unread ?? 0) > 0 ? summary.data?.unread : undefined}
        onClick={() => onSelectScope(value)}
      />)}
      <div className="mx-1 my-3 h-px shrink-0 bg-rail-line" aria-hidden />
      {folders.isError ? (
        <div role="alert" className="mb-2 space-y-2 rounded-md bg-rail-2 px-2.5 py-2 text-[0.78em]">
          <p>{t(`${KEY}.loadError`)}</p>
          <button type="button" disabled={folders.isFetching} onClick={() => void folders.refetch()} className="rounded px-1 py-0.5 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{t('ledger.booksDesk.retry')}</button>
        </div>
      ) : null}
      {[false, true].map((team) => {
        const sectionFolders = (folders.data ?? []).filter((folder) => folder.team === team)
        const title = t(`${KEY}.${team ? 'team' : 'personal'}`)
        return (
          <section key={String(team)} aria-label={title} className="mb-3 space-y-0.5">
            <div className="flex min-h-8 items-center justify-between gap-2 px-2">
              <h3 className="text-[0.7em] font-semibold text-rail-faint">{title}</h3>
              {!team || canCreateTeam ? <button
                type="button"
                className={ACTION_CLASS}
                aria-label={t(`${KEY}.${team ? 'addTeam' : 'addPersonal'}`)}
                title={t(`${KEY}.${team ? 'addTeam' : 'addPersonal'}`)}
                disabled={pending}
                onClick={(event) => {
                  editorReturnRef.current = event.currentTarget
                  setEditor({ id: null, name: '', team })
                }}
              ><Plus className="h-4 w-4" strokeWidth={1.8} aria-hidden /></button> : null}
            </div>
            {editor?.id === null && editor.team === team ? renderEditor() : null}
            {folders.isPending ? <div className="space-y-2 px-2 py-2" aria-label={t('common.loading')} aria-busy="true"><Skeleton className="h-5 w-4/5 bg-rail-2" /><Skeleton className="h-5 w-3/5 bg-rail-2" /></div> : null}
            {folders.isSuccess && sectionFolders.length === 0 ? <p className="px-2.5 py-1.5 text-[0.72em] leading-relaxed text-rail-faint">{t(`${KEY}.${team ? 'emptyTeam' : isMobile ? 'emptyPersonalTouch' : 'emptyPersonal'}`)}</p> : null}
            {sectionFolders.map((folder) => (
              <div key={folder.id} data-folder-id={folder.id}>
                {editor?.id === folder.id ? renderEditor() : (
                  <div {...dropHandlers(folder)} className={cn(
                    'flex min-w-0 items-center gap-0.5 rounded-md transition-colors',
                    dragging && 'outline-1 -outline-offset-1 outline-dashed outline-rail-line',
                    dropTarget === folder.id && 'bg-rail-2 outline-solid outline-rail-faint',
                  )}>
                    <div className="min-w-0 flex-1">
                      <FolderButton icon={<Folder className="h-4 w-4" strokeWidth={1.8} aria-hidden />} label={folder.name} active={folderId === folder.id} count={folder.count} onClick={() => onSelectFolder(folder.id)} />
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
                          setEditor({ id: folder.id, name: folder.name, team: folder.team })
                        }}><Pencil className="h-3.5 w-3.5" aria-hidden /><span>{t(`${KEY}.rename`)}</span></DropdownMenuItem>
                        <DropdownMenuItem variant="danger" disabled={pending} onSelect={() => {
                          deleteReturnRef.current = navRef.current?.querySelector<HTMLButtonElement>(`[data-folder-id="${folder.id}"] button`) ?? null
                          setDeleting(folder)
                        }}><Trash2 className="h-3.5 w-3.5" aria-hidden /><span>{t(`${KEY}.delete`)}</span></DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu> : null}
                  </div>
                )}
              </div>
            ))}
          </section>
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
  )
}
