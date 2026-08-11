import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  FileStack,
  FileText,
  GripVertical,
  Info,
  Loader2,
  LockKeyhole,
  History,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiErrorMessage } from '@/lib/api'
import type { IncludedPaperRead, IncludedPapersHistoryRead } from '@/lib/api'
import { formatBytes } from '@/lib/fileTypes'
import { cn } from '@/lib/utils'

import type { EditableIncludedPaper } from './includedPapersState'
import { useIncludedPapersEditor } from './useIncludedPapersEditor'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

export interface IncludedPapersDialogBook {
  id: number
  ref_number: string
  subject?: string | null
  approval_state: string
  included_papers_revision: number
  included_papers_fixed_page_count: number
  included_papers_history?: IncludedPapersHistoryRead[]
  included_papers_total_page_count: number
  included_papers?: IncludedPaperRead[]
}

export interface IncludedPapersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  book: IncludedPapersDialogBook
  currentPdfUrl: string
}

export function IncludedPapersDialog({
  open,
  onOpenChange,
  book,
  currentPdfUrl,
}: IncludedPapersDialogProps): React.JSX.Element {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {open && (
        <IncludedPapersWorkspace
          key={`${book.id}-${book.included_papers_revision}`}
          book={book}
          currentPdfUrl={currentPdfUrl}
          onCancel={() => onOpenChange(false)}
          onSaved={() => onOpenChange(false)}
        />
      )}
    </DialogRoot>
  )
}

function IncludedPapersWorkspace({
  book,
  currentPdfUrl,
  onCancel,
  onSaved,
}: {
  book: IncludedPapersDialogBook
  currentPdfUrl: string
  onCancel: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const editor = useIncludedPapersEditor(book)
  const listSeparator = i18n.language.startsWith('ar') ? '، ' : ', '
  const [mobileTab, setMobileTab] = useState<'preview' | 'order'>('preview')
  const [discardOpen, setDiscardOpen] = useState(false)
  const addInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const replaceIdRef = useRef<string | null>(null)
  const preview = editor.state.preview
  const fixedPages = preview?.fixed_page_count ?? book.included_papers_fixed_page_count
  const totalPages = preview?.total_page_count ?? book.included_papers_total_page_count
  const fileCount = editor.state.items.length

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    try {
      await editor.addFiles(Array.from(files))
      setMobileTab('order')
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }

  const replacePaper = async (file: File | undefined): Promise<void> => {
    const id = replaceIdRef.current
    replaceIdRef.current = null
    if (!id || !file) return
    try {
      await editor.replacePaper(id, file)
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }

  const review = async (): Promise<void> => {
    try {
      await editor.previewPackage()
      setMobileTab('preview')
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }

  const save = async (): Promise<void> => {
    try {
      await editor.savePackage()
      toast.success(
        t('books.includedPapers.saved', { defaultValue: 'Combined PDF saved' }),
      )
      onSaved()
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }
  const close = (): void => {
    if (editor.dirty) {
      setDiscardOpen(true)
    } else {
      onCancel()
    }
  }


  return (
    <DialogContent
      hideClose
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        close()
      }}
      onPointerDownOutside={(event) => {
        event.preventDefault()
        close()
      }}
      className="h-[100dvh] max-h-none max-w-none rounded-none border-0 sm:h-[min(90vh,860px)] sm:max-h-[calc(100vh-2rem)] sm:w-[min(96vw,1440px)] sm:rounded-2xl sm:border"
    >
      <DialogHeader className="relative min-h-[72px] flex-row items-center gap-3 border-b border-hairline px-4 py-3 pe-12 sm:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary-soft text-primary">
          <FileStack className="h-5 w-5" strokeWidth={1.7} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <DialogDescription className="flex min-w-0 items-center gap-2 text-[0.72em] font-medium">
            <span className="font-mono font-semibold text-foreground" dir="ltr">
              {book.ref_number}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate" dir="auto">
              {book.subject || t('books.record.title', { defaultValue: 'Record' })}
            </span>
          </DialogDescription>
          <DialogTitle className="mt-0.5 text-base sm:text-lg">
            {t('books.includedPapers.title', { defaultValue: 'Included papers' })}
          </DialogTitle>
        </span>
        <span className="hidden shrink-0 text-end sm:block">
          <strong className="block text-sm font-semibold text-foreground">
            {t('books.includedPapers.pages', {
              count: totalPages,
              defaultValue: '{{count}} pages',
            })}
          </strong>
          <span className="text-[0.72em] text-muted-foreground">
            {t('books.includedPapers.fileSummary', {
              count: fileCount,
              defaultValue: 'Form + {{count}} files',
            })}
          </span>
        </span>
      </DialogHeader>

      <div className="grid grid-cols-2 border-b border-hairline bg-surface px-3 py-2 md:hidden">
        {(['preview', 'order'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            aria-pressed={mobileTab === tab}
            className={cn(
              'rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mobileTab === tab
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'preview'
              ? t('books.includedPapers.previewTab', { defaultValue: 'Preview' })
              : t('books.includedPapers.orderTab', { defaultValue: 'PDF order' })}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
        <section
          aria-label={t('books.includedPapers.previewLabel', {
            defaultValue: 'Combined PDF preview',
          })}
          className={cn(
            'min-h-0 flex-col border-e border-hairline bg-surface-tinted/45',
            mobileTab === 'preview' ? 'flex' : 'hidden',
            'md:flex',
          )}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-hairline bg-surface/90 px-4">
            <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} aria-hidden />
              {t('books.includedPapers.combinedPreview', {
                defaultValue: 'Combined PDF preview',
              })}
            </span>
            <span className="font-mono text-[0.7em] text-muted-foreground">
              {t('books.includedPapers.pages', {
                count: totalPages,
                defaultValue: '{{count}} pages',
              })}
            </span>
          </div>
          <div className="relative min-h-0 flex-1 p-2 sm:p-3">
            <Suspense
              fallback={
                <div className="grid h-full place-items-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                </div>
              }
            >
              {preview ? (
                <DocPdfCanvas
                  pdfBase64={preview.pdf_base64}
                  sourceKey={editor.state.previewFingerprint ?? `preview-${preview.revision}`}
                />
              ) : (
                <DocPdfCanvas pdfUrl={currentPdfUrl} />
              )}
            </Suspense>
            {!preview && editor.state.items.some((paper) => paper.staged_token) && (
              <div className="pointer-events-none absolute inset-x-5 bottom-5 rounded-lg border border-primary/20 bg-surface/95 px-3 py-2 text-center text-xs text-foreground shadow-sm">
                {t('books.includedPapers.reviewHint', {
                  defaultValue: 'Review the PDF to see your changes before saving.',
                })}
              </div>
            )}
          </div>
        </section>

        <section
          aria-label={t('books.includedPapers.orderLabel', { defaultValue: 'PDF order' })}
          className={cn(
            'min-h-0 flex-col bg-surface',
            mobileTab === 'order' ? 'flex' : 'hidden',
            'md:flex',
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  {t('books.includedPapers.orderHeading', { defaultValue: 'PDF order' })}
                </h3>
                <p className="mt-1 max-w-sm text-[0.75em] leading-relaxed text-muted-foreground">
                  {t('books.includedPapers.orderHelp', {
                    defaultValue:
                      'The form stays first. Move complete files; their pages stay together.',
                  })}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => addInputRef.current?.click()}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {t('books.includedPapers.add', { defaultValue: 'Add papers' })}
              </Button>
            </div>

            <input
              ref={addInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              multiple
              className="hidden"
              aria-label={t('books.includedPapers.addInput', {
                defaultValue: 'Add PDF or images',
              })}
              onChange={(event) => {
                void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              aria-label={t('books.includedPapers.replaceInput', {
                defaultValue: 'Choose replacement PDF or image',
              })}
              onChange={(event) => {
                void replacePaper(event.target.files?.[0])
                event.target.value = ''
              }}
            />

            <div className="mt-4 overflow-hidden rounded-xl border border-hairline">
              <div className="flex items-center gap-3 bg-surface-tinted/65 px-3 py-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-foreground">
                    {t('books.includedPapers.generatedForm', { defaultValue: 'Generated form' })}
                  </strong>
                  <span className="flex flex-wrap items-center gap-1 text-[0.7em] text-muted-foreground">
                    {t('books.includedPapers.pages', {
                      count: fixedPages,
                      defaultValue: '{{count}} pages',
                    })}
                    <span aria-hidden>·</span>
                    {t('books.includedPapers.pageRangeLabel', { defaultValue: 'pages' })}
                    <bdi dir="ltr">1–{fixedPages}</bdi>
                  </span>
                </span>
                <span className="rounded-md border border-hairline bg-surface px-2 py-1 text-[0.62em] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {t('books.includedPapers.fixed', { defaultValue: 'Fixed' })}
                </span>
              </div>

              {editor.state.items.length > 0 && (
                <div className="flex items-center justify-between border-y border-hairline bg-surface px-3 py-2 text-[0.65em] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                  <span>{t('books.includedPapers.section', { defaultValue: 'Included papers' })}</span>
                  <span>
                    {t('books.includedPapers.files', {
                      count: editor.state.items.length,
                      defaultValue: '{{count}} files',
                    })}
                  </span>
                </div>
              )}

              <div className="divide-y divide-hairline">
                {editor.state.items.map((paper, index) => (
                  <PaperOrderRow
                    key={paper.id}
                    paper={paper}
                    number={index + 2}
                    firstEditable={
                      index === 0 || editor.state.items[index - 1].embedded_in_signed_base
                    }
                    last={index === editor.state.items.length - 1}
                    busy={editor.busy}
                    onMove={(offset) => editor.movePaper(paper.id, offset)}
                    onReplace={() => {
                      replaceIdRef.current = paper.id
                      replaceInputRef.current?.click()
                    }}
                    onRemove={() => editor.removePaper(paper.id)}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => addInputRef.current?.click()}

              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary-soft/40 px-3 py-3 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              {t('books.includedPapers.addInput', { defaultValue: 'Add PDF or images' })}
            </button>

            {book.approval_state === 'approved' && (
              <div className="mt-4 flex gap-2.5 rounded-xl border border-primary/15 bg-primary-soft/45 p-3 text-[0.73em] leading-relaxed text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden />
                <p>
                  <strong>
                    {t('books.includedPapers.approvedNoticeTitle', {
                      defaultValue: 'Approved record.',
                    })}{' '}
                  </strong>
                  {t('books.includedPapers.approvedNotice', {
                    defaultValue:
                      'Saving keeps the approval and sends one summary notification to all approving managers. The change is recorded in history.',
                  })}
                </p>
              </div>
            )}
            {(book.included_papers_history?.length ?? 0) > 0 && (
              <div className="mt-5 border-t border-hairline pt-4">
                <h4 className="flex items-center gap-2 text-xs font-bold text-foreground">
                  <History className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} aria-hidden />
                  {t('books.includedPapers.history', { defaultValue: 'Recent changes' })}
                </h4>
                <ol className="mt-2 space-y-2">
                  {book.included_papers_history?.slice(0, 3).map((entry) => (
                    <li
                      key={`${entry.revision_after}-${entry.created_at}`}
                      className="rounded-lg border border-hairline bg-surface-tinted/35 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-[0.72em] text-foreground" dir="auto">
                          {entry.actor_name}
                        </strong>
                        <time
                          dateTime={entry.created_at}
                          className="shrink-0 font-mono text-[0.62em] text-faint"
                          dir="ltr"
                        >
                          {new Date(entry.created_at).toLocaleDateString(i18n.language)}
                        </time>
                      </div>
                      <p className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[0.68em] text-muted-foreground">
                        {(entry.added?.length ?? 0) > 0 && (
                          <span className="inline-flex flex-wrap gap-1">
                            {t('books.includedPapers.historyAdded', { defaultValue: 'Added:' })}
                            {entry.added?.map((name, index) => (
                              <span key={`${name}-${index}`} className="text-foreground">
                                {index === 0 ? ' ' : listSeparator}
                                <bdi dir="auto">{name}</bdi>
                              </span>
                            ))}
                          </span>
                        )}
                        {(entry.removed?.length ?? 0) > 0 && (
                          <span className="inline-flex flex-wrap gap-1">
                            {t('books.includedPapers.historyRemoved', { defaultValue: 'Removed:' })}
                            {entry.removed?.map((name, index) => (
                              <span key={`${name}-${index}`} className="text-foreground">
                                {index === 0 ? ' ' : listSeparator}
                                <bdi dir="auto">{name}</bdi>
                              </span>
                            ))}
                          </span>
                        )}
                        {(entry.replaced?.length ?? 0) > 0 && (
                          <span className="inline-flex flex-wrap gap-1">
                            {t('books.includedPapers.historyReplaced', { defaultValue: 'Replaced:' })}
                            {entry.replaced?.map((item, index) => (
                              <span
                                key={`${item.from_name}-${item.to_name}-${index}`}
                                className="inline-flex items-center gap-1 text-foreground"
                              >
                                {index === 0 ? ' ' : listSeparator}
                                <bdi dir="auto">{item.from_name}</bdi>
                                <span aria-hidden className="inline-block rtl:rotate-180">
                                  →
                                </span>
                                <span className="sr-only">
                                  {` ${t('books.includedPapers.replacementWith', {
                                    defaultValue: 'with',
                                  })} `}
                                </span>
                                <bdi dir="auto">{item.to_name}</bdi>
                              </span>
                            ))}
                          </span>
                        )}
                        {(entry.reordered?.length ?? 0) > 0 && (
                          <span className="inline-flex flex-wrap gap-1">
                            {t('books.includedPapers.historyReordered', {
                              defaultValue: 'Reordered:',
                            })}
                            {entry.reordered?.map((name, index) => (
                              <span key={`${name}-${index}`} className="text-foreground">
                                {index === 0 ? ' ' : listSeparator}
                                <bdi dir="auto">{name}</bdi>
                              </span>
                            ))}
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t border-hairline bg-surface px-4 py-3 sm:px-5">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {t('books.includedPapers.finalPdf', { defaultValue: 'Final combined PDF' })}
              </span>
              <strong className="text-foreground">
                {t('books.includedPapers.pages', {
                  count: totalPages,
                  defaultValue: '{{count}} pages',
                })}
              </strong>
            </div>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
              <Button type="button" variant="ghost" onClick={close} disabled={editor.busy}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button type="button" variant="outline" onClick={() => void review()} disabled={editor.busy}>
                {editor.busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                )}
                {t('books.includedPapers.review', { defaultValue: 'Review PDF' })}
              </Button>
              <Button
                type="button"
                variant="commit"
                onClick={() => void save()}
                disabled={!editor.canSave}
              >
                <Save className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                {t('books.includedPapers.save', { defaultValue: 'Save combined PDF' })}
              </Button>
            </div>
          </footer>
        </section>
      </div>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('books.includedPapers.discardTitle', {
          defaultValue: 'Discard unsaved changes?',
        })}
        description={t('books.includedPapers.discardConfirm', {
          defaultValue: 'Your changes have not been saved.',
        })}
        confirmLabel={t('books.includedPapers.discard', {
          defaultValue: 'Discard changes',
        })}
        onConfirm={onCancel}
        destructive
      />
    </DialogContent>
  )
}

function PaperOrderRow({
  paper,
  number,
  firstEditable,
  last,
  busy,
  onMove,
  onReplace,
  onRemove,
}: {
  paper: EditableIncludedPaper
  number: number
  firstEditable: boolean
  last: boolean
  busy: boolean
  onMove: (offset: -1 | 1) => void
  onReplace: () => void
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const embedded = paper.embedded_in_signed_base
  const extension = paper.original_name.split('.').pop()?.toUpperCase() || 'FILE'
  const pageRange =
    paper.page_start != null && paper.page_end != null ? (
      <>
        {t(
          paper.page_start === paper.page_end
            ? 'books.includedPapers.singlePageLabel'
            : 'books.includedPapers.pageRangeLabel',
          { defaultValue: paper.page_start === paper.page_end ? 'page' : 'pages' },
        )}{' '}
        <bdi dir="ltr">
          {paper.page_start}
          {paper.page_start === paper.page_end ? '' : `–${paper.page_end}`}
        </bdi>
      </>
    ) : (
      t('books.includedPapers.notReviewed', { defaultValue: 'Not reviewed yet' })
    )

  return (
    <div className="group flex items-center gap-2.5 bg-surface px-3 py-3 transition-colors hover:bg-surface-tinted/45">
      <GripVertical
        className={cn('h-4 w-4 shrink-0', embedded ? 'text-faint' : 'text-muted-foreground')}
        strokeWidth={1.6}
        aria-hidden
      />
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-hairline bg-surface-tinted text-xs font-bold text-foreground">
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-xs text-foreground" dir="auto">
          {paper.original_name}
        </strong>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.68em] text-muted-foreground">
          <span>
            {paper.page_count > 0
              ? t('books.includedPapers.pages', {
                  count: paper.page_count,
                  defaultValue: '{{count}} pages',
                })
              : pageRange}
          </span>
          {paper.page_count > 0 && <span aria-hidden>·</span>}
          {paper.page_count > 0 && <span>{pageRange}</span>}
          {formatBytes(paper.size) && <span aria-hidden>·</span>}
          {formatBytes(paper.size) && <span dir="ltr">{formatBytes(paper.size)}</span>}
          <span className="rounded bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.9em] font-semibold text-faint">
            {extension}
          </span>
        </span>
      </span>
      {embedded ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline bg-surface-tinted px-2 py-1 text-[0.62em] font-semibold text-muted-foreground">
          <LockKeyhole className="h-3 w-3" strokeWidth={1.8} aria-hidden />
          {t('books.includedPapers.signedFixed', { defaultValue: 'Fixed in signed PDF' })}
        </span>
      ) : (
        <span className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={busy || firstEditable}
            aria-label={t('books.includedPapers.moveUp', {
              name: paper.original_name,
              defaultValue: 'Move {{name}} up',
            })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-tinted hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={busy || last}
            aria-label={t('books.includedPapers.moveDown', {
              name: paper.original_name,
              defaultValue: 'Move {{name}} down',
            })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-tinted hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onReplace}
            disabled={busy}
            aria-label={t('books.includedPapers.replace', {
              name: paper.original_name,
              defaultValue: 'Replace {{name}}',
            })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={t('books.includedPapers.remove', {
              name: paper.original_name,
              defaultValue: 'Remove {{name}}',
            })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          </button>
        </span>
      )}
    </div>
  )
}
