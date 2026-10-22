import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export function TemplateTokens({ tokens, onInsert, disabled }: {
  tokens: { name: string; label: string }[]
  onInsert: (name: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  if (!tokens.length) return null
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('msgTemplates.editor.variablesHint')}</p>
      <div className="flex flex-wrap gap-2">
        {tokens.map(({ name, label }) => (
          <Button key={name} type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal text-start" title={`{${name}}`} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onInsert(name)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
