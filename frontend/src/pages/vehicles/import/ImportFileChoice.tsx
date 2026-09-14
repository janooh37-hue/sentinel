import { useTranslation } from 'react-i18next'

import { isolateBidi } from '@/lib/useCapabilityCatalog'

interface ImportFileChoiceProps {
  kind: 'photo' | 'license'
  imageIds: string[]
  currentUrl?: string | null
  action?: 'keep_current' | 'use_imported' | null
  selectedId?: string | null
  onAction: (action: 'keep_current' | 'use_imported') => void
  onSelect: (imageId: string) => void
}

export function ImportFileChoice({
  kind,
  imageIds,
  currentUrl,
  action,
  selectedId,
  onAction,
  onSelect,
}: ImportFileChoiceProps): React.JSX.Element {
  const { t } = useTranslation()
  const decisionKey = kind === 'photo' ? 'photoDecision' : 'licenseDecision'
  const primaryKey = kind === 'photo' ? 'primaryPhoto' : 'primaryLicense'
  const groupName = `${kind}-${imageIds.join('-')}`

  return (
    <fieldset className="rounded-lg border border-border bg-surface-raised p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">
        {t(`vehicles.import.${decisionKey}`)}
      </legend>
      <div className="space-y-2 text-xs">
        {currentUrl ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`${groupName}-action`}
              checked={action === 'keep_current'}
              onChange={() => onAction('keep_current')}
            />
            <span>{t('vehicles.import.keepCurrent')}</span>
            <img
              src={currentUrl}
              alt={t(
                kind === 'photo'
                  ? 'vehicles.import.currentPhoto'
                  : 'vehicles.import.currentLicense',
              )}
              className="ms-auto h-10 w-14 rounded border border-border bg-surface object-contain"
            />
          </label>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={`${groupName}-action`}
            checked={action === 'use_imported'}
            onChange={() => onAction('use_imported')}
          />
          <span>{t('vehicles.import.useImported')}</span>
        </label>
        {action === 'use_imported' ? (
          <div className="ms-5 space-y-1 border-s border-hairline ps-3">
            <p className="font-medium text-muted-foreground">
              {t(`vehicles.import.${primaryKey}`)}
            </p>
            {imageIds.map((imageId, index) => (
              <label key={imageId} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name={`${groupName}-primary`}
                  checked={selectedId === imageId}
                  onChange={() => onSelect(imageId)}
                />
                <span>
                  {t('vehicles.import.importedImageNumber', {
                    number: isolateBidi(String(index + 1)),
                  })}
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </fieldset>
  )
}
