/**
 * ConfirmDialog — a controlled confirmation dialog built on AlertDialog.
 *
 * Replaces `window.confirm(msg)` which silently returns false in the packaged
 * pywebview shell, making destructive actions non-callable in production.
 *
 * Usage:
 *   const [open, setOpen] = useState(false)
 *   <button onClick={() => setOpen(true)}>Delete</button>
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Delete file?"
 *     description="This cannot be undone."
 *     confirmLabel="Delete"
 *     onConfirm={() => doDelete()}
 *     destructive
 *   />
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Label for the confirm button. Defaults to t('common.confirm'). */
  confirmLabel?: string
  onConfirm: () => void
  /** When true, the confirm button uses the destructive (accent) colour. */
  destructive?: boolean
  /** Explicit return target for controlled dialogs that do not render a Radix trigger. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  returnFocusRef,
}: ConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const label = confirmLabel ?? t('common.confirm')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={
          returnFocusRef
            ? (event) => {
                event.preventDefault()
                returnFocusRef.current?.focus()
              }
            : undefined
        }
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
            className={
              destructive
                ? 'bg-accent text-white hover:bg-accent/90'
                : undefined
            }
          >
            {label}
          </AlertDialogAction>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
