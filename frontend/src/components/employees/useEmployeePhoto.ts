/**
 * Shared photo upload/remove mutations. Both the hero camera badge and the
 * Profile-tab photo card use this so the upload logic + cache invalidation
 * live in one place. Invalidates ['employee-detail', id] (the query the hero
 * reads) so has_photo + photo_version refresh and the avatar cache-busts.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage } from '@/lib/api'

export function useEmployeePhoto(employeeId: string) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })

  const upload = useMutation({
    onMutate: () => toast.loading(t('application.attachments.uploading')),
    mutationFn: (file: File) => api.uploadEmployeePhoto(employeeId, file),
    onSuccess: (_data, _vars, toastId) => {
      void invalidate()
      toast.success(t('employees.toast.photoSaved'), { id: toastId })
    },
    onError: (e, _vars, toastId) => toast.error(apiErrorMessage(e), { id: toastId }),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteEmployeePhoto(employeeId),
    onSuccess: () => {
      void invalidate()
      toast.success(t('employees.toast.photoRemoved'))
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  return { upload, remove }
}
