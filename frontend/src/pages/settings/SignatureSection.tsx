/**
 * SignatureSection — manage the HTML email signature appended to outgoing mail.
 *
 * Stored as a single AppSetting under key `settings.email_signature`. The
 * backend appends it to outgoing email bodies (wrapped in a
 * `<!-- gssg-signature -->` marker for dedup) when `use_signature=true` on
 * the send payload. The compose UI preloads the signature into the editor
 * on mount so the operator sees what'll be sent.
 *
 * Rendered as a sub-card inside EmailSection in TAMM vocabulary.
 */

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, FormProvider } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, FileSignature } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { RichEditor } from '@/components/ui/rich-editor'

interface SignatureFormValues {
  signature: string
}

export function SignatureSection(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['email-signature'],
    queryFn: () => api.getEmailSignature(),
    staleTime: 30_000,
  })

  const methods = useForm<SignatureFormValues>({
    defaultValues: { signature: '' },
  })

  useEffect(() => {
    if (query.data) {
      methods.reset({ signature: query.data.value ?? '' })
    }
  }, [query.data, methods])

  const saveMutation = useMutation({
    mutationFn: (value: string) => api.setEmailSignature(value),
    onSuccess: () => {
      toast.success(t('settings.signature.saved', { defaultValue: 'Signature saved' }))
      void qc.invalidateQueries({ queryKey: ['email-signature'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  function onSubmit(values: SignatureFormValues): void {
    saveMutation.mutate(values.signature)
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-raised p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <FileSignature
          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          strokeWidth={1.7}
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-[0.95em] font-semibold text-foreground">
            {t('settings.signature.title')}
          </span>
          <span className="text-[0.82em] text-muted-foreground">
            {t('settings.signature.description')}
          </span>
        </div>
      </div>

      <FormProvider {...methods}>
        <form
          onSubmit={methods.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <RichEditor name="signature" variant="minimal" defaultValue="" height={200} />
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {t('settings.signature.save')}
            </button>
          </div>
        </form>
      </FormProvider>
    </div>
  )
}
