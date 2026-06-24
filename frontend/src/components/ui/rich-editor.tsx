/**
 * RichEditor — HugeRTE-backed, RHF-aware, two variants.
 *
 * Replaces the TinyMCE-based ArabicEditorField. Self-hosted bundle at
 * /hugerte/hugerte.min.js (offline-safe in the pywebview shell).
 *
 *   variant="minimal" — application form fields (resignation reasons,
 *     promotion justification, etc.). Compact toolbar; small footprint.
 *
 *   variant="full"    — Ledger notes_html (the "general book"). Two-row
 *     Word-like ribbon ported from editor/editor.html, plus three custom
 *     buttons: Save Template, Load Template, Insert GSSG Table. Optional
 *     `pageHeightPx` draws a dashed page-boundary marker in the editor
 *     body so the operator can see how much room is left.
 *
 * Wired into React Hook Form via Controller — the HTML string is the
 * field value. Storage / backend conversion is unchanged.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { Editor as HugeRTEEditor } from '@hugerte/hugerte-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { EditorTemplateListItem, EditorTemplateRead } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  BLOCK_FORMATS,
  FONT_FAMILY_FORMATS,
  FONT_SIZE_FORMATS,
  FULL_PLUGINS,
  FULL_TOOLBAR_ROWS,
  GSSG_DEFAULT_TABLE_HTML,
  LINE_HEIGHT_FORMATS,
  MINIMAL_PLUGINS,
  MINIMAL_TOOLBAR,
  buildContentStyle,
} from './rich-editor-config'

// ─── Types ────────────────────────────────────────────────────────────────────

// Loose shape — we only touch a handful of methods (insertContent, getContent,
// setContent, notificationManager). Avoids pulling the full hugerte type tree
// through every consumer.
interface HugeRTEEditorLike {
  insertContent: (html: string) => void
  getContent: () => string
  setContent: (html: string) => void
  notificationManager: {
    open: (opts: { text: string; type?: 'success' | 'warning' | 'error' | 'info'; timeout?: number }) => void
  }
  ui: {
    registry: {
      addButton: (
        name: string,
        opts: { icon?: string; text?: string; tooltip?: string; onAction: () => void },
      ) => void
    }
  }
}

export interface RichEditorProps {
  /** RHF field name */
  name: string
  /** Variant — defaults to "minimal" */
  variant?: 'minimal' | 'full'
  label_en?: string
  label_ar?: string
  required?: boolean
  defaultValue?: string
  /** Pixel height of the editor frame (default: minimal 240, full 520).
   * Ignored when `fillHeight` is set. */
  height?: number
  /**
   * When true, the editor stretches to fill its flex parent instead of using a
   * fixed pixel height. The Controller wrapper becomes `flex-1 min-h-0` and
   * HugeRTE is given `height: '100%'`, so the body grows with the available
   * vertical space (e.g. the full-page email composer). The parent MUST be a
   * flex column with a bounded height for `100%` to resolve. A `minHeightPx`
   * floor keeps the editor usable when little space is available. Opt-in so
   * the fixed-height consumers (form fields, signature, notes) are unaffected.
   */
  fillHeight?: boolean
  /** Floor (px) for the editor body when `fillHeight` is set. Default 360. */
  minHeightPx?: number
  /**
   * When set on the "full" variant, a dashed horizontal line is drawn in the
   * editor body at this y-offset. Useful for previewing where content would
   * overflow a printed page.
   */
  pageHeightPx?: number
}

// ─── Save / Load dialogs ──────────────────────────────────────────────────────

interface SaveTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  getContent: () => string
}

function SaveTemplateDialog({ open, onOpenChange, getContent }: SaveTemplateDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.createEditorTemplate({ name: name.trim(), html: getContent() }),
    onSuccess: (tpl) => {
      toast.success(t('editor.template.savedToast', { name: tpl.name }))
      void qc.invalidateQueries({ queryKey: ['editor-templates'] })
      setName('')
      setError(null)
      onOpenChange(false)
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : String(err)
      setError(msg)
    },
  })

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('editor.template.saveTitle')}
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div className="relative z-10 w-[420px] max-w-[92vw] rounded-lg border border-border bg-background p-5 shadow-xl">
        <h3 className="mb-3 text-base font-semibold text-foreground">
          {t('editor.template.saveTitle')}
        </h3>
        <Label className="text-xs">{t('editor.template.nameLabel')}</Label>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          placeholder={t('editor.template.namePlaceholder')}
          className="mt-1.5"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) mutation.mutate()
          }}
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} type="button">
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface LoadTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLoad: (html: string, mode: 'replace' | 'insert') => void
}

function LoadTemplateDialog({ open, onOpenChange, onLoad }: LoadTemplateDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'replace' | 'insert'>('insert')
  // Track which template is being renamed (null = none).
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Track which template is pending delete confirmation (null = none).
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')

  const listQuery = useQuery({
    queryKey: ['editor-templates'],
    queryFn: () => api.listEditorTemplates({ limit: 200 }).then((r) => r.items),
    enabled: open,
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteEditorTemplate(id),
    onSuccess: () => {
      toast.success(t('editor.template.deletedToast'))
      void qc.invalidateQueries({ queryKey: ['editor-templates'] })
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.updateEditorTemplate(id, { name }),
    onSuccess: () => {
      toast.success(t('editor.template.renamedToast', { defaultValue: 'Template renamed' }))
      void qc.invalidateQueries({ queryKey: ['editor-templates'] })
      setRenamingId(null)
      setRenameValue('')
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : String(err))
    },
  })

  async function handleLoad(id: number): Promise<void> {
    try {
      const tpl: EditorTemplateRead = await api.getEditorTemplate(id)
      onLoad(tpl.html, mode)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err))
    }
  }

  if (!open) return null

  const items: EditorTemplateListItem[] = listQuery.data ?? []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('editor.template.loadTitle')}
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div className="relative z-10 flex max-h-[80vh] w-[560px] max-w-[92vw] flex-col rounded-lg border border-border bg-background shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">
            {t('editor.template.loadTitle')}
          </h3>
          <div className="mt-3 flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">{t('editor.template.modeLabel')}:</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                checked={mode === 'insert'}
                onChange={() => setMode('insert')}
              />
              {t('editor.template.modeInsert')}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              {t('editor.template.modeReplace')}
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {listQuery.isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
          )}
          {listQuery.isError && (
            <p className="py-8 text-center text-sm text-destructive">
              {(listQuery.error as Error).message}
            </p>
          )}
          {!listQuery.isLoading && items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('editor.template.empty')}
            </p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-border">
              {items.map((tpl) => (
                <li key={tpl.id} className="flex flex-col gap-1 py-2.5">
                  {renamingId === tpl.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && renameValue.trim()) {
                            renameMutation.mutate({ id: tpl.id, name: renameValue.trim() })
                          }
                          if (e.key === 'Escape') {
                            setRenamingId(null)
                            setRenameValue('')
                          }
                        }}
                        className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="button"
                        disabled={!renameValue.trim() || renameMutation.isPending}
                        onClick={() => renameMutation.mutate({ id: tpl.id, name: renameValue.trim() })}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                      >
                        {t('common.save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenamingId(null); setRenameValue('') }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void handleLoad(tpl.id)}
                        className="flex-1 text-start text-sm font-medium text-foreground hover:text-primary"
                      >
                        {tpl.name}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {new Date(tpl.created_at).toLocaleDateString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(tpl.id)
                          setRenameValue(tpl.name)
                        }}
                        className="text-xs text-muted-foreground hover:text-primary"
                        aria-label={t('common.rename', { defaultValue: 'Rename' })}
                      >
                        {t('common.rename', { defaultValue: 'Rename' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmId(tpl.id)
                          setDeleteConfirmName(tpl.name)
                        }}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        aria-label={t('common.delete')}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(o) => { if (!o) { setDeleteConfirmId(null); setDeleteConfirmName('') } }}
        title={t('editor.template.confirmDelete', { name: deleteConfirmName })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteConfirmId !== null) deleteMutation.mutate(deleteConfirmId)
        }}
        destructive
      />
    </div>
  )
}

// ─── RichEditor ───────────────────────────────────────────────────────────────

export function RichEditor({
  name,
  variant = 'minimal',
  label_en,
  label_ar,
  required,
  defaultValue = '',
  height,
  fillHeight = false,
  minHeightPx = 360,
  pageHeightPx,
}: RichEditorProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = (isAr ? label_ar : label_en) ?? ''

  const {
    control,
    formState: { errors },
  } = useFormContext()

  const error = (errors[name] as { message?: string } | undefined)?.message

  const editorRef = useRef<HugeRTEEditorLike | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [loadOpen, setLoadOpen] = useState(false)
  // When the self-hosted HugeRTE bundle fails to load (e.g. offline asset
  // missing), fall back to a plain textarea bound to the same field so the
  // form stays usable instead of rendering nothing.
  const [scriptFailed, setScriptFailed] = useState(false)

  const isDark = document.documentElement.dataset.theme === 'dark'
  const isFull = variant === 'full'
  // When filling, HugeRTE takes a CSS '100%' height (resolves against the
  // flex-1 wrapper); otherwise a fixed pixel height as before.
  const editorHeight: number | string = fillHeight
    ? '100%'
    : (height ?? (isFull ? 520 : 240))
  const contentStyle = useMemo(
    () => buildContentStyle({ variant, pageHeightPx, dark: isDark }),
    [variant, pageHeightPx, isDark],
  )

  const setup = useCallback(
    (editor: HugeRTEEditorLike) => {
      editorRef.current = editor

      if (!isFull) return

      editor.ui.registry.addButton('gssg-template-save', {
        icon: 'template-add',
        tooltip: t('editor.template.saveTooltip'),
        onAction: () => setSaveOpen(true),
      })

      editor.ui.registry.addButton('gssg-template-load', {
        icon: 'restore-draft',
        tooltip: t('editor.template.loadTooltip'),
        onAction: () => setLoadOpen(true),
      })

      editor.ui.registry.addButton('gssg-table', {
        icon: 'table',
        tooltip: t('editor.table.tooltip'),
        onAction: () => {
          editor.insertContent(GSSG_DEFAULT_TABLE_HTML)
        },
      })
    },
    [isFull, t],
  )

  const init = useMemo(
    () => ({
      base_url: '/hugerte',
      suffix: '.min',
      menubar: isFull ? ('file edit view insert format table tools' as const) : false,
      plugins: isFull ? FULL_PLUGINS : MINIMAL_PLUGINS,
      toolbar: isFull ? FULL_TOOLBAR_ROWS : MINIMAL_TOOLBAR,
      toolbar_mode: 'wrap' as const,
      statusbar: isFull,
      elementpath: false,
      branding: false,
      promotion: false,
      resize: false,
      height: editorHeight,
      ...(fillHeight ? { min_height: minHeightPx } : {}),
      directionality: (isAr ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
      content_style: contentStyle,
      browser_spellcheck: true,
      contextmenu: 'link image table',
      paste_data_images: true,
      font_family_formats: FONT_FAMILY_FORMATS,
      font_size_formats: FONT_SIZE_FORMATS,
      line_height_formats: LINE_HEIGHT_FORMATS,
      block_formats: BLOCK_FORMATS,
      skin: 'oxide',
      setup,
    }),
    [isAr, isFull, editorHeight, fillHeight, minHeightPx, contentStyle, setup],
  )

  return (
    <Controller
      control={control}
      name={name}
      defaultValue={defaultValue}
      render={({ field }) => (
        <div
          className={`col-span-1 flex w-full flex-col gap-1.5 sm:col-span-2 ${
            // When filling, claim the parent's leftover vertical space so
            // HugeRTE's height:100% resolves against a bounded box.
            fillHeight ? 'min-h-0 flex-1 [&_.tox-tinymce]:!h-full' : ''
          }`}
        >
          {label && (
            <label className="text-sm font-medium leading-none">
              {label}
              {required && <span className="ms-0.5 text-destructive">*</span>}
            </label>
          )}
          {scriptFailed ? (
            <textarea
              value={(field.value as string | undefined) ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              dir={isAr ? 'rtl' : 'ltr'}
              aria-label={label || name}
              className="min-h-[240px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <HugeRTEEditor
              hugerteScriptSrc="/hugerte/hugerte.min.js"
              value={(field.value as string | undefined) ?? ''}
              onEditorChange={(html) => field.onChange(html)}
              onScriptsLoadError={() => setScriptFailed(true)}
              init={init}
            />
          )}
          {scriptFailed && (
            <span className="text-xs text-muted-foreground">
              {t('editor.loadFailed', {
                defaultValue:
                  'Rich text editor could not load — using a plain text box.',
              })}
            </span>
          )}
          {error && (
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          )}

          {isFull && (
            <>
              <SaveTemplateDialog
                open={saveOpen}
                onOpenChange={setSaveOpen}
                getContent={() => editorRef.current?.getContent() ?? ''}
              />
              <LoadTemplateDialog
                open={loadOpen}
                onOpenChange={setLoadOpen}
                onLoad={(html, mode) => {
                  const ed = editorRef.current
                  if (!ed) return
                  if (mode === 'replace') {
                    ed.setContent(html)
                  } else {
                    ed.insertContent(html)
                  }
                }}
              />
            </>
          )}
        </div>
      )}
    />
  )
}
