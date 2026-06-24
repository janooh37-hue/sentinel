/**
 * IntakePage — full-page host for IntakePanel.
 *
 * Banner header mirrors ExpiryPage; max-width matches the rest of the app.
 * Route: /intake (lazy in App.tsx).
 */

import { useTranslation } from 'react-i18next'
import { IntakePanel } from '@/components/intake/IntakePanel'

export function IntakePage(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 pb-10 pt-6 md:px-8">
        <header className="mb-6">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('intake.eyebrow', { defaultValue: 'Documents' })}
          </div>
          <h2 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('intake.pageTitle')}
          </h2>
          <div className="mt-1 text-[0.86em] text-muted-foreground">
            {t('intake.pageSubtitle')}
          </div>
        </header>

        <IntakePanel />
      </div>
    </div>
  )
}
