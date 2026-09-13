import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ClipboardCopy, FileSpreadsheet, Printer, ScanSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { api, apiErrorMessage, type InmatePopulation, type InmateRegisterMonth } from '@/lib/api'
import { copyTable } from '@/lib/copyTable'

import { RegisterDocument } from './RegisterDocument'
import {
  buildRegisterClipboard,
  DEFAULT_REGISTER_SCOPE,
  registerGroupsForScope,
  type RegisterExportOptions,
} from './registerClipboard'
import { POPULATIONS } from './registerModel'

const MM_IN_PX = 96 / 25.4
const ZOOM_STEPS = [50, 75, 100] as const

function saveBlob(file: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(file.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Firefox must get one task to begin the download before its object URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Choice({
  name,
  value,
  checked,
  label,
  onChange,
}: {
  name: string
  value: string
  checked: boolean
  label: string
  onChange: () => void
}): React.JSX.Element {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-xs font-medium transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-primary"
      />
      {label}
    </label>
  )
}

function ScopeChoice({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}): React.JSX.Element {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-xs font-medium transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-primary"
      />
      {label}
    </label>
  )
}

function ToggleOption({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-hairline bg-surface px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-primary"
      />
      <span className="text-sm font-semibold">{label}</span>
    </label>
  )
}

function MethodCard({
  icon,
  title,
  carries,
  loses,
  children,
}: {
  icon: React.ReactNode
  title: string
  carries: string
  loses: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <article className="flex min-h-56 flex-col border-b border-hairline p-4 last:border-b-0 lg:border-b-0 lg:border-e lg:last:border-e-0">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </span>
      <h4 className="mt-4 text-base font-semibold">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-foreground">{carries}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{loses}</p>
      <div className="mt-auto pt-4">{children}</div>
    </article>
  )
}

export function ExportWorkspace({ month }: { month: InmateRegisterMonth }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [draftIssuedAt] = useState(() => new Date().toISOString())
  const [options, setOptions] = useState<RegisterExportOptions>(() => ({
    scope: DEFAULT_REGISTER_SCOPE,
    includeCounts: true,
    detailMode: 'reference',
  }))
  const [zoom, setZoom] = useState<(typeof ZOOM_STEPS)[number]>(75)
  const [fit, setFit] = useState(true)
  const [fitScale, setFitScale] = useState(0.5)
  const [paperHeight, setPaperHeight] = useState(1)
  const deskRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)

  const clipboardPayload = useMemo(
    () => buildRegisterClipboard(month, options, t),
    [month, options, t],
  )
  const groups = registerGroupsForScope(month, options.scope)
  const includedEntries = groups.flatMap((group) => group.entries)
  const manualCount = includedEntries.filter((entry) => entry.origin === 'manual').length
  const derivedCount = includedEntries.length - manualCount
  const dropped = DEFAULT_REGISTER_SCOPE.filter((key) => !options.scope.includes(key))
  const populations = POPULATIONS.filter((key) => options.scope.includes(key))
  const paperWidthMm = 210
  const paperWidthPx = paperWidthMm * MM_IN_PX
  const effectiveScale = fit ? fitScale : zoom / 100

  const download = useMutation({
    mutationFn: () =>
      api.fetchInmateRegisterExport(
        { year: month.year, month: month.month, language: 'ar', populations },
        `inmate-violations-${month.year}-${String(month.month).padStart(2, '0')}.xlsx`,
      ),
    onSuccess: (file) => {
      saveBlob(file)
      toast.success(t('inmateStats.export.downloaded'))
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  useEffect(() => {
    const desk = deskRef.current
    if (desk === null) return
    const measure = (): void => {
      const availableWidth = Math.max(1, desk.clientWidth - 48)
      setFitScale(Math.min(1, availableWidth / paperWidthPx))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(desk)
    return () => observer.disconnect()
  }, [paperWidthPx])

  useEffect(() => {
    const paper = paperRef.current
    if (paper === null) return
    const measure = (): void => setPaperHeight(Math.ceil(paper.getBoundingClientRect().height / effectiveScale))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setPaperHeight(Math.ceil(entries[0]?.contentRect.height ?? 1))
    })
    observer.observe(paper)
    return () => observer.disconnect()
  }, [effectiveScale, options])

  const toggleScope = (key: InmatePopulation): void => {
    setOptions((current) => {
      const nextScope = current.scope.includes(key)
        ? current.scope.filter((candidate) => candidate !== key)
        : [...current.scope, key]
      return nextScope.length === 0 ? current : { ...current, scope: nextScope }
    })
  }

  const copyCurrentTable = async (): Promise<void> => {
    try {
      await copyTable(clipboardPayload)
      toast.success(t('inmateStats.export.copied'))
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }

  const printDocument = async (): Promise<void> => {
    await document.fonts?.ready
    await Promise.all(
      Array.from(
        document.querySelectorAll<HTMLImageElement>('[data-inmate-register-document] img'),
        async (image) => {
          if (!image.complete) {
            await new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true })
              image.addEventListener('error', () => resolve(), { once: true })
            })
          }
        },
      ),
    )
    window.print()
    toast.success(t('inmateStats.export.printSent'))
  }

  return (
    <div className="w-full">
      <div data-print-hide className="space-y-5">
        <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm">
          <div className="border-b border-hairline px-4 py-3">
            <h3 className="text-lg font-semibold">{t('inmateStats.export.title')}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('inmateStats.export.subtitle')}
            </p>
          </div>

          <div className="grid lg:grid-cols-3">
            <MethodCard
              icon={<ClipboardCopy className="h-4.5 w-4.5" aria-hidden />}
              title={t('inmateStats.export.methods.copy')}
              carries={t('inmateStats.export.methods.copyCarries')}
              loses={t('inmateStats.export.methods.copyLoses')}
            >
              <Button type="button" size="sm" onClick={() => void copyCurrentTable()}>
                <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                {t('inmateStats.export.methods.copy')}
              </Button>
            </MethodCard>

            <MethodCard
              icon={<Printer className="h-4.5 w-4.5" aria-hidden />}
              title={t('inmateStats.export.methods.print')}
              carries={t('inmateStats.export.methods.printCarries')}
              loses={t('inmateStats.export.methods.printLoses')}
            >
              <Button type="button" size="sm" onClick={() => void printDocument()}>
                <Printer className="h-3.5 w-3.5" aria-hidden />
                {t('inmateStats.export.methods.print')}
              </Button>
            </MethodCard>

            <MethodCard
              icon={<FileSpreadsheet className="h-4.5 w-4.5" aria-hidden />}
              title={t('inmateStats.export.methods.xlsx')}
              carries={t('inmateStats.export.methods.xlsxCarries')}
              loses={t('inmateStats.export.methods.xlsxLoses')}
            >
              <p className="mb-3 text-xs font-semibold text-success">
                {t('inmateStats.export.methods.xlsxNeverCloses')}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={download.isPending}
                aria-busy={download.isPending}
                onClick={() => download.mutate()}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                {t('inmateStats.export.methods.xlsx')}
              </Button>
            </MethodCard>
          </div>
        </section>

        <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
          <div className="border-b border-hairline pb-3">
            <h3 className="text-lg font-semibold">{t('inmateStats.export.options.title')}</h3>
          </div>

          <div className="mt-4 grid gap-5 xl:grid-cols-[1.1fr_1fr_1fr]">
            <fieldset className="min-w-0">
              <legend className="text-sm font-semibold">{t('inmateStats.export.options.scope')}</legend>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('inmateStats.export.options.scopeHint')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DEFAULT_REGISTER_SCOPE.map((key) => (
                  <ScopeChoice
                    key={key}
                    checked={options.scope.includes(key)}
                    label={t(`inmateStats.populations.${key}`)}
                    onChange={() => toggleScope(key)}
                  />
                ))}
              </div>
              {dropped.length > 0 ? (
                <p className="mt-2 text-xs font-semibold text-warning">
                  {t('inmateStats.export.options.dropped', {
                    tables: dropped.map((key) => t(`inmateStats.populations.${key}`)).join(' · '),
                  })}
                </p>
              ) : null}

            </fieldset>

            <div className="space-y-4">
              <ToggleOption
                checked={options.includeCounts}
                label={t('inmateStats.export.options.counts')}
                onChange={(includeCounts) =>
                  setOptions((current) => ({ ...current, includeCounts }))
                }
              />

            </div>

            <fieldset className="min-w-0">
              <legend className="text-sm font-semibold">
                {t('inmateStats.export.options.detailMode')}
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <Choice
                  name="register-detail-mode"
                  value="reference"
                  checked={options.detailMode === 'reference'}
                  label={t('inmateStats.export.options.detailReference')}
                  onChange={() =>
                    setOptions((current) => ({ ...current, detailMode: 'reference' }))
                  }
                />
                <Choice
                  name="register-detail-mode"
                  value="full"
                  checked={options.detailMode === 'full'}
                  label={t('inmateStats.export.options.detailFull')}
                  onChange={() => setOptions((current) => ({ ...current, detailMode: 'full' }))}
                />
              </div>

              <div className="mt-5 rounded-lg border border-border bg-surface-raised px-3 py-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  {t('inmateStats.export.options.willReach')}
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {t('inmateStats.export.options.willReachLine', {
                    rows: includedEntries.length,
                    derived: derivedCount,
                    manual: manualCount,
                    tables: groups.length,
                  })}
                </p>
              </div>
            </fieldset>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div className="flex items-center gap-2">
              <ScanSearch className="h-4 w-4 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">{t('inmateStats.export.preview')}</h3>
            </div>
            <div
              className="flex flex-wrap items-center gap-1.5"
              aria-label={t('inmateStats.export.zoom')}
            >
              {ZOOM_STEPS.map((step) => (
                <Button
                  key={step}
                  type="button"
                  size="xs"
                  variant={!fit && zoom === step ? 'default' : 'outline'}
                  aria-pressed={!fit && zoom === step}
                  onClick={() => {
                    setZoom(step)
                    setFit(false)
                  }}
                >
                  {step}%
                </Button>
              ))}
              <Button
                type="button"
                size="xs"
                variant={fit ? 'default' : 'outline'}
                aria-pressed={fit}
                onClick={() => setFit(true)}
              >
                {t('inmateStats.export.fit')}
                {fit ? ` ${Math.round(fitScale * 100)}%` : ''}
              </Button>
            </div>
          </div>

          <div ref={deskRef} className="min-h-[38rem] overflow-auto bg-[#d8dade] p-6">
            <div
              className="relative"
              style={{
                width: paperWidthPx * effectiveScale,
                height: paperHeight * effectiveScale,
              }}
            >
              <div
                ref={paperRef}
                style={{
                  width: `${paperWidthMm}mm`,
                  transform: `scale(${effectiveScale})`,
                  transformOrigin: i18n.dir() === 'rtl' ? '100% 0' : '0 0',
                }}
              >
                <RegisterDocument month={month} options={options} draftIssuedAt={draftIssuedAt} />
              </div>
            </div>
          </div>
        </section>
      </div>

      <RegisterDocument month={month} options={options} draftIssuedAt={draftIssuedAt} forPrint />
    </div>
  )
}
