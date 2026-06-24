/**
 * ShortcutsHelp — small dialog listing the registered keyboard shortcuts.
 *
 * Opens on Ctrl+/ via KeyboardShortcutsProvider; closes on Escape, backdrop
 * click, or the Close button. Matches the visual style of the rich-editor
 * Save/Load dialogs (fixed inset, z-60, backdrop + centered card).
 */

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { SHORTCUTS } from '@/lib/shortcutsContext'
import { useShortcutsContext } from '@/lib/useKeyboardShortcuts'

function comboLabel(combo: { ctrl?: true; key: string }, isMac: boolean): string {
  const modifier = combo.ctrl ? (isMac ? '⌘' : 'Ctrl') : ''
  const keyDisplay = combo.key === '/' ? '/' : combo.key.toUpperCase()
  return modifier ? `${modifier} + ${keyDisplay}` : keyDisplay
}

export function ShortcutsHelpDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { helpOpen, setHelpOpen } = useShortcutsContext()
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  // Close on Escape — capture so we beat any local dialog handlers.
  useEffect(() => {
    if (!helpOpen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [helpOpen, setHelpOpen])

  if (!helpOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title')}
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      {/* Scrim fades so it doesn't hard-cut over the whole app. The dialog
          card itself is intentionally NOT animated — it's keyboard-initiated
          (Ctrl+/), and Emil's rule is never animate keyboard actions; the user
          wants instant. */}
      <div
        className="anim-scrim-in absolute inset-0 bg-black/40"
        onClick={() => setHelpOpen(false)}
        aria-hidden="true"
      />
      <div className="relative z-10 w-[420px] max-w-[92vw] rounded-lg border border-border bg-background p-5 shadow-xl">
        <h3 className="mb-1 text-base font-semibold text-foreground">
          {t('shortcuts.title')}
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">{t('shortcuts.subtitle')}</p>

        <ul className="flex flex-col gap-1.5">
          {SHORTCUTS.map((s) => (
            <li
              key={s.action}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2"
            >
              <span className="text-xs text-foreground">{t(s.labelKey)}</span>
              <kbd className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground shadow-sm">
                {comboLabel(s.combo, isMac)}
              </kbd>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end">
          <Button variant="secondary" type="button" onClick={() => setHelpOpen(false)}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
