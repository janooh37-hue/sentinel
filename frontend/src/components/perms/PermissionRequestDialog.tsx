/**
 * PermissionRequestDialog — lets a user request a capability they don't have.
 *
 * Props:
 *   request      — a catalog-verified requestable capability and its copy
 *   open         — controlled open state
 *   onClose      — called when the dialog should close
 *
 * On [Request]: calls api.requestPermission(request.entry.id), toasts success, closes.
 * The backend is idempotent for pending requests — we treat any 2xx as success.
 * On [Close]: calls onClose without making a network request.
 */

import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import {
  isolateBidi,
  localizeCapability,
  type CapabilityRequestState,
} from '@/lib/useCapabilityCatalog'
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

export interface PermissionRequestDialogProps {
  request: Extract<CapabilityRequestState, { kind: 'requestable' }>
  open: boolean
  onClose: () => void
  returnFocusRef: React.RefObject<HTMLElement | null>
}

export function PermissionRequestDialog({
  request,
  open,
  onClose,
  returnFocusRef,
}: PermissionRequestDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const text = localizeCapability(request.entry, request.entry.id, i18n.language)

  const mutation = useMutation({
    mutationFn: () => api.requestPermission(request.entry.id),
    onSuccess: () => {
      toast.success(t('perms.request.sent', { defaultValue: 'Request sent' }))
      onClose()
    },
    onError: () => {
      // Non-2xx failure — surface a generic error but keep dialog open
      toast.error(t('common.error', { defaultValue: 'Something went wrong. Try again.' }))
    },
  })

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('perms.request.title', { defaultValue: 'Request permission' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('perms.request.body', {
              label: isolateBidi(text.label),
              description: text.description ? isolateBidi(text.description) : '',
              defaultValue: `You don't have permission to ${isolateBidi(text.label)}. ${text.description ? isolateBidi(text.description) : ''} Would you like to request access?`,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => { mutation.mutate() }}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? '…'
              : t('perms.request.send', { defaultValue: 'Request' })}
          </AlertDialogAction>
          <AlertDialogCancel onClick={onClose}>
            {t('perms.request.close', { defaultValue: 'Close' })}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
