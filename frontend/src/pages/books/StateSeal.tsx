/**
 * Status seal chip — icon + label, never color alone (a11y contract).
 * Draft = neutral pencil; pending = amber clock (deliberately distinct).
 * Labels are path-aware via sealDescriptor: pass `signingPath` /
 * `signedSource` where the book is in hand so an in_app pending reads
 * "Awaiting signature" and a scan-back approval reads "Signed · scanned".
 */
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { sealDescriptor } from './bookStateLabel'

export function StateSeal({
  state,
  signingPath,
  signedSource,
}: {
  state: string
  signingPath?: string | null
  signedSource?: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const d = sealDescriptor(state, { signingPath, signedSource })
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[0.6em] font-bold uppercase tracking-[0.05em]',
        d.toneClasses,
      )}
    >
      <d.Icon className="h-2.5 w-2.5" aria-hidden />
      {t(d.labelKey)}
    </span>
  )
}
