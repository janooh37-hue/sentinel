import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { UniformArt } from '@/components/UniformArt'
import { UNIFORM_ART_GROUPS, UNIFORM_ART_LABELS, type UniformArtKind } from '@/components/uniformArtCatalog'
import { type UniformItemRead } from '@/lib/api'

function availableDrawings(items: UniformItemRead[], currentItemId?: number): UniformArtKind[] {
  const occupied = new Set(items.filter(item => !item.archived_at && item.id !== currentItemId).map(item => item.drawing))
  return UNIFORM_ART_GROUPS.flatMap(group => UNIFORM_ART_LABELS.filter(art => art.group === group.id && !occupied.has(art.kind)).map(art => art.kind))
}
interface Props {
  items: UniformItemRead[]
  currentItemId?: number
  value: UniformArtKind | null
  onChange: (value: UniformArtKind) => void
  disabled?: boolean
}
export function DrawingPicker({ items, currentItemId, value, onChange, disabled }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const available = availableDrawings(items, currentItemId)
  const language = i18n.language.startsWith('ar') ? 'ar' : 'en'
  return <section aria-labelledby={`${id}-title`} className="space-y-3">
    <h3 id={`${id}-title`} className="text-sm font-semibold">{t('assets.uniform.drawing')}</h3>
    {!available.length ? <p role="status" className="text-sm text-muted-foreground">{t('assets.uniform.noDrawing')}</p> : <>
      {value && available.includes(value) && <div className="flex items-center gap-4 py-2" aria-live="polite"><UniformArt kind={value} size={88} className="shrink-0" /><span className="text-sm text-muted-foreground">{t('assets.uniform.previewDrawing')}: {UNIFORM_ART_LABELS.find(art => art.kind === value)?.[language]}</span></div>}
      <div className="max-h-[340px] min-w-0 space-y-4 overflow-y-auto overscroll-contain p-1">{UNIFORM_ART_GROUPS.map(group => {
        const choices = UNIFORM_ART_LABELS.filter(art => art.group === group.id && available.includes(art.kind))
        return choices.length > 0 && <fieldset key={group.id} disabled={disabled}><legend className="mb-2 text-sm font-semibold">{group[language]}</legend><div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">{choices.map(art => <label key={art.kind} className="relative cursor-pointer">
          <input className="peer sr-only" type="radio" name={`${id}-drawing`} value={art.kind} checked={value === art.kind} onChange={() => onChange(art.kind)} />
          <span className="flex min-h-11 flex-col items-center gap-1 rounded-md border border-border p-2 text-center text-sm peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary-text peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50"><UniformArt kind={art.kind} size={44} /><span>{art[language]}</span></span>
        </label>)}</div></fieldset>
      })}</div>
    </>}
  </section>
}
