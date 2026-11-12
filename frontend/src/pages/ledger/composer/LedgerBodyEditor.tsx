/**
 * LedgerBodyEditor — the Ledger Book body in HugeRTE, configured to look like
 * the printed paper (see `ledgerEditorConfig.ts`). With `onUploadImage`,
 * inserted and pasted images go to the server and the body keeps only their
 * server URL; without it the image tools are off. Falls back to a plain
 * textarea when the self-hosted HugeRTE bundle fails to load.
 *
 * Browser checks must use native iframe windows: automation that proxies
 * `iframe.contentWindow` breaks HugeRTE's native event bindings. Oxide also
 * overrides the shell's inline `visibility: hidden`, so inspect computed
 * visibility and the toolbar rather than treating that attribute as a failure.
 */
import { Editor } from '@hugerte/hugerte-react'
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import type { Editor as HugeEditor } from 'hugerte'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage } from '@/lib/api'
import {
  LEDGER_BLOCK_FORMATS,
  LEDGER_CONTENT_STYLE,
  LEDGER_DATETIME_FORMATS,
  LEDGER_EDITOR_MIN_HEIGHT,
  LEDGER_FONT_SIZE_FORMATS,
  LEDGER_LINE_HEIGHT_FORMATS,
  LEDGER_MENUBAR,
  LEDGER_PAGEBREAK_SEPARATOR,
  LEDGER_SELECTION_TOOLBAR,
  LEDGER_TABLE_DEFAULT_ATTRIBUTES,
  LEDGER_TABLE_DEFAULT_STYLES,
  ledgerFontFamilyFormats,
  ledgerPastePostprocess,
  ledgerPlugins,
  ledgerStyleFormats,
  ledgerToolbar,
  registerLedgerTablePresets,
} from './ledgerEditorConfig'

interface BlobInfo { blob: () => Blob; filename: () => string }

export interface LedgerBodyEditorHandle { focus: () => void }

export function LedgerBodyEditor({ value, onChange, label, onUploadImage, invalid, describedBy, errorMessage, disabled = false, ref, height = LEDGER_EDITOR_MIN_HEIGHT }: {
  disabled?: boolean
  ref?: Ref<LedgerBodyEditorHandle>
  value: string
  onChange: (html: string) => void
  label: string
  /** Uploads one image and resolves to its server `src`. */
  onUploadImage?: (file: Blob, filename: string) => Promise<string>
  invalid?: boolean
  describedBy?: string
  errorMessage?: string
  /** Editor height in px; never below the 600px minimum. */
  height?: number
}): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const [scriptFailed, setScriptFailed] = useState(false)
  const editorRef = useRef<HugeEditor | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()
  useImperativeHandle(ref, () => ({ focus: () => {
    if (scriptFailed) textareaRef.current?.focus()
    else editorRef.current?.focus()
  } }), [scriptFailed])
  const syncAccessibility = useCallback((editor: HugeEditor) => {
    const body = editor.getBody()
    body.setAttribute('aria-label', label)
    if (invalid) body.setAttribute('aria-invalid', 'true')
    else body.removeAttribute('aria-invalid')
    body.ownerDocument.getElementById(errorId)?.remove()
    if (invalid && errorMessage) {
      const description = body.ownerDocument.createElement('span')
      description.id = errorId
      description.hidden = true
      // HugeRTE excludes this accessibility text from the saved document.
      description.setAttribute('data-mce-bogus', 'all')
      description.contentEditable = 'false'
      description.textContent = errorMessage
      body.append(description)
      body.setAttribute('aria-describedby', errorId)
    } else body.removeAttribute('aria-describedby')
  }, [errorId, errorMessage, invalid, label])
  const accessibilityRef = useRef(syncAccessibility)
  useEffect(() => {
    accessibilityRef.current = syncAccessibility
    const editor = editorRef.current
    if (editor) syncAccessibility(editor)
  }, [syncAccessibility])
  useEffect(() => () => { editorRef.current = null }, [])
  const init = useMemo(() => ({
    init_instance_callback: (editor: HugeEditor) => {
      editorRef.current = editor
      accessibilityRef.current(editor)
      editor.on('SetContent', () => accessibilityRef.current(editor))
      editor.on('remove', () => { if (editorRef.current === editor) editorRef.current = null })
    },
    setup: (editor: HugeEditor) => registerLedgerTablePresets(editor, t),
    base_url: '/hugerte',
    suffix: '.min',
    menubar: LEDGER_MENUBAR,
    plugins: ledgerPlugins(Boolean(onUploadImage)),
    toolbar: ledgerToolbar(Boolean(onUploadImage)),
    toolbar_mode: 'wrap' as const,
    statusbar: true,
    elementpath: false,
    branding: false,
    promotion: false,
    resize: true,
    height: Math.max(height, LEDGER_EDITOR_MIN_HEIGHT),
    min_height: LEDGER_EDITOR_MIN_HEIGHT,
    font_family_formats: ledgerFontFamilyFormats(t),
    font_size_formats: LEDGER_FONT_SIZE_FORMATS,
    line_height_formats: LEDGER_LINE_HEIGHT_FORMATS,
    block_formats: LEDGER_BLOCK_FORMATS,
    style_formats: ledgerStyleFormats(t),
    table_default_styles: LEDGER_TABLE_DEFAULT_STYLES,
    table_default_attributes: LEDGER_TABLE_DEFAULT_ATTRIBUTES,
    table_sizing_mode: 'relative' as const,
    // Visual aids repaint attribute-less table borders as grey dashes, hiding
    // the solid rule the paper prints.
    visual: false,
    pagebreak_separator: LEDGER_PAGEBREAK_SEPARATOR,
    // A plain &nbsp;: the wrapper span's class would be stripped on save.
    nonbreaking_wrap: false,
    insertdatetime_formats: LEDGER_DATETIME_FORMATS,
    quickbars_selection_toolbar: LEDGER_SELECTION_TOOLBAR,
    // No empty-line or image popups: quick image skips the upload switch and
    // image alignment does not survive the sanitizer.
    quickbars_insert_toolbar: false,
    quickbars_image_toolbar: false,
    content_style: LEDGER_CONTENT_STYLE,
    paste_postprocess: ledgerPastePostprocess,
    // HugeRTE's own menus and dialogs; `ar` loads /hugerte/langs/ar.js.
    language: isAr ? 'ar' : 'en',
    directionality: (isAr ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    browser_spellcheck: true,
    paste_data_images: Boolean(onUploadImage),
    automatic_uploads: true,
    image_uploadtab: Boolean(onUploadImage),
    images_file_types: 'png,jpg,jpeg,gif,webp',
    // The sanitizer accepts only root-relative URLs under our image API.
    relative_urls: false,
    remove_script_host: true,
    images_upload_handler: onUploadImage
      ? (info: BlobInfo) => onUploadImage(info.blob(), info.filename()).catch((err: unknown) => {
        throw new Error(apiErrorMessage(err))
      })
      : undefined,
    iframe_aria_text: label,
    skin: 'oxide',
  }), [height, isAr, label, onUploadImage, t])

  if (scriptFailed) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          disabled={disabled}
          ref={textareaRef}
          value={value}
          onChange={(e) => { if (!disabled) onChange(e.target.value) }}
          dir={isAr ? 'rtl' : 'ltr'}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy ?? (invalid && errorMessage ? errorId : undefined)}
          className="min-h-60 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {!describedBy && invalid && errorMessage ? <span id={errorId} className="sr-only">{errorMessage}</span> : null}
        <span className="text-xs text-muted-foreground">{t('editor.loadFailed')}</span>
      </div>
    )
  }
  return (
    <div aria-invalid={invalid || undefined} aria-describedby={describedBy} className={invalid ? 'rounded-md ring-2 ring-destructive' : undefined}>
      {/* HugeRTE reads init once: remount so a language switch relabels its UI and style presets. */}
      <Editor
        key={isAr ? 'ar' : 'en'}
        hugerteScriptSrc="/hugerte/hugerte.min.js"
        value={value}
        disabled={disabled}
        onEditorChange={(html) => { if (!disabled) onChange(html) }}
        onScriptsLoadError={() => setScriptFailed(true)}
        init={init}
      />
    </div>
  )
}
