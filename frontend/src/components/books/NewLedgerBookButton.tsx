/**
 * NewLedgerBookButton — creates an empty private Ledger Book draft and opens
 * it in the composer (`/ledger/compose/:draftId`).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FilePlus2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, type ButtonProps } from '@/components/ui/button'
import { api, apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/toast'
import { LEDGER_DRAFTS_KEY, ledgerDraftKey } from './ledgerBookKeys'

export function NewLedgerBookButton({ className, variant = 'default', size }: {
  className?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
}): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const activeVisit = useRef(false)
  useEffect(() => {
    activeVisit.current = true
    return () => { activeVisit.current = false }
  }, [])
  const create = useMutation({
    mutationFn: () => api.createLedgerDraft({ grade: 'unclassified', body_html: '', external: false }),
    onSuccess: (draft) => {
      // The composer opens on this exact draft: hand it the create response so it does not refetch,
      // and refresh only the list (an exact match leaves the seeded draft alone).
      qc.setQueryData(ledgerDraftKey(draft.id), draft)
      void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
      if (activeVisit.current) navigate(`/ledger/compose/${draft.id}`)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={create.isPending}
      onClick={() => create.mutate()}
    >
      <FilePlus2 aria-hidden="true" className="size-4" />
      {create.isPending ? t('ledgerBook.composer.creating') : t('ledgerBook.composer.newButton')}
    </Button>
  )
}
