/** Signer signature preview for the Report form — shows what "توقيع الآن"
 *  will stamp, or warns when the picked signer has no saved signature. */
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export function SignerSignaturePreview(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { control } = useFormContext()
  const signerId = useWatch({ control, name: 'signer_id' }) as string | undefined

  const query = useQuery({
    queryKey: ['employee-signature', signerId],
    queryFn: () => api.getEmployeeSignature(signerId as string),
    enabled: !!signerId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (!signerId || query.isLoading || query.isError) return null
  const sig = query.data?.dataUrl ?? null
  return sig ? (
    <span className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-white px-2 py-1">
      <img src={sig} alt={t('reportSign.previewAlt')} className="max-h-8 max-w-[150px]" dir="ltr" />
    </span>
  ) : (
    <p className="text-xs text-warning">{t('reportSign.noSig')}</p>
  )
}
