import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useArmoryLocale } from '../armoryFormat'

interface Props {
  open: boolean
  title: string
  subtitle?: ReactNode
  onClose: () => void
  busy?: boolean
  children: ReactNode
  footer: ReactNode
  returnFocusRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  discard?: { title: string; message: string; confirm: () => void; keep: () => void }
}

/** One focus trap for both the task and its discard confirmation. */
export function ShiftTaskDialog({ open, title, subtitle, onClose, busy, children, footer, returnFocusRef, initialFocusRef, discard }: Props) {
  const { t } = useArmoryLocale()
  const heading = useRef<HTMLDivElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const confirming = !!discard
  const description = discard?.message ?? subtitle
  useEffect(() => {
    if (confirming) keep.current?.focus()
    else if (wasConfirming.current && open) (initialFocusRef?.current ?? heading.current)?.focus()
    wasConfirming.current = confirming
  }, [confirming, initialFocusRef, open])
  const dismiss = discard?.keep ?? onClose
  return <DialogRoot open={open} onOpenChange={next => { if (!next && !busy) dismiss() }}>
    <DialogContent hideClose returnFocusRef={returnFocusRef}
      className="h-dvh max-h-dvh max-w-none rounded-none sm:h-auto sm:max-h-[calc(100dvh-3.5rem)] sm:max-w-3xl sm:rounded-2xl"
      {...(!description ? { 'aria-describedby': undefined } : {})}
      onOpenAutoFocus={event => {
        event.preventDefault()
        const initial = initialFocusRef?.current
        initial?.focus()
        if (document.activeElement !== initial) heading.current?.focus()
      }}>
      <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-2 space-y-0 border-b border-hairline p-4 text-start">
        <div ref={heading} tabIndex={-1} className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
          <DialogTitle>{discard?.title ?? title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </div>
        {!confirming && <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" disabled={busy}
          aria-label={t('assets.armory.close')} onClick={onClose}><X aria-hidden /></Button>}
      </DialogHeader>
      <div hidden={confirming} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      <footer className="shrink-0 border-t border-hairline p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {discard ? <div className="flex flex-wrap justify-end gap-2">
          <Button ref={keep} type="button" variant="secondary" className="min-h-11" onClick={discard.keep}>{t('assets.armory.keepEditing')}</Button>
          <Button type="button" variant="destructive" className="min-h-11" onClick={discard.confirm}>{t('assets.armory.discard')}</Button>
        </div> : footer}
      </footer>
    </DialogContent>
  </DialogRoot>
}

interface ScannerProps {
  label: string
  value: string
  hint: string
  onChange: (value: string) => void
  onScan: () => void
  feedback?: ReactNode
  error?: boolean
  disabled?: boolean
  inputRef: RefObject<HTMLInputElement | null>
}

export function ShiftScanner({ label, value, hint, onChange, onScan, feedback, error, disabled, inputRef }: ScannerProps) {
  const { t } = useArmoryLocale()
  const id = useId()
  return <form className="space-y-1" onSubmit={event => { event.preventDefault(); if (!disabled && value.trim()) onScan() }}>
    <label htmlFor={id} className="text-sm font-semibold">{label}</label>
    <div className="flex items-center gap-2">
      <Input id={id} ref={inputRef} dir="ltr" value={value} autoComplete="off" spellCheck={false} maxLength={80} className="min-h-11 min-w-0 font-mono"
        aria-describedby={`${id}-hint`} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} />
      <Button type="submit" variant="secondary" className="min-h-11" disabled={disabled || !value.trim()}>{t('common.confirm')}</Button>
    </div>
    <p id={`${id}-hint`} role={error ? 'alert' : 'status'} className={cn('text-xs', error ? 'text-destructive-text' : 'text-muted-foreground')}>{feedback ?? hint}</p>
  </form>
}

export function EvidenceCheckbox({ children, checked, onChange, label, className }: { children: ReactNode; checked: boolean; onChange: (value: boolean) => void; label?: string; className?: string }) {
  return <label className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm focus-within:ring-2 focus-within:ring-ring', className)}>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.currentTarget.checked)} aria-label={label}
      className="size-4 shrink-0 accent-primary" />
    <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
  </label>
}
