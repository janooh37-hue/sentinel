/**
 * PermissionRequestDialog — lets a user request a capability they don't have.
 *
 * Props:
 *   capability   — the capability id string (e.g. "documents.scan")
 *   label        — human-readable label (looked up by the caller from the catalog)
 *   description  — short description of what the capability unlocks
 *   open         — controlled open state
 *   onClose      — called when the dialog should close
 *
 * On [Request]: calls api.requestPermission(capability), toasts success, closes.
 * The backend is idempotent for pending requests — we treat any 2xx as success.
 * On [Close]: calls onClose without making a network request.
 */

import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
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
  capability: string
  label: string
  description: string
  open: boolean
  onClose: () => void
}

export function PermissionRequestDialog({
  capability,
  label,
  description,
  open,
  onClose,
}: PermissionRequestDialogProps): React.JSX.Element {
  const { t } = useTranslation()

  const mutation = useMutation({
    mutationFn: () => api.requestPermission(capability),
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('perms.request.title', { defaultValue: 'Request permission' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('perms.request.body', {
              label,
              description,
              defaultValue: `You don't have permission to ${label}. ${description} Would you like to request access?`,
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
