/**
 * WidgetEditDialog — reorder / show / hide dashboard widgets or quick actions.
 *
 * Single component drives both flows ("Edit My Widgets" + "Edit Quick Actions")
 * since the row shape is identical: drag-handle, label, visibility toggle,
 * reorder controls. Reordering is via up/down arrow buttons (no DnD lib is
 * already in the bundle, and adding `@dnd-kit` for a small list isn't worth
 * the kilobytes).
 *
 * Dialog keeps local state so users can tweak rows without saving on every
 * micro-edit; Save bubbles the final list to the parent via `onSave`, Cancel
 * discards.
 *
 * **Widget mode max-visible**: pass `maxVisible` to gray out additional Visible
 * toggles once the cap is hit; Save also clamps the list internally to defend
 * against any state that slipped past the UI guard.
 */

import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

interface LayoutItem<T extends string> {
  id: T
  visible: boolean
  order: number
}

export interface WidgetEditDialogProps<T extends string> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  items: Array<LayoutItem<T>>
  labels: Record<T, string>
  defaults: Array<LayoutItem<T>>
  onSave: (items: Array<LayoutItem<T>>) => void
  isSaving?: boolean
  /**
   * Optional cap on how many items can be `visible: true` simultaneously.
   * When set, the dialog grays out Visible toggles on items beyond the cap
   * and shows a helper line at the top. Save additionally clamps so the
   * persisted list is always within the cap.
   */
  maxVisible?: number
  /**
   * Optional hint string rendered below the description — e.g.
   * "Max 3 visible". When omitted, no hint is shown even if `maxVisible` is set.
   */
  maxVisibleHint?: string
}

const OUTLINE_PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function WidgetEditDialog<T extends string>(
  props: WidgetEditDialogProps<T>,
): React.JSX.Element {
  const { open, onOpenChange } = props
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 motion-reduce:animate-none" />
        {/* Inner body mounts only when `open` is true so its local draft
            state is fresh every time — avoids syncing props → state with
            an effect (which violates react-hooks/set-state-in-effect). */}
        {open && <DialogBody {...props} />}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DialogBody<T extends string>({
  title,
  description,
  items,
  labels,
  defaults,
  onSave,
  isSaving,
  maxVisible,
  maxVisibleHint,
}: WidgetEditDialogProps<T>): React.JSX.Element {
  const { t } = useTranslation()

  // Local working copy — fresh on each mount (see WidgetEditDialog above).
  const [draft, setDraft] = useState<Array<LayoutItem<T>>>(() => sortByOrder(items))

  // Precompute, for each item, whether it's currently allowed to be visible
  // given the `maxVisible` cap. Items that are already visible are always
  // allowed; only the off-→on transition is blocked.
  const { visibleCount, lockedIds } = useMemo(() => {
    if (!maxVisible) return { visibleCount: 0, lockedIds: new Set<T>() }
    let count = 0
    const locked = new Set<T>()
    for (const item of draft) {
      if (item.visible) count += 1
    }
    if (count >= maxVisible) {
      for (const item of draft) {
        if (!item.visible) locked.add(item.id)
      }
    }
    return { visibleCount: count, lockedIds: locked }
  }, [draft, maxVisible])

  const move = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const tmp = next[index]!
      next[index] = next[target]!
      next[target] = tmp
      return reindex(next)
    })
  }

  const toggleVisible = (id: T) => {
    setDraft((prev) =>
      prev.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item)),
    )
  }

  const handleReset = () => {
    setDraft(sortByOrder(defaults))
  }

  const handleSave = () => {
    // Hard-clamp visibility before persisting so even pathological intermediate
    // states (e.g. a stale React batch) can't push a layout past the cap.
    let clamped = reindex(draft)
    if (maxVisible) {
      let count = 0
      clamped = clamped.map((item) => {
        if (!item.visible) return item
        if (count < maxVisible) {
          count += 1
          return item
        }
        return { ...item, visible: false }
      })
    }
    onSave(clamped)
  }

  return (
    <Dialog.Content className="modal-centered fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-xl focus:outline-none">
      <div className="mb-4 border-b border-hairline pb-4">
        <Dialog.Title className="text-[1.05em] font-semibold tracking-tight text-foreground">
          {title}
        </Dialog.Title>
        {description && (
          <Dialog.Description className="mt-1 text-[0.86em] text-muted-foreground">
            {description}
          </Dialog.Description>
        )}
        {maxVisible && maxVisibleHint && (
          <p className="mt-2 text-[0.78em] font-medium text-muted-foreground">
            {maxVisibleHint}
            {' · '}
            <span className="font-mono text-foreground">
              {visibleCount}/{maxVisible}
            </span>
          </p>
        )}
      </div>

      <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {draft.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center gap-2.5 rounded-lg border border-hairline bg-surface-raised px-3 py-2.5"
          >
            <span className="flex-1 text-[0.9em] font-medium text-foreground">
              {labels[item.id]}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t('dashboard.editWidgets.moveUp')}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronUp className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === draft.length - 1}
                aria-label={t('dashboard.editWidgets.moveDown')}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            <VisibilitySwitch
              checked={item.visible}
              disabled={lockedIds.has(item.id)}
              onChange={() => toggleVisible(item.id)}
              ariaLabel={t(
                item.visible
                  ? 'dashboard.editWidgets.hideAria'
                  : 'dashboard.editWidgets.showAria',
                { name: labels[item.id] },
              )}
            />
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between border-t border-hairline pt-4">
        <button
          type="button"
          onClick={handleReset}
          className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:rounded-sm"
        >
          {t('dashboard.editWidgets.reset')}
        </button>
        <div className="flex items-center gap-2">
          <Dialog.Close asChild>
            <button type="button" className={OUTLINE_PILL}>
              {t('dashboard.editWidgets.cancel')}
            </button>
          </Dialog.Close>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={PRIMARY_PILL}
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('dashboard.editWidgets.save')}
          </button>
        </div>
      </div>
    </Dialog.Content>
  )
}

/**
 * Local hand-rolled switch — the codebase doesn't ship a shadcn `Switch` yet
 * (no `@radix-ui/react-switch` dependency), and adding one for this single
 * site isn't worth the extra package. Uses native button semantics with
 * `aria-checked` + `role="switch"` for AT.
 *
 * **RTL fix**: Tailwind's `translate-x-*` resolves to a physical LTR transform
 * (positive X = right), so in RTL the thumb still slides right while the
 * track's "off" position is on the right. We apply `rtl:-translate-x-…` to
 * flip the X sign in RTL contexts (`html[dir="rtl"]`). The track + thumb
 * physical positions also use logical offsets (`start-*` so the thumb
 * sits at the "leading" edge in both LTR and RTL).
 */
function VisibilitySwitch({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  ariaLabel: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      className={
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ' +
        (checked
          ? 'border-primary bg-primary'
          : 'border-hairline bg-surface-tinted')
      }
    >
      <span
        aria-hidden
        className={
          // Thumb is absolutely anchored to the leading ("start") edge so the
          // hand-tuned translate offsets work identically in LTR and RTL —
          // we mirror the X sign in RTL via the `rtl:` variant.
          'absolute start-[2px] inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform ' +
          (checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0')
        }
      />
    </button>
  )
}

function sortByOrder<T extends string>(items: Array<LayoutItem<T>>): Array<LayoutItem<T>> {
  return [...items].sort((a, b) => a.order - b.order)
}

function reindex<T extends string>(items: Array<LayoutItem<T>>): Array<LayoutItem<T>> {
  return items.map((item, index) => ({ ...item, order: index }))
}
