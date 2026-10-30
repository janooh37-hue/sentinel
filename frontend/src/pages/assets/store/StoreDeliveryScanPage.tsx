import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, ScanLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { api, ApiError, type StoreDeliveryScan } from '@/lib/api'
import { useIsMobile } from '@/lib/useIsMobile'
import { DeliveryDialog } from './components/DeliveryDialog'
import { ScanDeliveryConfirm } from './components/ScanDeliveryConfirm'
import { StoreShell } from './StoreShell'
import { storeErrorMessage } from './storeUtils'

export function StoreDeliveryScanPage(): React.JSX.Element {
  const { t } = useTranslation()
  const mobile = useIsMobile()
  const navigate = useNavigate()
  const id = useId()
  const [file, setFile] = useState<File | null>(null)
  const [scan, setScan] = useState<StoreDeliveryScan | null>(null)
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const status = useRef<HTMLDivElement>(null)

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (reading || message) status.current?.focus() }, [reading, message])

  async function chooseFile(chosen: File): Promise<void> {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setFile(chosen)
    setScan(null)
    setMessage(null)
    setReading(true)
    try {
      const result = await api.scanStoreDelivery(chosen, active.signal)
      if (active.signal.aborted) return
      setScan(result)
      if (!result.ocr_available) setMessage(t('assets.store.scan.unavailable'))
      else if (!result.lines.length) setMessage(t('assets.store.scan.nothingRead'))
    } catch (error) {
      if (active.signal.aborted) return
      setMessage(error instanceof ApiError && error.code === 'STORE_SCAN_TIMEOUT'
        ? t('assets.store.scan.scanTimeout')
        : error instanceof ApiError && error.code === 'STORE_SCAN_TOO_MANY_PAGES'
          ? t('assets.store.scan.tooManyPages') : storeErrorMessage(error))
    } finally {
      if (!active.signal.aborted) setReading(false)
    }
  }

  function cancelReading(): void {
    controller.current?.abort()
    setReading(false)
    setMessage(null)
    chooser.current?.focus()
  }

  return (
    <StoreShell title={t('assets.store.scan.title')} description={t('assets.store.scan.description')}>
      {file && scan?.ocr_available && scan.lines.length > 0 ? (
        <ScanDeliveryConfirm file={file} scan={scan} />
      ) : (
        <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:p-6">
          <ScanLine aria-hidden className="h-8 w-8 text-primary" />
          <label htmlFor={`${id}-file`} className="font-semibold">{t('assets.store.scan.chooseFile')}</label>
          <input ref={chooser} id={`${id}-file`} type="file" accept="image/*,application/pdf" capture={mobile ? 'environment' : undefined} disabled={reading} aria-describedby={`${id}-hint`} className="min-h-11 min-w-0 max-w-full rounded-md border border-border p-2 text-sm file:me-3 file:min-h-11 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:text-primary" onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) void chooseFile(chosen); event.target.value = '' }} />
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">{t('assets.store.scan.fileHint')}</p>
          <div ref={status} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
            {reading && <p className="flex items-center gap-2"><LoaderCircle aria-hidden className="h-5 w-5 motion-safe:animate-spin" />{t('assets.store.scan.reading')}</p>}
            {message && <p dir="auto">{message}</p>}
          </div>
          {reading && <Button type="button" variant="secondary" className="min-h-11 self-start" onClick={cancelReading}>{t('assets.store.scan.cancelReading')}</Button>}
          {message && file && <Button type="button" className="min-h-11 self-start" onClick={() => setManual(true)}>{t('assets.store.scan.manual')}</Button>}
          <Button asChild variant="ghost" className="min-h-11 self-start"><Link to="/holdings/store/deliveries">{t('assets.store.scan.back')}</Link></Button>
        </section>
      )}
      <DeliveryDialog open={manual} onOpenChange={setManual} initialFile={file} onSaved={() => navigate('/holdings/store/deliveries')} />
    </StoreShell>
  )
}
