/**
 * LedgerBodyEditor — the Ledger Book body in HugeRTE. With `onUploadImage`,
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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage } from '@/lib/api'
import { MINIMAL_PLUGINS, MINIMAL_TOOLBAR } from '@/components/ui/rich-editor-config'

interface BlobInfo { blob: () => Blob; filename: () => string }

export function LedgerBodyEditor({ value, onChange, label, onUploadImage, invalid, describedBy, height = 420 }: {
  value: string
  onChange: (html: string) => void
  label: string
  /** Uploads one image and resolves to its server `src`. */
  onUploadImage?: (file: Blob, filename: string) => Promise<string>
  invalid?: boolean
  describedBy?: string
  height?: number
}): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const [scriptFailed, setScriptFailed] = useState(false)
  const init = useMemo(() => ({
    base_url: '/hugerte',
    suffix: '.min',
    menubar: false as const,
    plugins: onUploadImage ? MINIMAL_PLUGINS : MINIMAL_PLUGINS.replace(' image', ''),
    toolbar: onUploadImage ? MINIMAL_TOOLBAR.replace('link table', 'link image table') : MINIMAL_TOOLBAR,
    toolbar_mode: 'wrap' as const,
    statusbar: false,
    branding: false,
    promotion: false,
    resize: false,
    height,
    directionality: (isAr ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    browser_spellcheck: true,
    paste_data_images: Boolean(onUploadImage),
    automatic_uploads: true,
    image_uploadtab: Boolean(onUploadImage),
    images_file_types: 'png,jpg,jpeg,gif,webp',
    images_upload_handler: onUploadImage
      ? (info: BlobInfo) => onUploadImage(info.blob(), info.filename()).catch((err: unknown) => {
        throw new Error(apiErrorMessage(err))
      })
      : undefined,
    iframe_aria_text: label,
    skin: 'oxide',
  }), [height, isAr, label, onUploadImage])

  if (scriptFailed) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir={isAr ? 'rtl' : 'ltr'}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="min-h-60 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">{t('editor.loadFailed')}</span>
      </div>
    )
  }
  return (
    <div aria-invalid={invalid || undefined} aria-describedby={describedBy} className={invalid ? 'rounded-md ring-2 ring-destructive' : undefined}>
      <Editor
        hugerteScriptSrc="/hugerte/hugerte.min.js"
        value={value}
        onEditorChange={(html) => onChange(html)}
        onScriptsLoadError={() => setScriptFailed(true)}
        init={init}
      />
    </div>
  )
}
