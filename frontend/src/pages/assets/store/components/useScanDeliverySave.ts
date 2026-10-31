import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { api, type StoreDeliveryCreate } from '@/lib/api'
import { toast } from '@/lib/toast'
import { invalidateStoreQueries, storeErrorMessage } from '../storeUtils'

/** Delivery creation is durable. Only the attachment is retried after it succeeds. */
export function useScanDeliverySave(file: File) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const deliveryId = useRef<number | null>(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  function finish(withoutFile = false): void {
    invalidateStoreQueries(queryClient)
    if (withoutFile) toast.warning(t('assets.store.scan.savedWithoutFile'))
    else toast.success(t('assets.store.deliveries.saved'))
    navigate('/holdings/store/deliveries')
  }

  async function attach(): Promise<void> {
    if (deliveryId.current == null) return
    setUploadError(null)
    try {
      await api.uploadStoreDeliveryNote(deliveryId.current, file)
      finish()
    } catch {
      setUploadError(t('assets.store.scan.uploadFailed'))
    }
  }

  async function save(body: StoreDeliveryCreate): Promise<void> {
    if (busy.current || deliveryId.current != null) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const delivery = await api.createStoreDelivery(body)
      deliveryId.current = delivery.id
      setSaved(true)
      invalidateStoreQueries(queryClient)
      await attach()
    } catch (cause) {
      setError(storeErrorMessage(cause))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  async function retryUpload(): Promise<void> {
    if (busy.current || deliveryId.current == null) return
    busy.current = true
    setSaving(true)
    try { await attach() }
    finally { busy.current = false; setSaving(false) }
  }

  function finishWithoutFile(): void {
    if (!busy.current && deliveryId.current != null) finish(true)
  }

  return { saving, saved, error, uploadError, save, retryUpload, finishWithoutFile }
}
