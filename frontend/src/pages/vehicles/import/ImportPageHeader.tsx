import { ArrowLeft, FileSpreadsheet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export type ImportStep = 'upload' | 'review' | 'done'

const STEPS: ReadonlyArray<{ id: ImportStep; labelKey: string }> = [
  { id: 'upload', labelKey: 'vehicles.import.stepUpload' },
  { id: 'review', labelKey: 'vehicles.import.stepReview' },
  { id: 'done', labelKey: 'vehicles.import.stepDone' },
]

export function ImportPageHeader({
  step,
  showReset,
  onReset,
}: {
  step: ImportStep
  showReset: boolean
  onReset: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const currentIndex = STEPS.findIndex((item) => item.id === step)

  return (
    <header className="shrink-0 border-b border-hairline bg-surface px-4 py-3 md:px-6 md:py-4">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/vehicles"
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            {t('vehicles.import.backToVehicles')}
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
            <FileSpreadsheet className="h-6 w-6 text-primary" strokeWidth={1.7} aria-hidden />
            {t('vehicles.import.title')}
          </h1>
          <p className="mt-1 text-[0.82em] text-muted-foreground">
            {t('vehicles.import.description')}
          </p>
        </div>
        {showReset ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            {t('vehicles.import.chooseAnotherFile')}
          </Button>
        ) : null}
      </div>
      <ol
        className="mx-auto mt-3 flex max-w-[1480px] items-center gap-2 text-xs text-muted-foreground"
        aria-label={t('vehicles.import.progressLabel')}
      >
        {STEPS.map((item, index) => {
          const active = index <= currentIndex
          return (
            <li key={item.id} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <span
                className={
                  active
                    ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground'
                    : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-xs font-bold'
                }
              >
                {index + 1}
              </span>
              <span className={active ? 'truncate font-semibold text-foreground' : 'truncate'}>
                {t(item.labelKey)}
              </span>
              {index < STEPS.length - 1 ? (
                <span className="h-px flex-1 bg-border" aria-hidden />
              ) : null}
            </li>
          )
        })}
      </ol>
    </header>
  )
}
