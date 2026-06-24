/**
 * XlsxViewer — renders an Excel attachment faithfully (merges, widths, fills,
 * borders, number formats) using Fortune-sheet, fed by LuckyExcel which parses
 * the .xlsx entirely in-browser (offline-safe). Read-only viewer. Lazy-loaded
 * (default export) so the spreadsheet engine only ships in the preview chunk.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Workbook } from '@fortune-sheet/react'
import type { Sheet } from '@fortune-sheet/core'
import { transformExcelToLuckyByUrl } from 'luckyexcel'
import '@fortune-sheet/react/dist/index.css'

import { api } from '@/lib/api'

export default function XlsxViewer({
  entryId,
  index,
  name,
}: {
  entryId: number
  index: number
  name: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const url = api.ledgerAttachmentUrl(entryId, index)
        const parsed = await new Promise<unknown>((resolve, reject) => {
          transformExcelToLuckyByUrl(url, name, (exportJson) => {
            const sheetsOut = exportJson?.sheets
            if (Array.isArray(sheetsOut) && sheetsOut.length > 0) resolve(sheetsOut)
            else reject(new Error('empty workbook'))
          })
        })
        if (!cancelled) {
          setSheets(parsed as Sheet[])
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [entryId, index, name])

  if (status === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/70">
        <AlertCircle className="h-6 w-6" />
        <span className="text-sm">
          {t('ledger.attachments.renderFailed', {
            defaultValue: "Couldn't render this file",
          })}
        </span>
      </div>
    )
  }

  if (status === 'loading' || !sheets) {
    return (
      <div className="flex h-full w-full items-center justify-center text-white/70">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  // Fortune-sheet fills its container; LTR (spreadsheet grids are column-major).
  return (
    <div
      className="h-full w-full overflow-hidden rounded-lg bg-white"
      dir="ltr"
      // Stop the dialog's backdrop-close from firing on grid clicks.
      onClick={(e) => e.stopPropagation()}
    >
      <Workbook
        data={sheets}
        allowEdit={false}
        showToolbar={false}
        showFormulaBar={false}
        showSheetTabs
        lang="en"
      />
    </div>
  )
}
