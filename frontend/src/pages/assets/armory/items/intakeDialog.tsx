import { useRef, useState, type ReactNode, type RefObject } from 'react'

import { DialogBody, DialogFooter, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogClose, DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'

import { useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage } from '../armoryQueries'

interface IntakeDialogProps {
  open: boolean
  title: string
  description: string
  dirty: boolean
  busy?: boolean
  discardTitle: string
  onDismiss(): void
  returnFocusRef: RefObject<HTMLElement | null>
  onOpenAutoFocus?(event: Event): void
  onCloseAutoFocus?(event: Event): void
  children: ReactNode
}

export function IntakeDialog({ open, title, description, dirty, busy, discardTitle, onDismiss, returnFocusRef, onOpenAutoFocus, onCloseAutoFocus, children }: IntakeDialogProps) {
  const { t, isAr } = useArmoryLocale()
  const [confirm, setConfirm] = useState(false)
  const confirmReturnRef = useRef<HTMLElement | null>(null)

  function requestClose() {
    if (busy) return
    if (!dirty) { onDismiss(); return }
    confirmReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirm(true)
  }

  return <>
    <DialogRoot open={open} onOpenChange={next => { if (!next) requestClose() }}>
      <DialogContent dir={isAr ? 'rtl' : 'ltr'} hideClose={busy} returnFocusRef={returnFocusRef}
        onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}
        className="inset-0 h-[100dvh] max-h-[100dvh] max-w-none translate-x-0 translate-y-0 rounded-none border-0 rtl:[&_label]:tracking-normal sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-[1050px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
        <DialogHeader className="pe-16">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
    <ConfirmDialog open={open && confirm} onOpenChange={setConfirm} title={discardTitle} destructive
      description={t('assets.armory.intake.discardHint')} confirmLabel={t('assets.armory.discard')}
      returnFocusRef={confirmReturnRef} onConfirm={onDismiss} />
  </>
}

export function IntakeAccessError() {
  const { t } = useArmoryLocale()
  return <>
    <DialogBody><FormAlert id="intake-access-error" message={t('common.forbiddenError')} /></DialogBody>
    <DialogFooter><DialogClose asChild><Button type="button" className="min-h-11">{t('assets.armory.close')}</Button></DialogClose></DialogFooter>
  </>
}

export function IntakeWriteError({ id, error }: { id: string; error: unknown }) {
  const { t } = useArmoryLocale()
  if (!error) return null
  // Structural validation and unexpected server failures may not have an Armory code.
  // Only pass errors with a translated path to the shared formatter.
  const translated = !(error instanceof ApiError) || error.code === 'armory_not_found'
    || (error.code.startsWith('armory_') && (error.status === 409 || error.status === 412 || error.status === 422))
  const message = translated ? armoryErrorMessage(error)
    : t(error.status === 422 ? 'assets.armory.errors.invalidInput' : 'errors.generic')
  return <FormAlert id={id} message={message} />
}
